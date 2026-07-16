from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # MongoDB
    MONGODB_URI: str
    MONGODB_DB_NAME: str = "call_assistant"

    # Twilio
    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_PHONE_NUMBER: str
    MY_PHONE_NUMBER: str # Your personal number to forward calls to
    CALL_TIMEOUT: int = 20

    # Gemini AI
    GEMINI_API_KEY: str
    GEMINI_MODEL: str = "gemini-1.5-flash"

    class Config:
        env_file = ".env"

settings = Settings()