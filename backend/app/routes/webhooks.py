from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from twilio.twiml.voice_response import VoiceResponse, Dial, Connect, Stream
from app.database.mongodb import db_client
from app.services.twilio_service import TwilioService
from app.services.audio_processor import AudioProcessor
from app.config import settings
import logging
from datetime import datetime
import json

router = APIRouter()
twilio_service = TwilioService()

@router.post("/incoming-call")
async def handle_incoming_call(request: Request):
    """Handle incoming call webhook from Twilio"""
    form_data = await request.form()
    caller_number = form_data.get('From')
    call_sid = form_data.get('CallSid')
    
    # Log incoming call
    await db_client.get_collection("call_logs").insert_one({
        "call_sid": call_sid,
        "incoming_phone": caller_number,
        "caller_name": form_data.get('CallerName', 'Unknown'),
        "received_at": datetime.utcnow(),
        "status": "ringing"
    })
    
    # Generate TwiML response
    response = VoiceResponse()
    
    # Dial my number with timeout
    dial = Dial(
        caller_id=settings.TWILIO_PHONE_NUMBER,
        timeout=settings.CALL_TIMEOUT,
        action="/api/v1/webhook/call-status",  # Status callback
        method="POST"
    )
    dial.number(settings.MY_PHONE_NUMBER)
    response.append(dial)
    
    


    # If no answer, the 'action' URL will be called
    # We'll handle the forwarding in the status callback
    
    return Response(content=str(response), media_type="application/xml")

@router.post("/call-status")
async def call_status(request: Request):
    """Handle call status updates from Twilio"""
    form_data = await request.form()
    call_sid = form_data.get('CallSid')
    call_status = form_data.get('CallStatus')
    dial_call_status = form_data.get('DialCallStatus')
    
    # Update call log
    await db_client.get_collection("call_logs").update_one(
        {"call_sid": call_sid},
        {"$set": {
            "status": call_status,
            "dial_call_status": dial_call_status,
            "updated_at": datetime.utcnow()
        }}
    )
    
    # If call was unanswered or busy, forward to AI
    if dial_call_status in ['no-answer', 'busy', 'failed']:
        return await forward_to_ai_agent(request, call_sid)
    
    return {"status": "ok"}

@router.post("/ai-handler")
async def forward_to_ai_agent(request: Request, call_sid: str = None):
    """Forward call to AI agent"""
    response = VoiceResponse()
    
    # Connect to Media Streams for AI processing
    connect = Connect()
    stream = Stream( # The host header will be the backend's URL, which is correct.
        url=f"wss://{request.headers['host']}/api/v1/websocket/media-stream"
    )
    stream.parameter(name="call_sid", value=call_sid or request.query_params.get('CallSid'))
    connect.append(stream)
    response.append(connect)
    
    return Response(content=str(response), media_type="application/xml")

@router.websocket("/media-stream")
async def handle_media_stream(websocket: WebSocket):
    """Handle WebSocket connection for Twilio Media Streams"""
    await websocket.accept()
    
    try:
        call_sid = None
        # Instantiate a new processor for each WebSocket connection to ensure isolation.
        processor = AudioProcessor()
        
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            
            event_type = data.get('event')
            
            if event_type == 'connected':
                print("Media stream connected")
                
            elif event_type == 'start':
                # Get call SID from start message
                call_sid = data['start']['callSid']
                print(f"Processing call: {call_sid}")
                
                # Fetch system prompt from database
                prompt = await get_system_prompt()
                
                # Initialize AI session
                await processor.initialize_session(call_sid, prompt)
                
            elif event_type == 'media':
                # Process audio chunk
                audio_data = data['media']['payload']
                await processor.process_audio_chunk(websocket, audio_data)
                
            elif event_type == 'stop':
                print(f"Media stream stopped for call: {call_sid}")
                break
                
    except WebSocketDisconnect:
        print("WebSocket disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        if 'processor' in locals():
            await processor.cleanup()

async def get_system_prompt():
    """Get the current system prompt from database"""
    result = await db_client.get_collection("system_settings").find_one(
        {"setting_key": "agent_prompt"},
        sort=[("updated_at", -1)]  # Get the latest version
    )
    
    if result:
        return result["setting_value"]
    else:
        # Return default prompt
        default_prompt = """
        You are an AI assistant representing Sarah. Your name is SarahBot.
        You are professional, friendly, and helpful.
        You can:
        - Answer questions about Sarah's availability
        - Take messages
        - Provide information about Sarah's services
        - Schedule meetings (provide contact details for confirmation)
        
        Always:
        - Identify yourself as an AI assistant
        - Never claim to be Sarah
        - Keep responses concise (1-2 sentences)
        - If you can't answer, offer to take a message
        """
        return default_prompt