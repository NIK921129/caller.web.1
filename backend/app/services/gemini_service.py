import google.generativeai as genai
from typing import List, Dict, Any
import json
from app.config import settings
import logging

logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(
            model_name=settings.GEMINI_MODEL,
            generation_config={
                "temperature": 0.7, # Example, or add to settings
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 500,
                "response_mime_type": "application/json"
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
            logger.error("Gemini API error during response generation: %s", e, exc_info=True)
            return {
                "response_text": "I'm having trouble processing your request. Could you please repeat that?",
                "tokens_used": 0,
                "error": str(e)
            }

    async def generate_summary(self, transcript: List[Dict], conversation_id: str):
        """Generate summary of conversation"""
        try:
            prompt = f"""
            Analyze the following conversation transcript and provide a JSON object with the following structure:
            - "summary": A brief summary of the conversation (2-3 sentences).
            - "sentiment": The overall sentiment of the caller (e.g., "positive", "neutral", "negative", "urgent").
            - "topics": A list of up to 3 key topics discussed.
            - "follow_up_required": A boolean indicating if a follow-up action is needed.
            
            Conversation:
            {json.dumps(transcript, indent=2)}

            Respond ONLY with the JSON object.
            """
            
            # The model is configured to return JSON, so we can parse it directly.
            response = await self.model.generate_content_async(prompt)
            
            # Clean up the response text to ensure it's valid JSON
            cleaned_text = response.text.strip().replace("```json", "").replace("```", "")
            summary_data = json.loads(cleaned_text)
            summary_data["conversation_id"] = conversation_id
            return summary_data

        except json.JSONDecodeError as e:
            logger.error("Failed to decode JSON from Gemini summary response: %s. Response text: %s", e, response.text)
            return {"summary": "Summary parsing failed.", "error": str(e)}
        except Exception as e:
            logger.error("Summary generation error for conversation %s: %s", conversation_id, e, exc_info=True)
            return {"summary": "Unable to generate summary", "error": str(e)}