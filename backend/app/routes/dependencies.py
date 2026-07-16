from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorClient

def get_db(request: Request) -> AsyncIOMotorClient:
    """Returns the database client from the application state."""
    return request.app.state.db