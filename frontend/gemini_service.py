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
                "temperature": 0.7,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 500,
                "response_mime_type": "application/json"
            }
        )
        self.chat = None

    def start_chat_session(self, system_prompt: str, history: List[Dict] = None):
        gemini_history = []
        if history:
            for entry in history:
                role = "user" if entry["speaker"] == "caller" else "model"
                gemini_history.append({"role": role, "parts": [entry["text"]]})
        self.chat = self.model.start_chat(history=gemini_history)

    async def generate_response(self, user_message: str, system_prompt: str, conversation_history: List[Dict] = None):
        try:
            if not self.chat:
                self.start_chat_session(system_prompt, conversation_history)
            response = await self.chat.send_message_async(user_message)
            return {
                "response_text": response.text,
                "tokens_used": response.usage_metadata.total_token_count if hasattr(response, 'usage_metadata') else 0,
            }
        except Exception as e:
            logger.error("Gemini API error: %s", e, exc_info=True)
            return {"response_text": "I'm having trouble processing that. Could you repeat it?"}

    async def generate_summary(self, transcript: List[Dict], conversation_id: str):
        try:
            prompt = f"""
            Analyze the following conversation and provide a JSON object with:
            - "summary": A brief summary (2-3 sentences).
            - "sentiment": The caller's sentiment ("positive", "neutral", "negative", "urgent").
            - "topics": A list of up to 3 key topics.
            - "follow_up_required": A boolean.
            
            Conversation: {json.dumps(transcript, indent=2)}
            Respond ONLY with the JSON object.
            """
            response = await self.model.generate_content_async(prompt)
            cleaned_text = response.text.strip().replace("```json", "").replace("```", "")
            summary_data = json.loads(cleaned_text)
            summary_data["conversation_id"] = conversation_id
            return summary_data
        except Exception as e:
            logger.error("Summary generation error for %s: %s", conversation_id, e, exc_info=True)
            return {"summary": "Unable to generate summary."}