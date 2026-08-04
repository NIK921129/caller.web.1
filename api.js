const express = require('express');
const Conversation = require('../models/Conversation');
const Setting = require('../models/Setting');

const router = express.Router();

// GET /api/v1/conversations/stats
router.get('/conversations/stats', async (req, res) => {
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
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// GET /api/v1/conversations
router.get('/conversations', async (req, res) => {
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
router.get('/conversations/:id', async (req, res) => {
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
router.get('/settings/prompt', async (req, res) => {
    try {
        const promptSetting = await Setting.findOne({ key: 'ai_prompt' });
        res.json({ prompt: promptSetting ? promptSetting.value : '' });
    } catch (error) {
        console.error('Error fetching prompt:', error);
        res.status(500).json({ error: 'Failed to fetch prompt' });
    }
});

// PUT /api/v1/settings/prompt
router.put('/settings/prompt', async (req, res) => {
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

module.exports = router;