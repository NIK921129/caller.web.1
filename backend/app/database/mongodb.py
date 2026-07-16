from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional
from app.config import settings

class MongoDB:
    client: Optional[AsyncIOMotorClient] = None
    db = None

    async def connect(self):
        """Connect to MongoDB Atlas"""
        self.client = AsyncIOMotorClient(settings.MONGODB_URI)
        self.db = self.client[settings.MONGODB_DB_NAME]
        print("Connected to MongoDB")

    async def close(self):
        """Close MongoDB connection"""
        if self.client:
            self.client.close()
            print("Closed MongoDB connection")

    def get_collection(self, collection_name: str):
        """Get a collection reference"""
        return self.db[collection_name]

# Singleton instance
db_client = MongoDB()