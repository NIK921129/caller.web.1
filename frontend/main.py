from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import webhooks, conversations
from app.database.mongodb import connect_to_mongo, close_mongo_connection
from app.config import settings
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

app = FastAPI(
    title="AI Call Assistant API",
    description="API for managing calls, conversations, and AI interactions.",
    version="1.0.0"
)

# --- CORS Configuration ---
# This allows your Vercel frontend to communicate with your backend.
origins = [
    "https://callerweb1.vercel.app", # Your future production URL
    "http://localhost:8080",  # For local development
    "http://127.0.0.1:8080"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lifecycle events
@app.on_event("startup")
async def startup_db_client():
    app.state.db_client = await connect_to_mongo()
    app.state.db = app.state.db_client[settings.MONGODB_DB_NAME]
    logging.info("Application started and connected to MongoDB.")

@app.on_event("shutdown")
async def shutdown_db_client():
    app.state.db_client.close()
    logging.info("Application shut down and MongoDB connection closed.")

@app.get("/health", tags=["Health"])
async def health_check():
    """Simple health check endpoint for Render/Vercel."""
    return {"status": "healthy"}

# Register routes
app.include_router(webhooks.router, prefix="/api/v1/webhook", tags=["Webhooks"])
app.include_router(conversations.router, prefix="/api/v1/conversations", tags=["Conversations"])