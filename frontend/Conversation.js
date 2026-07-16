const mongoose = require('mongoose');

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

module.exports = Conversation;