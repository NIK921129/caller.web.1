// 1. Load Environment Variables
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const twilio = require('twilio');
const cors = require('cors');

// 2. Get configuration from .env file
const port = process.env.PORT || 8000;
const mongoUri = process.env.MONGODB_URI;
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const frontendUrl = process.env.FRONTEND_URL; // e.g., https://caller-web-1.vercel.app

// Check for essential configuration
if (!mongoUri || !twilioAccountSid || !twilioAuthToken) {
    console.error('FATAL ERROR: Missing required environment variables.');
    process.exit(1);
}

// 3. Initialize Express App
const app = express();

// CORS Configuration to allow requests from your frontend
const corsOptions = {
    origin: [
        'http://localhost:5500', // For local development
        'http://127.0.0.1:5500',
        frontendUrl
    ].filter(Boolean) // Removes any falsy values like a non-set frontendUrl
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Connect to MongoDB
mongoose.connect(mongoUri)
    .then(() => console.log('MongoDB connected successfully.'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// 5. Define Twilio Webhook Endpoint
app.post('/voice', (req, res) => {
    console.log('Incoming call from:', req.body.From);

    const twiml = new twilio.twiml.VoiceResponse();

    // This is where the magic will happen. For now, just a simple message.
    twiml.say({ voice: 'Polly.Amy' }, 'Hello! You have reached the AI assistant. The journey begins now.');

    // TODO: In the next step, we will use <Connect> and <Stream> here.

    res.type('text/xml');
    res.send(twiml.toString());
});

// TODO: Add API endpoints for the frontend dashboard
// app.get('/api/v1/conversations', (req, res) => { ... });
// app.get('/api/v1/conversations/stats', (req, res) => { ... });
// app.put('/api/v1/prompt', (req, res) => { ... });


// 6. Start the Server
app.listen(port, () => {
    console.log(`AI Call Assistant backend is listening on port ${port}`);
    console.log('Twilio is configured to listen for incoming calls.');
});