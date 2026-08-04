// Core Dependencies
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const morgan = require('morgan');

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

// Security and Logging Middleware
app.use(helmet()); // Set security-related HTTP response headers
app.use(morgan('dev')); // Log HTTP requests to the console

// Body Parsers
app.use(express.json());

// Twilio Webhook routes require the raw body for validation, so they must be defined
// before express.json() if it were to parse them. We will group them under a router.
// The validation middleware needs the server's public URL to work correctly.
const twilioWebhookMiddleware = twilio.webhook(config.twilioAuthToken, { url: `${config.publicUrl}/twilio` });

// Apply validation middleware to all routes handled by twilioRoutes
app.use('/twilio', twilioWebhookMiddleware, twilioRoutes);

// API routes
app.use('/api/v1', apiRoutes);

// Global Error Handler for API routes
app.use((err, req, res, next) => {
    console.error(err.stack);
    // Avoid sending error details in production for security
    const message = config.isProduction ? 'An internal server error occurred.' : err.message;
    const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ error: message });
});

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