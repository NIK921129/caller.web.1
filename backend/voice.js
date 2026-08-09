// voice.js — Twilio webhooks (TwiML conversation loop) + outbound calling / SMS
const express = require('express');
const twilio = require('twilio');
const { Call, getSettings } = require('./db');
const { generateReply, analyzeCall } = require('./ai');

const { VoiceResponse } = twilio.twiml;
const router = express.Router();

/* -------------------------- helpers -------------------------- */

function baseUrl(req, settings) {
  return (settings.publicUrl || process.env.PUBLIC_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
}

function digits(n = '') {
  return String(n).replace(/[^\d]/g, '');
}

function isListed(list = [], number = '') {
  const d = digits(number);
  return list.some((x) => d && digits(x) && d.endsWith(digits(x).slice(-8)));
}

function withinBusinessHours(settings) {
  if (!settings.businessHoursEnabled) return true;
  const now = new Date(Date.now() + (settings.timezoneOffsetMinutes || 0) * 60000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = (settings.businessHoursStart || '09:00').split(':').map(Number);
  const [eh, em] = (settings.businessHoursEnd || '18:00').split(':').map(Number);
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  return start <= end ? mins >= start && mins <= end : mins >= start || mins <= end;
}

function gather(vr, settings, url, prompt) {
  const g = vr.gather({
    input: 'speech',
    action: url,
    method: 'POST',
    speechTimeout: settings.speechTimeout || 'auto',
    language: settings.language || 'en-US',
    actionOnEmptyResult: true,
  });
  if (prompt) g.say({ voice: settings.voice, language: settings.language }, prompt);
  return g;
}

function twiml(res, vr) {
  res.type('text/xml').send(vr.toString());
}

function twilioClient(settings) {
  const sid = settings.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID;
  const token = settings.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials are not configured');
  return twilio(sid, token);
}

/* -------------------------- inbound call -------------------------- */

router.post('/incoming', async (req, res) => {
  const vr = new VoiceResponse();
  try {
    const settings = await getSettings();
    const { CallSid, From, To } = req.body;
    const url = baseUrl(req, settings);

    if (isListed(settings.blocklist, From)) {
      await Call.create({ callSid: CallSid, from: From, to: To, handledBy: 'blocked', status: 'blocked' });
      vr.reject();
      return twiml(res, vr);
    }

    const vip = isListed(settings.vipList, From);
    const afterHours = !withinBusinessHours(settings);
    let handledBy = 'ai';
    if (settings.mode === 'forward' || vip) handledBy = 'forward';
    if (afterHours) handledBy = 'voicemail';

    const call = await Call.findOneAndUpdate(
      { callSid: CallSid },
      { $setOnInsert: { callSid: CallSid, from: From, to: To, direction: 'inbound', handledBy, startedAt: new Date() } },
      { upsert: true, new: true }
    );

    if (settings.recordCalls) vr.record({ recordingStatusCallback: `${url}/api/voice/recording`, timeout: 0 });

    if (handledBy === 'forward' && settings.forwardToNumber) {
      vr.say({ voice: settings.voice, language: settings.language }, 'Connecting your call now.');
      const dial = vr.dial({ callerId: settings.twilioPhoneNumber || undefined, timeout: 25, action: `${url}/api/voice/dial-status` });
      dial.number(settings.forwardToNumber);
      return twiml(res, vr);
    }

    if (handledBy === 'voicemail') {
      vr.say({ voice: settings.voice, language: settings.language }, settings.afterHoursMessage);
      vr.record({ maxLength: 120, transcribe: false, recordingStatusCallback: `${url}/api/voice/recording` });
      vr.hangup();
      return twiml(res, vr);
    }

    call.turns.push({ role: 'assistant', text: settings.greeting });
    await call.save();
    gather(vr, settings, `${url}/api/voice/respond`, settings.greeting);
    vr.redirect(`${url}/api/voice/respond`);
    return twiml(res, vr);
  } catch (err) {
    console.error('[voice/incoming]', err.message);
    vr.say('Sorry, the assistant is unavailable right now. Please try again later.');
    vr.hangup();
    return twiml(res, vr);
  }
});

/* -------------------------- conversation turn -------------------------- */

router.post('/respond', async (req, res) => {
  const vr = new VoiceResponse();
  let settings;
  try {
    settings = await getSettings();
    const url = baseUrl(req, settings);
    const { CallSid, SpeechResult, Confidence } = req.body;
    const call = await Call.findOne({ callSid: CallSid });
    if (!call) {
      vr.hangup();
      return twiml(res, vr);
    }

    const said = (SpeechResult || '').trim();
    if (!said) {
      const empties = (call.turns || []).filter((t) => t.role === 'system' && t.text === 'no-input').length;
      if (empties >= 2) {
        vr.say({ voice: settings.voice, language: settings.language }, settings.closingMessage);
        vr.hangup();
        return twiml(res, vr);
      }
      call.turns.push({ role: 'system', text: 'no-input' });
      await call.save();
      gather(vr, settings, `${url}/api/voice/respond`, settings.fallbackMessage);
      return twiml(res, vr);
    }

    call.turns.push({ role: 'caller', text: said, confidence: Number(Confidence) || null });

    const turnCount = call.turns.filter((t) => t.role === 'caller').length;
    if (turnCount >= (settings.maxTurns || 12)) {
      call.turns.push({ role: 'assistant', text: settings.closingMessage });
      await call.save();
      vr.say({ voice: settings.voice, language: settings.language }, settings.closingMessage);
      if (settings.mode === 'ai_then_forward' && settings.forwardToNumber) {
        const dial = vr.dial({ callerId: settings.twilioPhoneNumber || undefined, timeout: 25 });
        dial.number(settings.forwardToNumber);
      } else {
        vr.hangup();
      }
      return twiml(res, vr);
    }

    const reply = await generateReply(settings, call, said);
    call.turns.push({ role: 'assistant', text: reply });
    await call.save();

    gather(vr, settings, `${url}/api/voice/respond`, reply);
    vr.redirect(`${url}/api/voice/respond`);
    return twiml(res, vr);
  } catch (err) {
    console.error('[voice/respond]', err.message);
    vr.say((settings && settings.fallbackMessage) || 'Sorry, something went wrong.');
    vr.hangup();
    return twiml(res, vr);
  }
});

/* -------------------------- status callbacks -------------------------- */

router.post('/dial-status', async (req, res) => {
  const vr = new VoiceResponse();
  const settings = await getSettings();
  const status = req.body.DialCallStatus;
  if (status !== 'completed' && status !== 'answered') {
    vr.say({ voice: settings.voice, language: settings.language }, settings.afterHoursMessage);
    vr.record({ maxLength: 120 });
  }
  vr.hangup();
  return twiml(res, vr);
});

router.post('/recording', async (req, res) => {
  try {
    await Call.findOneAndUpdate(
      { callSid: req.body.CallSid },
      { recordingUrl: req.body.RecordingUrl || '' }
    );
  } catch (e) {
    console.error('[voice/recording]', e.message);
  }
  res.sendStatus(204);
});

router.post('/status', async (req, res) => {
  res.sendStatus(204);
  try {
    const { CallSid, CallStatus, CallDuration } = req.body;
    const call = await Call.findOne({ callSid: CallSid });
    if (!call) return;
    call.status = CallStatus || call.status;
    call.durationSeconds = Number(CallDuration) || call.durationSeconds;
    call.transcript = (call.turns || [])
      .filter((t) => t.role !== 'system')
      .map((t) => `${t.role === 'caller' ? 'Caller' : 'Assistant'}: ${t.text}`)
      .join('\n');
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(CallStatus)) {
      call.endedAt = new Date();
    }
    await call.save();

    const settings = await getSettings();
    if (CallStatus === 'completed' && settings.autoAnalyze && call.transcript && !call.analyzedAt) {
      try {
        const analysis = await analyzeCall(settings, call);
        Object.assign(call, analysis, { analyzedAt: new Date() });
        await call.save();
      } catch (e) {
        console.error('[analyze]', e.message);
      }
    }

    if (CallStatus === 'completed' && settings.smsFollowUp && call.from) {
      try {
        await twilioClient(settings).messages.create({
          to: call.from,
          from: settings.twilioPhoneNumber,
          body: settings.smsFollowUpText,
        });
      } catch (e) {
        console.error('[sms]', e.message);
      }
    }
  } catch (err) {
    console.error('[voice/status]', err.message);
  }
});

/* -------------------------- outbound -------------------------- */

async function placeCall(settings, to, req, message) {
  const url = baseUrl(req, settings);
  const client = twilioClient(settings);
  const created = await client.calls.create({
    to,
    from: settings.twilioPhoneNumber,
    url: `${url}/api/voice/outbound?message=${encodeURIComponent(message || '')}`,
    statusCallback: `${url}/api/voice/status`,
    statusCallbackEvent: ['completed'],
    statusCallbackMethod: 'POST',
  });
  await Call.create({
    callSid: created.sid,
    direction: 'outbound',
    from: settings.twilioPhoneNumber,
    to,
    handledBy: 'ai',
    turns: message ? [{ role: 'assistant', text: message }] : [],
  });
  return created.sid;
}

router.post('/outbound', async (req, res) => {
  const vr = new VoiceResponse();
  const settings = await getSettings();
  const url = baseUrl(req, settings);
  const message = req.query.message || settings.greeting;
  gather(vr, settings, `${url}/api/voice/respond`, message);
  vr.redirect(`${url}/api/voice/respond`);
  return twiml(res, vr);
});

module.exports = { router, placeCall, twilioClient };
