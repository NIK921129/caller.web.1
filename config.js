// 1. Load Environment Variables
require('dotenv').config();

const config = {
    port: process.env.PORT || 8000,
    host: process.env.HOST || '0.0.0.0',
    mongoUri: process.env.MONGODB_URI,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    myPhoneNumber: process.env.MY_PHONE_NUMBER,
    callTimeout: process.env.CALL_TIMEOUT || 10,
    geminiApiKey: process.env.GEMINI_API_KEY,
    frontendUrl: process.env.FRONTEND_URL, // e.g., https://caller-web-1.vercel.app
    publicUrl: process.env.PUBLIC_URL, // e.g., https://your-backend.onrender.com
    isProduction: process.env.NODE_ENV === 'production',
};

// Check for essential configuration
const requiredConfig = ['mongoUri', 'twilioAccountSid', 'twilioAuthToken', 'geminiApiKey', 'myPhoneNumber', 'publicUrl'];
const missingConfig = requiredConfig.filter(key => !config[key]);

if (missingConfig.length > 0) {
    console.error(`FATAL ERROR: Missing required environment variables: ${missingConfig.join(', ')}`);
    process.exit(1);
}

module.exports = config;