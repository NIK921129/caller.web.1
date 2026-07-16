import asyncio
import base64
import json
from fastapi import WebSocket
from app.services.stt_service import SpeechToTextService
from app.services.tts_service import TextToSpeechService
from app.services.gemini_service import GeminiService
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings
from app.models import CallSession
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class AudioProcessor:
    def __init__(self):
        self.stt = SpeechToTextService()
        self.tts = TextToSpeechService()
        self.gemini = GeminiService(settings.GEMINI_API_KEY)
        self.session: CallSession = None
        self.audio_queue = asyncio.Queue()
        self.processing_task = None
        
    async def initialize_session(self, websocket: WebSocket, call_sid: str, system_prompt: str):
        self.session = CallSession(call_sid=call_sid, system_prompt=system_prompt)
        self.gemini.start_chat_session(system_prompt)
        db = websocket.app.state.db
        self.processing_task = asyncio.create_task(self._process_audio_queue(db))
        
        await db["conversations"].insert_one({
            "call_sid": call_sid,
            "start_time": self.session.start_time,
            "transcript": [],
            "status": "in_progress"
        })
        
    async def add_audio_chunk_to_queue(self, websocket: WebSocket, audio_base64: str):
        await self.audio_queue.put((websocket, audio_base64))

    async def _process_audio_queue(self, db: AsyncIOMotorClient):
        while True:
            try:
                websocket, audio_base64 = await self.audio_queue.get()
                audio_bytes = base64.b64decode(audio_base64)
                transcript = await self.stt.transcribe_audio(audio_bytes)
                
                if self.session.is_speaking and self.session.pending_audio_task:
                    self.session.pending_audio_task.cancel()
                    logger.info("Barge-in detected for call %s.", self.session.call_sid)

                if not transcript or not transcript.strip():
                    self.audio_queue.task_done()
                    continue

                await self._store_transcript(db, "caller", transcript)
                
                ai_response = await self.gemini.generate_response(
                    user_message=transcript,
                    system_prompt=self.session.system_prompt,
                    conversation_history=self.session.conversation_history
                )
                
                if ai_response.get("response_text"):
                    await self._store_transcript(db, "ai_agent", ai_response["response_text"])
                    audio_response = await self.tts.text_to_speech(ai_response["response_text"])
                    self.session.pending_audio_task = asyncio.create_task(
                        self._send_audio_response(websocket, audio_response)
                    )
                    await self.session.pending_audio_task
    
                self.audio_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in audio processing loop for call %s: %s", self.session.call_sid, e, exc_info=True)
                if not self.audio_queue.empty(): self.audio_queue.task_done()
    
    async def _store_transcript(self, db: AsyncIOMotorClient, speaker: str, text: str):
        transcript_entry = {"speaker": speaker, "text": text, "timestamp": datetime.utcnow()}
        self.session.conversation_history.append(transcript_entry)
        await db["conversations"].update_one(
            {"call_sid": self.session.call_sid},
            {"$push": {"transcript": transcript_entry}}
        )
    
    async def _send_audio_response(self, websocket: WebSocket, audio_data: bytes):
        media_response = {"event": "media", "media": {"payload": base64.b64encode(audio_data).decode('utf-8')}}
        try:
            self.session.is_speaking = True
            await websocket.send_text(json.dumps(media_response))
        except asyncio.CancelledError:
            logger.info("Audio playback for call %s was cancelled.", self.session.call_sid)
        finally:
            self.session.is_speaking = False
    
    async def cleanup(self, websocket: WebSocket):
        if self.processing_task:
            self.processing_task.cancel()
            try: await self.processing_task
            except asyncio.CancelledError: pass

        if self.session:
            db = websocket.app.state.db
            summary_text, sentiment, topics = "No conversation.", None, None
            if len(self.session.conversation_history) > 0:
                summary_result = await self.gemini.generate_summary(
                    self.session.conversation_history, self.session.call_sid
                )
                summary_text = summary_result.get("summary", "Summary generation failed.")
                sentiment = summary_result.get("sentiment")
                topics = summary_result.get("topics")
            
            await db["conversations"].update_one(
                {"call_sid": self.session.call_sid},
                {"$set": {
                    "end_time": datetime.utcnow(),
                    "status": "completed",
                    "summary": summary_text,
                    "sentiment": sentiment,
                    "topics": topics
                }}
            )
            self.session = None