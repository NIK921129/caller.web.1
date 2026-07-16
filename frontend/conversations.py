from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorClient
from app.dependencies import get_db
from typing import List, Optional
from datetime import datetime
from bson import ObjectId

router = APIRouter()

@router.get("/")
async def get_conversations(
    db: AsyncIOMotorClient = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    status: Optional[str] = "all"
):
    query = {}
    if search:
        query["caller_number"] = {"$regex": search, "$options": "i"}
    if from_date:
        query["start_time"] = {"$gte": from_date}
    if to_date:
        if "start_time" in query:
            query["start_time"]["$lte"] = to_date
        else:
            query["start_time"] = {"$lte": to_date}
    if status and status != "all":
        query["status"] = status

    total = await db["conversations"].count_documents(query)
    cursor = db["conversations"].find(query).sort("start_time", -1).skip(offset).limit(limit)
    conversations = await cursor.to_list(length=limit)
    
    # Convert ObjectId to string for JSON serialization
    for conv in conversations:
        conv["_id"] = str(conv["_id"])

    return {"total": total, "conversations": conversations}

@router.get("/stats")
async def get_stats(db: AsyncIOMotorClient = Depends(get_db)):
    # This is a placeholder. You can build complex aggregation pipelines here.
    total_calls = await db["conversations"].count_documents({})
    ai_handled = await db["conversations"].count_documents({"status": "completed"}) # Example logic
    return {
        "total_calls": total_calls,
        "ai_handled": ai_handled,
        "avg_duration": "1:25", # Placeholder
        "last_24h": 10 # Placeholder
    }

@router.get("/{conversation_id}")
async def get_conversation_by_id(conversation_id: str, db: AsyncIOMotorClient = Depends(get_db)):
    conversation = await db["conversations"].find_one({"_id": ObjectId(conversation_id)})
    if conversation:
        conversation["_id"] = str(conversation["_id"])
    return conversation