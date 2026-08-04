const express = require('express');
const twilio = require('twilio');
const Conversation = require('../models/Conversation');
const Setting = require('../models/Setting');
const config = require('../config');

const router = express.Router();

// Main entry point for incoming calls.
router.post('/voice', async (req, res, next) => {
    let appSettings;
    try {
        const settings = await Setting.find({ key: { $in: ['my_phone_number', 'call_timeout'] } });
        appSettings = settings.reduce((acc, setting) => {
            acc[setting.key] = setting.value;
            return acc;
        }, {});
    } catch (error) {
        console.error("Error fetching settings from DB:", error);
        return next(error);
    }

    const { CallSid, From } = req.body;
    console.log(`Incoming call from: ${From} (SID: ${CallSid}). Forwarding to personal number.`);

    try {
        await Conversation.create({
            callSid: CallSid,
            caller_number: From,
            status: 'in-progress'
        });
        console.log(`Created conversation record for ${CallSid}.`);
    } catch (error) {
        console.error(`Error creating conversation record for ${CallSid}:`, error);
    }

    const myPhoneNumber = appSettings.my_phone_number || config.myPhoneNumber;
    const callTimeout = appSettings.call_timeout || config.callTimeout;

    const twiml = new twilio.twiml.VoiceResponse();
    const dial = twiml.dial({
        callerId: req.body.From,
        timeout: callTimeout,
        action: '/twilio/handle-no-answer',
        method: 'POST',
        record: 'record-from-answer',
        recordingStatusCallback: '/twilio/handle-recording',
    });
    dial.number({ statusCallback: '/twilio/handle-dial-status', statusCallbackEvent: 'completed' }, myPhoneNumber);

    res.type('text/xml');
    res.send(twiml.toString());
    console.log('Generated TwiML for dialing personal number.');
});

// Fallback handler if the personal number isn't answered.
router.post('/handle-no-answer', async (req, res) => {
    const callSid = req.body.CallSid;
    console.log(`Call ${callSid} not answered. Engaging AI assistant.`);

    try {
        await Conversation.findOneAndUpdate({ callSid: callSid }, { status: 'ai_handled' });
    } catch (error) {
        console.error(`Error updating conversation status for ${callSid}:`, error);
    }

    const twiml = new twilio.twiml.VoiceResponse();
    const settings = await Setting.find({ key: { $in: ['ai_prompt', 'ai_greeting', 'ai_voice'] } });
    const appSettings = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
    }, {});

    const initialPrompt = appSettings.ai_prompt || "You are a helpful AI assistant. Your goal is to take a message.";
    const greeting = appSettings.ai_greeting || "Hello, you've reached the AI assistant. Please state your name and the reason for your call after the beep.";
    const voice = appSettings.ai_voice || 'Polly.Amy';
    console.log("Using AI prompt:", initialPrompt.substring(0, 50) + "...");

    twiml.say({ voice: voice }, greeting);

    const connect = twiml.connect({ action: '/twilio/handle-call-status', method: 'POST' });
    const stream = connect.stream({
        url: `wss://${req.headers.host}/`,
        track: 'inbound_track'
    });
    stream.parameter({ name: 'encoding', value: 'audio/mulaw' });
    stream.parameter({ name: 'initialPrompt', value: initialPrompt });
    stream.parameter({ name: 'callSid', value: callSid });
    stream.parameter({ name: 'aiVoice', value: voice }); // Pass the selected voice to the WebSocket

    res.type('text/xml');
    res.send(twiml.toString());
    console.log(`Generated TwiML for WebSocket stream for call ${callSid}.`);
});

// This webhook is called by Twilio when the call to your personal number ends.
router.post('/handle-dial-status', async (req, res) => {
    const { CallSid, DialCallStatus } = req.body;
    console.log(`Dial status for ${CallSid}: ${DialCallStatus}`);

    let finalStatus = 'missed';
    if (DialCallStatus === 'completed') {
        finalStatus = 'completed';
    } else if (['busy', 'no-answer', 'failed', 'canceled'].includes(DialCallStatus)) {
        console.log(`Call ${CallSid} was not completed, will be handled by AI.`);
        return res.status(200).send();
    }

    try {
        await Conversation.findOneAndUpdate(
            { callSid: CallSid },
            {
                status: finalStatus,
                end_time: new Date(),
                $set: { duration_seconds: parseInt(req.body.DialCallDuration, 10) || 0 }
            }
        );
    } catch (error) {
        console.error(`Error updating final dial status for ${CallSid}:`, error);
    }

    res.status(200).send();
});

// This webhook receives the final status of the entire call, especially after the AI part.
router.post('/handle-call-status', async (req, res) => {
    const { CallSid, CallStatus, CallDuration } = req.body;
    console.log(`Final call status for ${CallSid}: ${CallStatus}`);

    try {
        await Conversation.findOneAndUpdate(
            { callSid: CallSid, status: 'ai_handled' },
            { end_time: new Date(), duration_seconds: parseInt(CallDuration, 10) }
        );
    } catch (error) {
        console.error(`Error in final call status webhook for ${CallSid}:`, error);
    }
    res.status(200).send();
});

module.exports = router;