// db.js — MongoDB connection + all Mongoose models
const mongoose = require('mongoose');

let connecting = null;

async function connectDB(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is not set');
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    connecting = mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  }
  await connecting;
  console.log('[db] connected');
  return mongoose.connection;
}

/* ------------------------------------------------------------------ *
 * Settings — single document, fully editable from the frontend UI.
 * Holds credentials, AI prompting and call-routing behaviour.
 * ------------------------------------------------------------------ */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },

    // --- Telephony credentials ---
    twilioAccountSid: { type: String, default: '' },
    twilioAuthToken: { type: String, default: '' },
    twilioPhoneNumber: { type: String, default: '' },
    forwardToNumber: { type: String, default: '' }, // your real phone
    publicUrl: { type: String, default: '' }, // https://your-app.onrender.com

    // --- Exotel credentials ---
    exotelAccountSid: { type: String, default: '' },
    exotelApiToken: { type: String, default: '' },
    exotelApiSubdomain: { type: String, default: '' },
    exotelCallerId: { type: String, default: '' },

    // --- AI credentials / prompting ---
    geminiApiKey: { type: String, default: '' },
    aiModel: { type: String, default: 'gemini-1.5-flash' },
    temperature: { type: Number, default: 0.7 },
    maxOutputTokens: { type: Number, default: 220 },
    systemPrompt: {
      type: String,
      default:
        'You are a warm, efficient phone receptionist. Keep every reply under 30 words, ask one question at a time, collect the caller name, reason for calling and a callback number, then politely close the call.',
    },
    greeting: {
      type: String,
      default: 'Hello! Thanks for calling. I am the AI assistant. How can I help you today?',
    },
    fallbackMessage: {
      type: String,
      default: 'Sorry, I did not catch that. Could you repeat it?',
    },
    closingMessage: {
      type: String,
      default: 'Thank you for calling. Your message has been recorded. Goodbye!',
    },
    analysisPrompt: {
      type: String,
      default:
        'Analyse the call transcript. Return summary, caller intent, sentiment, urgency, action items and a lead score from 0-100.',
    },

    // --- Voice / language ---
    voice: { type: String, default: 'Polly.Joanna' },
    language: { type: String, default: 'en-US' },
    speechTimeout: { type: String, default: 'auto' },
    maxTurns: { type: Number, default: 12 },

    // --- Behaviour ---
    provider: { type: String, enum: ['twilio', 'exotel'], default: 'twilio' },
    mode: { type: String, enum: ['ai', 'forward', 'ai_then_forward'], default: 'ai' }, // Twilio-specific for now
    recordCalls: { type: Boolean, default: false },
    autoAnalyze: { type: Boolean, default: true },
    smsFollowUp: { type: Boolean, default: false },
    smsFollowUpText: { type: String, default: 'Thanks for calling! We will get back to you shortly.' },
    notifyOnMissed: { type: Boolean, default: false },

    // --- Business hours (24h, server timezone offset aware) ---
    businessHoursEnabled: { type: Boolean, default: false },
    businessHoursStart: { type: String, default: '09:00' },
    businessHoursEnd: { type: String, default: '18:00' },
    timezoneOffsetMinutes: { type: Number, default: 330 }, // IST default
    afterHoursMessage: {
      type: String,
      default: 'We are currently closed. Please leave your name, number and message after the beep.',
    },

    // --- Screening ---
    blocklist: { type: [String], default: [] },
    vipList: { type: [String], default: [] },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 * Call — one document per call, with embedded transcript turns.
 * ------------------------------------------------------------------ */
const TurnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['caller', 'assistant', 'system'], required: true },
    text: { type: String, default: '' },
    confidence: { type: Number, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CallSchema = new mongoose.Schema(
  {
    callSid: { type: String, index: true },
    direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    status: { type: String, default: 'in-progress' },
    handledBy: { type: String, enum: ['ai', 'forward', 'voicemail', 'blocked'], default: 'ai' },
    durationSeconds: { type: Number, default: 0 },
    recordingUrl: { type: String, default: '' },
    turns: { type: [TurnSchema], default: [] },
    transcript: { type: String, default: '' },

    // AI analysis
    summary: { type: String, default: '' },
    intent: { type: String, default: '' },
    sentiment: { type: String, default: '' },
    urgency: { type: String, default: '' },
    actionItems: { type: [String], default: [] },
    leadScore: { type: Number, default: null },
    callerName: { type: String, default: '' },
    callbackNumber: { type: String, default: '' },
    tags: { type: [String], default: [] },
    starred: { type: Boolean, default: false },
    analyzedAt: { type: Date, default: null },

    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

CallSchema.index({ createdAt: -1 });

/* ------------------------------------------------------------------ *
 * PromptTemplate — reusable AI persona library, editable from the UI.
 * ------------------------------------------------------------------ */
const PromptTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    systemPrompt: { type: String, default: '' },
    greeting: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const Settings = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
const Call = mongoose.models.Call || mongoose.model('Call', CallSchema);
const PromptTemplate =
  mongoose.models.PromptTemplate || mongoose.model('PromptTemplate', PromptTemplateSchema);

/** Returns the singleton settings doc, creating it (with .env seeds) if missing. */
async function getSettings() {
  let s = await Settings.findOne({ key: 'global' });
  if (!s) {
    s = await Settings.create({
      key: 'global',
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
      twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
      forwardToNumber: process.env.MY_PHONE_NUMBER || '',
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      publicUrl: process.env.PUBLIC_URL || '',
      exotelAccountSid: process.env.EXOTEL_ACCOUNT_SID || '',
      exotelApiToken: process.env.EXOTEL_API_TOKEN || '',
      exotelApiSubdomain: process.env.EXOTEL_API_SUBDOMAIN || '',
      exotelCallerId: process.env.EXOTEL_CALLER_ID || '',
    });
  }
  return s;
}

module.exports = { connectDB, Settings, Call, PromptTemplate, getSettings, mongoose };
