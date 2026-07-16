from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from datetime import datetime
import asyncio

class CallSession(BaseModel):
    call_sid: str
    system_prompt: str
    conversation_history: List[Dict] = Field(default_factory=list)
    start_time: datetime = Field(default_factory=datetime.utcnow)
    is_speaking: bool = False
    pending_audio_task: Optional[asyncio.Task] = None

    class Config:
        arbitrary_types_allowed = True