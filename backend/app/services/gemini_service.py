import google.generativeai as genai
from typing import List, Dict, Any
import json
from app.config import settings

class GeminiService:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(
            model_name=settings.GEMINI_MODEL,
            generation_config={
                "temperature": 0.7, # Example, or add to settings
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 500, # Example, or add to settings
            }
        )
        self.chat = None

    def start_chat_session(self, system_prompt: str, history: List[Dict] = None):
        """Initializes a new stateful chat session."""
        # Convert history to Gemini's format
        gemini_history = []
        if history:
            for entry in history:
                role = "user" if entry["speaker"] == "caller" else "model"
                gemini_history.append({"role": role, "parts": [entry["text"]]})
        
        self.chat = self.model.start_chat(history=gemini_history)

    async def generate_response(self, user_message: str, system_prompt: str, conversation_history: List[Dict] = None):
        """Generate AI response using Gemini"""
        try:
            if not self.chat:
                self.start_chat_session(system_prompt, conversation_history)

            response = self.chat.send_message(user_message)
            
            return {
                "response_text": response.text,
                "tokens_used": response.usage_metadata.total_token_count if hasattr(response, 'usage_metadata') else 0,
                "finish_reason": "complete"
            }
        except Exception as e:
            print(f"Gemini API error: {e}")
            return {
                "response_text": "I'm having trouble processing your request. Could you please repeat that?",
                "tokens_used": 0,
                "error": str(e)
            }

    async def generate_summary(self, transcript: List[Dict], conversation_id: str):
        """Generate summary of conversation"""
        try:
            prompt = f"""
            Analyze the following conversation and provide:
            1. A brief summary (2-3 sentences)
            2. Sentiment analysis (positive/neutral/negative)
            3. Key topics discussed (list up to 3)
            4. Any follow-up required
            
            Conversation:
            {json.dumps(transcript, indent=2)}
            """
            
            response = self.model.generate_content(prompt)
            # Parse structured response (you might want to use JSON mode in Gemini)
            return {
                "summary": response.text,
                "conversation_id": conversation_id
            }
        except Exception as e:
            print(f"Summary generation error: {e}")
            return {"summary": "Unable to generate summary", "error": str(e)}