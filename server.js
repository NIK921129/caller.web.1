// 1. Load Environment Variables
require('dotenv').config();

// Core Dependencies
const express = require('express');
const mongoose = require('mongoose');
const twilio = require('twilio');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 2. Get configuration from .env file
const port = process.env.PORT || 8000;
const host = process.env.HOST || '0.0.0.0';
const mongoUri = process.env.MONGODB_URI;
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const myPhoneNumber = process.env.MY_PHONE_NUMBER;
const callTimeout = process.env.CALL_TIMEOUT || 10;
const geminiApiKey = process.env.GEMINI_API_KEY;
const frontendUrl = process.env.FRONTEND_URL; // e.g., https://caller-web-1.vercel.app

// Check for essential configuration
if (!mongoUri || !twilioAccountSid || !twilioAuthToken || !geminiApiKey) {
    console.error('FATAL ERROR: Missing required environment variables.');
    process.exit(1);
}

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(geminiApiKey); // This is now safe

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

// 5. Define Mongoose Schema and Model
const transcriptEntrySchema = new mongoose.Schema({
    speaker: { type: String, required: true, enum: ['caller', 'ai_agent'] },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
    callSid: { type: String, required: true, unique: true, index: true },
    caller_number: { type: String, required: true, index: true },
    start_time: { type: Date, required: true, default: Date.now, index: true },
    end_time: { type: Date },
    duration_seconds: { type: Number, default: 0 },
    status: {
        type: String,
        required: true,
        enum: ['ai_handled', 'completed', 'missed', 'in-progress', 'failed'],
        default: 'in-progress',
        index: true
    },
    transcript: [transcriptEntrySchema],
    summary: { type: String },
    sentiment: { type: String },
    topics: [String],
    recordingUrl: { type: String }
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

const Conversation = mongoose.model('Conversation', conversationSchema);

// New Schema for Settings
const settingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true }
});
const Setting = mongoose.model('Setting', settingSchema);

// 5. API Router
const apiRouter = express.Router();

// GET /api/v1/conversations/stats
apiRouter.get('/conversations/stats', async (req, res) => {
    try {
        const total_calls = await Conversation.countDocuments();
        const ai_handled = await Conversation.countDocuments({ status: 'ai_handled' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const last_24h = await Conversation.countDocuments({ start_time: { $gte: today } });

        const avgDurationResult = await Conversation.aggregate([
            { $match: { duration_seconds: { $gt: 0 } } },
            { $group: { _id: null, avg_duration: { $avg: '$duration_seconds' } } }
        ]);
        const avg_duration_seconds = avgDurationResult.length > 0 ? avgDurationResult[0].avg_duration : 0;
        const mins = Math.floor(avg_duration_seconds / 60);
        const secs = Math.round(avg_duration_seconds % 60);
        const avg_duration = `${mins}:${secs.toString().padStart(2, '0')}`;

        res.json({ total_calls, ai_handled, last_24h, avg_duration });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// GET /api/v1/conversations
apiRouter.get('/conversations', async (req, res) => {
    try {
        const { limit = 20, offset = 0, search, from_date, to_date, status } = req.query;

        const query = {};

        if (search) {
            query.caller_number = { $regex: search, $options: 'i' };
        }
        if (status && status !== 'all') {
            query.status = status;
        }
        if (from_date || to_date) {
            query.start_time = {};
            if (from_date) query.start_time.$gte = new Date(from_date);
            if (to_date) query.start_time.$lte = new Date(to_date);
        }

        const conversations = await Conversation.find(query)
            .sort({ start_time: -1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit));

        const total = await Conversation.countDocuments(query);

        res.json({ conversations, total });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// GET /api/v1/conversations/:id
apiRouter.get('/conversations/:id', async (req, res) => {
    try {
        const conversation = await Conversation.findById(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json(conversation);
    } catch (error) {
        console.error(`Error fetching conversation ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch conversation details' });
    }
});

// GET /api/v1/settings/prompt
apiRouter.get('/settings/prompt', async (req, res) => {
    try {
        const promptSetting = await Setting.findOne({ key: 'ai_prompt' });
        res.json({ prompt: promptSetting ? promptSetting.value : '' });
    } catch (error) {
        console.error('Error fetching prompt:', error);
        res.status(500).json({ error: 'Failed to fetch prompt' });
    }
});

// PUT /api/v1/settings/prompt
apiRouter.put('/settings/prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (typeof prompt !== 'string') {
            return res.status(400).json({ error: 'Invalid prompt data' });
        }
        await Setting.findOneAndUpdate(
            { key: 'ai_prompt' },
            { value: prompt },
            { upsert: true, new: true } // Creates the document if it doesn't exist
        );
        res.status(200).json({ message: 'Prompt updated successfully' });
    } catch (error) {
        console.error('Error updating prompt:', error);
        res.status(500).json({ error: 'Failed to update prompt' });
    }
});

// === TWILIO WEBHOOKS ===

// Main entry point for incoming calls.
// Tries to ring your personal number first.
app.post('/voice', (req, res) => {
    console.log(`Incoming call from: ${req.body.From}. Forwarding to personal number.`);

    const twiml = new twilio.twiml.VoiceResponse();
    const dial = twiml.dial({
        timeout: callTimeout,
        action: '/handle-no-answer', // If unanswered, Twilio POSTs to this URL.
        method: 'POST',
    });
    dial.number(myPhoneNumber);

    res.type('text/xml');
    res.send(twiml.toString());
    console.log('Generated TwiML for dialing personal number.');
});

// Fallback handler if the personal number isn't answered.
// This initiates the real-time conversation stream with the AI.
app.post('/handle-no-answer', async (req, res) => {
    const callSid = req.body.CallSid;
    console.log(`Call ${callSid} not answered. Engaging AI assistant.`);

    const twiml = new twilio.twiml.VoiceResponse();
    
    // Fetch the dynamic prompt from the database.
    const promptSetting = await Setting.findOne({ key: 'ai_prompt' });
    const initialPrompt = promptSetting?.value || "You are a helpful AI assistant. Your goal is to take a message.";
    console.log("Using AI prompt:", initialPrompt.substring(0, 50) + "...");
    
    twiml.say({ voice: 'Polly.Amy' }, "Hello, you've reached the AI assistant. Please state your name and the reason for your call after the beep.");
    
    // Use <Connect> and <Stream> to start a bi-directional audio stream.
    // We also configure Twilio to perform speech-to-text and send us the results.
    const connect = twiml.connect()
    const stream = connect.stream({
        url: `wss://${req.headers.host}/`, // Connect to the WebSocket server on this same host.
        track: 'inbound_track' // Transcribe the caller's audio
    });
    stream.parameter({ name: 'encoding', value: 'audio/mulaw' });

    // Pass initial parameters to the WebSocket stream.
    stream.parameter({ name: 'initialPrompt', value: initialPrompt });
    stream.parameter({ name: 'callSid', value: callSid });

    res.type('text/xml');
    res.send(twiml.toString());
    console.log(`Generated TwiML for WebSocket stream for call ${callSid}.`);
});

// Register API and Webhook routes before starting the server
app.use('/api/v1', apiRouter);
// 6. Start the Server and WebSocket Server
const server = app.listen(port, host, () => {
    console.log(`AI Call Assistant backend is listening on http://${host}:${port}`);
    console.log('Twilio is configured to listen for incoming calls.');
});

const wss = new WebSocketServer({ server });

// === WEBSOCKET LOGIC FOR REAL-TIME CONVERSATION ===
wss.on('connection', (ws) => {
    console.log('WebSocket connection established.');
    let chat; // To hold the Gemini chat session
    let streamSid; // To hold the Twilio stream SID

    ws.on('message', async (message) => {
        const msg = JSON.parse(message);

        switch (msg.event) {
            case 'connected':
                console.log(`Twilio stream connected for call ${msg.streamSid}`);
                streamSid = msg.streamSid;
                break;

            case 'start':
                console.log(`Starting conversation for call ${msg.start.callSid}`);
                streamSid = msg.start.streamSid;
                // Initialize a new chat session with Gemini when the stream starts.
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                chat = model.startChat({
                    history: [{ role: "user", parts: msg.start.parameters.initialPrompt }],
                });
                break;

            case 'media':
                // This event contains the transcription from the caller.
                if (msg.media && msg.media.track === 'inbound' && msg.media.chunk > 1) {
                    try {
                        const userText = msg.media.payload; // This is the transcribed text
                        console.log(`User said: "${userText}"`);

                        if (chat && userText) {
                            // Send user's text to Gemini and get a response.
                            const result = await chat.sendMessage(userText);
                            const aiResponse = await result.response.text();
                            console.log(`AI said: "${aiResponse}"`);

                            // Send a "clear" message to stop any previous AI speech that might be lingering.
                            ws.send(JSON.stringify({ event: 'clear', streamSid }));

                            // Send the AI's response back to Twilio to be spoken to the user.
                            ws.send(JSON.stringify({
                                event: 'media',
                                streamSid: streamSid,
                                media: {
                                    payload: Buffer.from(aiResponse, 'utf8').toString('base64'),
                                    // This is a trick to send text to be synthesized.
                                    'x-twilio-media': {
                                        'content-type': 'text/plain',
                                        'voice': 'Polly.Amy'
                                    }
                                }
                            }));
                        }
                    } catch (error) {
                        console.error("Error during Gemini interaction:", error);
                    }
                }
                break;

            case 'stop':
                console.log('Twilio stream stopped.');
                // TODO: Finalize the call log, generate summary, etc.
                break;

            case 'mark':
                // This event is used to confirm when a message we sent has been played.
                console.log(`Mark event received: ${msg.mark.name}`);
                break;

            case 'dtmf':
                // Handle keypad tones from the caller if needed.
                console.log(`DTMF digit received: ${msg.dtmf.digit}`);
                break;
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed.');
    });
});