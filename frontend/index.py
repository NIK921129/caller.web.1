import asyncio
import base64
import json
import logging
from datetime import datetime
from typing import List, Dict, Optional

import google.generativeai as genai
from bson import ObjectId
from fastapi import (APIRouter, Depends, FastAPI, Query, Request, WebSocket,
                   WebSocketDisconnect)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from twilio.twiml.voice_response import Connect, Dial, Stream, VoiceResponse

# --- 1. Configuration ---
class Settings(BaseSettings):
    MONGODB_URI: str
    MONGODB_DB_NAME: str = "call_assistant"
    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_PHONE_NUMBER: str
    MY_PHONE_NUMBER: str
    CALL_TIMEOUT: int = 20
    GEMINI_API_KEY: str
    GEMINI_MODEL: str = "gemini-1.5-flash"

settings = Settings()

# --- 2. Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- 3. Pydantic Models ---
class CallSession(BaseModel):
    call_sid: str
    system_prompt: str
    conversation_history: List[Dict] = Field(default_factory=list)
    start_time: datetime = Field(default_factory=datetime.utcnow)
    is_speaking: bool = False
    pending_audio_task: Optional[asyncio.Task] = None

    class Config:
        arbitrary_types_allowed = True

# --- 4. Services (STT, TTS, Twilio are placeholders) ---
class SpeechToTextService:
    async def transcribe_audio(self, audio_bytes: bytes) -> str:
        # Placeholder for actual STT implementation (e.g., Google Speech-to-Text)
        logger.info("Transcribing audio chunk...")
        return "This is a transcribed test message."

class TextToSpeechService:
    async def text_to_speech(self, text: str) -> bytes:
        # Placeholder for actual TTS implementation (e.g., Google Text-to-Speech)
        logger.info("Converting text to speech: %s", text)
        return b"sample_audio_bytes"

class TwilioService:
    # Placeholder for any future Twilio client interactions
    pass

class GeminiService:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(
            model_name=settings.GEMINI_MODEL,
            generation_config={
                "temperature": 0.7, "top_p": 0.95, "top_k": 40,
                "max_output_tokens": 500, "response_mime_type": "application/json"
            }
        )
        self.chat = None

    def start_chat_session(self, system_prompt: str, history: List[Dict] = None):
        gemini_history = [{"role": "user" if e["speaker"] == "caller" else "model", "parts": [e["text"]]} for e in history or []]
        self.chat = self.model.start_chat(history=gemini_history)

    async def generate_response(self, user_message: str, system_prompt: str, conversation_history: List[Dict] = None):
        try:
            if not self.chat: self.start_chat_session(system_prompt, conversation_history)
            response = await self.chat.send_message_async(user_message)
            return {"response_text": response.text}
        except Exception as e:
            logger.error("Gemini API error: %s", e, exc_info=True)
            return {"response_text": "I'm having trouble. Could you repeat that?"}

    async def generate_summary(self, transcript: List[Dict], conversation_id: str):
        try:
            prompt = f"""Analyze the conversation and provide a JSON object with: "summary", "sentiment", "topics" (list), "follow_up_required" (bool). Conversation: {json.dumps(transcript, indent=2)}. Respond ONLY with the JSON object."""
            response = await self.model.generate_content_async(prompt)
            cleaned_text = response.text.strip().replace("```json", "").replace("```", "")
            return json.loads(cleaned_text)
        except Exception as e:
            logger.error("Summary generation error for %s: %s", conversation_id, e, exc_info=True)
            return {"summary": "Unable to generate summary."}

class AudioProcessor:
    def __init__(self):
        self.stt, self.tts, self.gemini = SpeechToTextService(), TextToSpeechService(), GeminiService(settings.GEMINI_API_KEY)
        self.session: CallSession = None
        self.audio_queue = asyncio.Queue()
        self.processing_task = None

    async def initialize_session(self, websocket: WebSocket, call_sid: str, system_prompt: str):
        self.session = CallSession(call_sid=call_sid, system_prompt=system_prompt)
        self.gemini.start_chat_session(system_prompt)
        db = websocket.app.state.db
        self.processing_task = asyncio.create_task(self._process_audio_queue(db))
        await db["conversations"].insert_one({"call_sid": call_sid, "start_time": self.session.start_time, "transcript": [], "status": "in_progress"})

    async def add_audio_chunk_to_queue(self, websocket: WebSocket, audio_base64: str):
        await self.audio_queue.put((websocket, audio_base64))

    async def _process_audio_queue(self, db: AsyncIOMotorClient):
        while True:
            try:
                websocket, audio_base64 = await self.audio_queue.get()
                transcript = await self.stt.transcribe_audio(base64.b64decode(audio_base64))
                if self.session.is_speaking and self.session.pending_audio_task: self.session.pending_audio_task.cancel()
                if not transcript or not transcript.strip():
                    self.audio_queue.task_done(); continue
                await self._store_transcript(db, "caller", transcript)
                ai_response = await self.gemini.generate_response(transcript, self.session.system_prompt, self.session.conversation_history)
                if ai_response.get("response_text"):
                    await self._store_transcript(db, "ai_agent", ai_response["response_text"])
                    audio_response = await self.tts.text_to_speech(ai_response["response_text"])
                    self.session.pending_audio_task = asyncio.create_task(self._send_audio_response(websocket, audio_response))
                    await self.session.pending_audio_task
                self.audio_queue.task_done()
            except asyncio.CancelledError: break
            except Exception as e:
                logger.error("Audio processing error for call %s: %s", self.session.call_sid, e, exc_info=True)
                if not self.audio_queue.empty(): self.audio_queue.task_done()

    async def _store_transcript(self, db: AsyncIOMotorClient, speaker: str, text: str):
        entry = {"speaker": speaker, "text": text, "timestamp": datetime.utcnow()}
        self.session.conversation_history.append(entry)
        await db["conversations"].update_one({"call_sid": self.session.call_sid}, {"$push": {"transcript": entry}})

    async def _send_audio_response(self, websocket: WebSocket, audio_data: bytes):
        payload = {"event": "media", "media": {"payload": base64.b64encode(audio_data).decode('utf-8')}}
        try:
            self.session.is_speaking = True
            await websocket.send_text(json.dumps(payload))
        except asyncio.CancelledError: logger.info("Audio playback cancelled for call %s.", self.session.call_sid)
        finally: self.session.is_speaking = False

    async def cleanup(self, websocket: WebSocket):
        if self.processing_task:
            self.processing_task.cancel()
            try: await self.processing_task
            except asyncio.CancelledError: pass
        if self.session:
            db = websocket.app.state.db
            summary_data = await self.gemini.generate_summary(self.session.conversation_history, self.session.call_sid)
            await db["conversations"].update_one(
                {"call_sid": self.session.call_sid},
                {"$set": {
                    "end_time": datetime.utcnow(), "status": "completed", **summary_data
                }}
            )

# --- 5. FastAPI App and Database Connection ---
app = FastAPI(title="AI Call Assistant API", version="1.0.0")

@app.on_event("startup")
async def startup_db_client():
    app.state.db_client = AsyncIOMotorClient(settings.MONGODB_URI)
    app.state.db = app.state.db_client[settings.MONGODB_DB_NAME]
    logger.info("Application started and connected to MongoDB.")

@app.on_event("shutdown")
async def shutdown_db_client():
    app.state.db_client.close()
    logger.info("Application shut down.")

def get_db(request: Request) -> AsyncIOMotorClient:
    return request.app.state.db

# --- 6. CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://callerweb1.vercel.app", "http://localhost:8080", "http://127.0.0.1:8080"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# --- 7. API Routers ---
conversations_router = APIRouter()
webhooks_router = APIRouter()

@conversations_router.get("/")
async def get_conversations(db: AsyncIOMotorClient = Depends(get_db), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), search: Optional[str] = None, from_date: Optional[datetime] = None, to_date: Optional[datetime] = None, status: Optional[str] = "all"):
    query = {}
    if search: query["caller_number"] = {"$regex": search, "$options": "i"}
    if from_date: query["start_time"] = {"$gte": from_date}
    if to_date: query.setdefault("start_time", {})["$lte"] = to_date
    if status and status != "all": query["status"] = status
    total = await db["conversations"].count_documents(query)
    cursor = db["conversations"].find(query).sort("start_time", -1).skip(offset).limit(limit)
    conversations = await cursor.to_list(length=limit)
    for conv in conversations: conv["_id"] = str(conv["_id"])
    return {"total": total, "conversations": conversations}

@conversations_router.get("/stats")
async def get_stats(db: AsyncIOMotorClient = Depends(get_db)):
    total_calls = await db["conversations"].count_documents({})
    ai_handled = await db["conversations"].count_documents({"status": "completed"})
    return {"total_calls": total_calls, "ai_handled": ai_handled, "avg_duration": "1:25", "last_24h": 10} # Placeholders

@conversations_router.get("/{conversation_id}")
async def get_conversation_by_id(conversation_id: str, db: AsyncIOMotorClient = Depends(get_db)):
    conv = await db["conversations"].find_one({"_id": ObjectId(conversation_id)})
    if conv: conv["_id"] = str(conv["_id"])
    return conv

@webhooks_router.post("/incoming-call")
async def handle_incoming_call(request: Request, db: AsyncIOMotorClient = Depends(get_db)):
    form_data = await request.form()
    await db["call_logs"].insert_one({"call_sid": form_data.get('CallSid'), "incoming_phone": form_data.get('From'), "received_at": datetime.utcnow(), "status": "ringing"})
    response = VoiceResponse()
    dial = Dial(caller_id=settings.TWILIO_PHONE_NUMBER, timeout=settings.CALL_TIMEOUT, action="/api/v1/webhook/call-status", method="POST")
    dial.number(settings.MY_PHONE_NUMBER)
    response.append(dial)
    return Response(content=str(response), media_type="application/xml")

@webhooks_router.post("/call-status")
async def call_status(request: Request, db: AsyncIOMotorClient = Depends(get_db)):
    form_data = await request.form()
    call_sid, dial_status = form_data.get('CallSid'), form_data.get('DialCallStatus')
    await db["call_logs"].update_one({"call_sid": call_sid}, {"$set": {"dial_call_status": dial_status, "updated_at": datetime.utcnow()}})
    if dial_status in ['no-answer', 'busy', 'failed', 'canceled']:
        response = VoiceResponse()
        stream = Stream(url=f"wss://{request.headers.get('host')}/api/v1/webhook/media-stream")
        stream.parameter(name="call_sid", value=call_sid)
        response.append(Connect(stream))
        return Response(content=str(response), media_type="application/xml")
    return Response(status_code=200)

@webhooks_router.websocket("/media-stream")
async def handle_media_stream(websocket: WebSocket):
    await websocket.accept()
    processor = AudioProcessor()
    try:
        while True:
            data = json.loads(await websocket.receive_text())
            event = data.get('event')
            if event == 'start':
                db = websocket.app.state.db
                prompt_doc = await db["system_settings"].find_one({"setting_key": "agent_prompt"}, sort=[("updated_at", -1)])
                prompt = prompt_doc["setting_value"] if prompt_doc else "You are a helpful AI assistant."
                await processor.initialize_session(websocket, data['start']['callSid'], prompt)
            elif event == 'media':
                await processor.add_audio_chunk_to_queue(websocket, data['media']['payload'])
            elif event == 'stop':
                logger.info("Media stream stopped for call: %s", data['stop']['callSid'])
                break
    except WebSocketDisconnect: logger.info("WebSocket disconnected.")
    except Exception as e: logger.error("WebSocket error: %s", e, exc_info=True)
    finally: await processor.cleanup(websocket)

# --- 8. Health Check and Final App Setup ---
@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}

app.include_router(webhooks_router, prefix="/api/v1/webhook", tags=["Webhooks"])
app.include_router(conversations_router, prefix="/api/v1/conversations", tags=["Conversations"])