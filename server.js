// Core Dependencies
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo');

// Local Modules
const config = require('./config');
const connectDB = require('./db');
const apiRoutes = require('./routes/api');
const twilioRoutes = require('./routes/twilio');
const authRoutes = require('./routes/auth');
const setupWebSocket = require('./services/websocket');
const { isAuthenticated } = require('./middleware/auth');
require('./services/passport');

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

// Session Middleware
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: config.mongoUri }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
        secure: config.isProduction, // Use secure cookies in production
        httpOnly: true,
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Twilio Webhook routes require the raw body for validation, so they must be defined
// before express.json() if it were to parse them. We will group them under a router.
// The validation middleware needs the server's public URL to work correctly.
const twilioWebhookMiddleware = twilio.webhook(config.twilioAuthToken, { url: `${config.publicUrl}/twilio` });

// Apply validation middleware to all routes handled by twilioRoutes
app.use('/twilio', twilioWebhookMiddleware, twilioRoutes);

// Auth routes
app.use('/auth', authRoutes); // Assuming authRoutes is correctly defined elsewhere

// API routes
app.use('/api/v1', isAuthenticated, apiRoutes); // Assuming isAuthenticated is correctly defined

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