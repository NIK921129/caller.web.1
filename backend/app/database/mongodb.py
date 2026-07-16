from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

class DataBase:
    client: AsyncIOMotorClient = None

db = DataBase()

async def get_database():
    return db.client[settings.MONGODB_DB_NAME]

async def connect_to_mongo():
    db.client = AsyncIOMotorClient(settings.MONGODB_URI)
    print("Connected to MongoDB...")
    
async def close_mongo_connection():
    db.client.close()
    print("Closed MongoDB connection.")