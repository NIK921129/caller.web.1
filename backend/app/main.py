from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import webhooks, conversations
from app.database.mongodb import db_client
from app.config import settings
import logging

app = FastAPI(
    title="AI Call Assistant API",
    description="API for managing calls, conversations, and AI interactions.",
    version="1.0.0"
)

# --- CORS Configuration ---
# This allows your Vercel frontend to communicate with your Render backend.
origins = [
    "https://callerweb1.vercel.app", # Main Production URL
    "https://callerweb1-git-main-voxerachat-3388s-projects.vercel.app", # Vercel Production URL
    "https://callerweb1-qjr7o58ua-voxerachat-3388s-projects.vercel.app", # Vercel Preview URL
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
    await db_client.connect()
    logging.info("Application started successfully")

@app.on_event("shutdown")
async def shutdown_db_client():
    await db_client.close()
    logging.info("Application shut down")

@app.get("/health", tags=["Health"])
async def health_check():
    """Simple health check endpoint for Render."""
    return {"status": "healthy"}

# Register routes
app.include_router(webhooks.router, prefix="/api/v1/webhook", tags=["Webhooks"])
app.include_router(conversations.router, prefix="/api/v1/conversations", tags=["Conversations"])