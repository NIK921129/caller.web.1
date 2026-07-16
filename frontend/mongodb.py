from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

async def connect_to_mongo():
    """Creates a MongoDB client instance."""
    return AsyncIOMotorClient(settings.MONGODB_URI)
    
async def close_mongo_connection():
    """Closes the MongoDB client instance."""
    pass