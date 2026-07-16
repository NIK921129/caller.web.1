from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import Response
from twilio.twiml.voice_response import VoiceResponse, Dial, Connect, Stream
from motor.motor_asyncio import AsyncIOMotorClient
from app.dependencies import get_db
from app.services.twilio_service import TwilioService
from app.services.audio_processor import AudioProcessor
from app.config import settings
import logging
from datetime import datetime
import json

logger = logging.getLogger(__name__)
router = APIRouter()
twilio_service = TwilioService()

@router.post("/incoming-call")
async def handle_incoming_call(request: Request, db: AsyncIOMotorClient = Depends(get_db)):
    """Handle incoming call webhook from Twilio"""
    form_data = await request.form()
    caller_number = form_data.get('From')
    call_sid = form_data.get('CallSid')
    
    await db["call_logs"].insert_one({
        "call_sid": call_sid,
        "incoming_phone": caller_number,
        "caller_name": form_data.get('CallerName', 'Unknown'),
        "received_at": datetime.utcnow(),
        "status": "ringing"
    })
    
    response = VoiceResponse()
    dial = Dial(
        caller_id=settings.TWILIO_PHONE_NUMBER,
        timeout=settings.CALL_TIMEOUT,
        action="/api/v1/webhook/call-status",
        method="POST"
    )
    dial.number(settings.MY_PHONE_NUMBER)
    response.append(dial)
    
    return Response(content=str(response), media_type="application/xml")

@router.post("/call-status")
async def call_status(request: Request, db: AsyncIOMotorClient = Depends(get_db)):
    """Handle call status updates from Twilio"""
    form_data = await request.form()
    call_sid = form_data.get('CallSid')
    dial_call_status = form_data.get('DialCallStatus')
    
    await db["call_logs"].update_one(
        {"call_sid": call_sid},
        {"$set": {
            "dial_call_status": dial_call_status,
            "updated_at": datetime.utcnow()
        }}
    )
    
    if dial_call_status in ['no-answer', 'busy', 'failed', 'canceled']:
        response = VoiceResponse()
        connect = Connect()
        # Construct WebSocket URL dynamically
        host = request.headers.get("host")
        stream_url = f"wss://{host}/api/v1/webhook/media-stream"
        stream = Stream(url=stream_url)
        stream.parameter(name="call_sid", value=call_sid)
        connect.append(stream)
        response.append(connect)
        return Response(content=str(response), media_type="application/xml")
    
    return Response(status_code=200)

@router.websocket("/media-stream")
async def handle_media_stream(websocket: WebSocket):
    """Handle WebSocket connection for Twilio Media Streams"""
    await websocket.accept()
    processor = AudioProcessor()
    
    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            event_type = data.get('event')
            
            if event_type == 'start':
                call_sid = data['start']['callSid']
                logger.info(f"Processing call: {call_sid}")
                db = websocket.app.state.db
                prompt = await get_system_prompt(db)
                await processor.initialize_session(websocket, call_sid, prompt)
                
            elif event_type == 'media':
                await processor.add_audio_chunk_to_queue(websocket, data['media']['payload'])
                
            elif event_type == 'stop':
                logger.info(f"Media stream stopped for call: {data['stop']['callSid']}")
                break
                
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected.")
    except Exception as e:
        logger.error("WebSocket error: %s", e, exc_info=True)
    finally:
        await processor.cleanup(websocket)

async def get_system_prompt(db: AsyncIOMotorClient):
    """Get the current system prompt from database"""
    result = await db["system_settings"].find_one(
        {"setting_key": "agent_prompt"},
        sort=[("updated_at", -1)]
    )
    return result["setting_value"] if result else "You are a helpful AI assistant."