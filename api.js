const express = require('express');
const mongoose = require('mongoose');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Conversation = require('../models/Conversation');
const Setting = require('../models/Setting');
const config = require('../config');

const router = express.Router();

// GET /api/v1/conversations/stats
router.get('/conversations/stats', async (req, res, next) => {
    try {
        const total_calls = await Conversation.countDocuments();
        const ai_handled = await Conversation.countDocuments({ status: 'ai_handled' });

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const last_24h = await Conversation.countDocuments({ start_time: { $gte: twentyFourHoursAgo } });

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
        next(error);
    }
});

// GET /api/v1/conversations
router.get('/conversations', async (req, res, next) => {
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
        next(error);
    }
});

// GET /api/v1/conversations/:id
router.get('/conversations/:id', async (req, res, next) => {
    try {
        const conversation = await Conversation.findById(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json(conversation);
    } catch (error) {
        next(error);
    }
});

// GET /api/v1/settings
router.get('/settings', async (req, res, next) => {
    try {
        const settings = await Setting.find({});
        const settingsObj = settings.reduce((acc, setting) => {
            acc[setting.key] = setting.value;
            return acc;
        }, {});
        res.json(settingsObj);
    } catch (error) {
        next(error);
    }
});

// PUT /api/v1/settings
router.put('/settings', async (req, res, next) => {
    try {
        const settings = req.body;
        const updatePromises = Object.keys(settings).map(key => {
            return Setting.findOneAndUpdate(
                { key: key },
                { $set: { value: settings[key] } },
                { upsert: true, new: true }
            );
        });

        await Promise.all(updatePromises);
        res.status(200).json({ message: 'Settings updated successfully' });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/v1/settings/all - New endpoint to reset settings
router.delete('/settings/all', async (req, res, next) => {
    try {
        // Remove all dynamic settings from the database
        await Setting.deleteMany({});
        // In a real app, you might want to clear a config cache here
        res.status(200).json({ message: 'All settings reset to defaults.' });
    } catch (error) {
        next(error);
    }
});



// GET /api/v1/health/status
router.get('/health/status', async (req, res, next) => {
    const status = {
        database: { status: 'error', message: 'Not connected' },
        twilio: { status: 'error', message: 'Credentials not verified' },
        gemini: { status: 'error', message: 'API key not verified' },
    };

    if (mongoose.connection.readyState === 1) {
        status.database = { status: 'ok', message: 'Connected' };
    }

    try {
        const twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);
        const account = await twilioClient.api.v2010.accounts(config.twilioAccountSid).fetch();
        if (account.sid) {
            status.twilio = { status: 'ok', message: `Verified (Account: ${account.friendlyName})` };
        }
    } catch (error) { status.twilio.message = error.message; }

    try {
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        await model.countTokens("test");
        status.gemini = { status: 'ok', message: 'Verified' };
    } catch (error) { status.gemini.message = error.message; }

    const isOk = Object.values(status).every(s => s.status === 'ok');
    res.status(isOk ? 200 : 503).json(status);
});

module.exports = router;