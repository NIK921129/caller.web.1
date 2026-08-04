// Core Dependencies
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const mongoose = require('mongoose');

// Local Modules
const config = require('./config');
const connectDB = require('./db');
const apiRoutes = require('./routes/api');
const twilioRoutes = require('./routes/twilio');
const setupWebSocket = require('./services/websocket');

// Connect to Database
connectDB();

// Initialize Express App
const app = express();

// CORS Configuration
const corsOptions = {
    origin: [
        'http://localhost:5500', // For local development
        'http://127.0.0.1:5500',
        config.frontendUrl
    ].filter(Boolean)
};
app.use(cors(corsOptions));
app.use(express.json());

// Twilio Webhook routes require raw body for validation.
app.use('/voice', twilio.webhook(config.twilioAuthToken, { url: `https://${config.host}` }), twilioRoutes);
app.use('/handle-no-answer', twilio.webhook(config.twilioAuthToken, { url: `https://${config.host}` }), twilioRoutes);
app.use('/handle-dial-status', twilio.webhook(config.twilioAuthToken, { url: `https://${config.host}` }), twilioRoutes);
app.use('/handle-call-status', twilio.webhook(config.twilioAuthToken, { url: `https://${config.host}` }), twilioRoutes);

// API routes
app.use('/api/v1', apiRoutes);

// Start Server
const server = app.listen(config.port, config.host, () => {
    console.log(`AI Call Assistant backend is listening on http://${config.host}:${config.port}`);
});

// Setup WebSocket Server
setupWebSocket(server);

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed');
            process.exit(0);
        });
    });
});