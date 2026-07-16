import asyncio
import base64
import json
from fastapi import WebSocket
from app.services.stt_service import SpeechToTextService
from app.services.tts_service import TextToSpeechService
from app.services.gemini_service import GeminiService
from app.database.mongodb import db_client
from app.config import settings
from datetime import datetime

class AudioProcessor:
    def __init__(self):
        self.stt = SpeechToTextService()
        self.tts = TextToSpeechService()
        self.gemini = GeminiService(settings.GEMINI_API_KEY)
        self.current_session = None
        self.conversation_buffer = []
        self.is_processing = False
        
    async def initialize_session(self, call_sid: str, system_prompt: str):
        """Initialize a new AI session"""
        self.current_session = {
            "call_sid": call_sid,
            "system_prompt": system_prompt,
            "conversation_history": [],
            "start_time": datetime.utcnow()
        }
        
        # Create conversation record in database
        await db_client.get_collection("conversations").insert_one({
            "call_sid": call_sid,
            "start_time": datetime.utcnow(),
            "transcript": [],
            "status": "in_progress"
        })
        
    async def process_audio_chunk(self, websocket: WebSocket, audio_base64: str):
        """Process an audio chunk and generate AI response"""
        if self.is_processing:
            return
        
        self.is_processing = True
        
        try:
            # Convert base64 to audio bytes
            audio_bytes = base64.b64decode(audio_base64)
            
            # Transcribe audio
            transcript = await self.stt.transcribe_audio(audio_bytes)
            
            if transcript and len(transcript.strip()) > 0:
                # Store transcript in conversation
                await self._store_transcript("caller", transcript)
                
                # Get AI response
                ai_response = await self.gemini.generate_response(
                    user_message=transcript,
                    system_prompt=self.current_session["system_prompt"],
                    conversation_history=self.current_session["conversation_history"]
                )
                
                if ai_response.get("response_text"):
                    # Store AI response
                    await self._store_transcript("ai_agent", ai_response["response_text"])
                    
                    # Convert to audio
                    audio_response = await self.tts.text_to_speech(ai_response["response_text"])
                    
                    # Send audio back via WebSocket
                    await self._send_audio_response(websocket, audio_response)
                    
            self.is_processing = False
            
        except Exception as e:
            print(f"Audio processing error: {e}")
            self.is_processing = False
    
    async def _store_transcript(self, speaker: str, text: str):
        """Store transcript in database and memory"""
        transcript_entry = {
            "speaker": speaker,
            "text": text,
            "timestamp": datetime.utcnow()
        }
        
        # Store in memory for context
        if speaker == "caller":
            self.current_session["conversation_history"].append({"speaker": "caller", "text": text})
        else:
            self.current_session["conversation_history"].append({"speaker": "ai_agent", "text": text})
        
        # Store in database
        await db_client.get_collection("conversations").update_one(
            {"call_sid": self.current_session["call_sid"]},
            {"$push": {"transcript": transcript_entry}}
        )
    
    async def _send_audio_response(self, websocket: WebSocket, audio_data: bytes):
        """Send audio response via WebSocket"""
        # Twilio Media Streams expects a specific JSON format for outbound audio.
        # The audio must be base64 encoded and follow the mulaw format.
        media_response = {
            "event": "media",
            "media": {
                "payload": base64.b64encode(audio_data).decode('utf-8')
            }
        }
        await websocket.send_text(json.dumps(media_response))
    
    async def cleanup(self):
        """Clean up session and finalize conversation"""
        if self.current_session:
            # Update conversation status
            await db_client.get_collection("conversations").update_one(
                {"call_sid": self.current_session["call_sid"]},
                {
                    "$set": {
                        "end_time": datetime.utcnow(),
                        "status": "completed"
                    }
                }
            )
            
            # Generate summary
            if len(self.current_session["conversation_history"]) > 0:
                await self.gemini.generate_summary(
                    self.current_session["conversation_history"],
                    self.current_session["call_sid"]
                )
            
            self.current_session = None