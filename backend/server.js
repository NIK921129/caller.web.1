// server.js — API surface: auth, settings, calls, transcripts, analytics, templates
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { connectDB, Call, PromptTemplate, Settings, getSettings } = require('./db');
const { router: voiceRouter, placeCall, twilioClient } = require('./voice');
const { analyzeCall, askAboutCalls, testAi } = require('./ai');

const app = express();
const PORT = process.env.PORT || 8000;
const SECRET = process.env.SESSION_SECRET || 'change_me_please';

const allowed = (process.env.FRONTEND_URL || '*')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors((req, cb) => {
    const origin = req.header('Origin');
    const isAllowed = !origin || allowed.includes('*') || allowed.some((o) => origin.startsWith(o));
    cb(null, { origin: isAllowed });
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

/* ------------------------------ auth ------------------------------ */

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (
    username === (process.env.ADMIN_USERNAME || 'admin') &&
    password === process.env.ADMIN_PASSWORD &&
    process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign({ sub: username, role: 'admin' }, SECRET, { expiresIn: '7d' });
    return res.json({ token, username });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

/* ------------------------------ health ------------------------------ */

app.get('/api/health', async (_req, res) => {
  const { mongoose } = require('./db');
  const s = await getSettings().catch(() => null);
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    configured: {
      twilio: Boolean(s && s.twilioAccountSid && s.twilioAuthToken && s.twilioPhoneNumber),
      gemini: Boolean(s && s.geminiApiKey),
      exotel: Boolean(s && s.exotelAccountSid && s.exotelApiToken && s.exotelApiSubdomain),
      forwardNumber: Boolean(s && s.forwardToNumber),
    },
    time: new Date().toISOString(),
  });
});

/* ------------------------------ settings ------------------------------ */

const SECRET_FIELDS = ['twilioAuthToken', 'geminiApiKey', 'exotelApiToken'];

function maskSettings(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  delete o.__v;
  for (const f of SECRET_FIELDS) {
    o[`${f}Set`] = Boolean(o[f]);
    o[f] = o[f] ? `••••••••${String(o[f]).slice(-4)}` : '';
  }
  return o;
}

app.get('/api/settings', auth, async (_req, res) => {
  res.json(maskSettings(await getSettings()));
});

app.put('/api/settings', auth, async (req, res) => {
  const current = await getSettings();
  const body = { ...req.body };
  delete body._id;
  delete body.key;
  // Ignore masked/empty secret values so saved keys are never wiped by accident.
  for (const f of SECRET_FIELDS) {
    if (!body[f] || String(body[f]).includes('••')) delete body[f];
  }
  Object.assign(current, body);
  await current.save();
  res.json(maskSettings(current));
});

app.post('/api/settings/test', auth, async (_req, res) => {
  const s = await getSettings();
  const out = { twilio: null, exotel: null, gemini: null };
  try {
    const acc = await twilioClient(s).api.v2010.accounts(s.twilioAccountSid).fetch();
    out.twilio = { ok: true, friendlyName: acc.friendlyName, status: acc.status };
  } catch (e) {
    out.twilio = { ok: false, error: e.message };
  }
  try {
    const { exotelAccountSid, exotelApiToken, exotelApiSubdomain } = s;
    if (!exotelAccountSid || !exotelApiToken || !exotelApiSubdomain) throw new Error('Missing credentials');
    const url = `https://${exotelApiSubdomain}.exotel.com/v1/Accounts/${exotelAccountSid}`;
    const authHeader = `Basic ${Buffer.from(`${exotelAccountSid}:${exotelApiToken}`).toString('base64')}`;
    const exotelRes = await fetch(url, { headers: { Authorization: authHeader } }).then((r) => r.json());
    out.exotel = { ok: true, friendlyName: exotelRes.Account.Name, status: exotelRes.Account.Status };
  } catch (e) {
    out.exotel = { ok: false, error: e.message };
  }
  try {
    out.gemini = { ok: true, reply: await testAi(s) };
  } catch (e) {
    out.gemini = { ok: false, error: e.message };
  }
  res.json(out);
});

/** Webhook URLs to paste into the Twilio console. */
app.get('/api/settings/webhooks', auth, async (req, res) => {
  const s = await getSettings();
  const base = (s.publicUrl || process.env.PUBLIC_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
  res.json({
    voiceUrl: `${base}/api/voice/incoming`,
    statusCallback: `${base}/api/voice/status`,
    recordingCallback: `${base}/api/voice/recording`,
  });
});

/* ------------------------------ calls ------------------------------ */

app.get('/api/calls', auth, async (req, res) => {
  const { q, sentiment, handledBy, starred, from, limit = 50, page = 1 } = req.query;
  const filter = {};
  if (sentiment) filter.sentiment = sentiment;
  if (handledBy) filter.handledBy = handledBy;
  if (starred === 'true') filter.starred = true;
  if (from) filter.from = new RegExp(String(from).replace(/[^\d+]/g, ''), 'i');
  if (q) {
    const rx = new RegExp(String(q).slice(0, 80), 'i');
    filter.$or = [{ transcript: rx }, { summary: rx }, { from: rx }, { callerName: rx }, { intent: rx }, { tags: rx }];
  }
  const lim = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const [items, total] = await Promise.all([
    Call.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim),
    Call.countDocuments(filter),
  ]);
  res.json({ items, total, page: Number(page) || 1, limit: lim });
});

app.get('/api/calls/:id', auth, async (req, res) => {
  const call = await Call.findById(req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  res.json(call);
});

app.patch('/api/calls/:id', auth, async (req, res) => {
  const allowedFields = ['starred', 'tags', 'callerName', 'callbackNumber', 'summary', 'intent', 'sentiment', 'urgency'];
  const update = {};
  for (const f of allowedFields) if (f in req.body) update[f] = req.body[f];
  const call = await Call.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!call) return res.status(404).json({ error: 'Not found' });
  res.json(call);
});

app.delete('/api/calls/:id', auth, async (req, res) => {
  await Call.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/calls/:id/analyze', auth, async (req, res) => {
  try {
    const call = await Call.findById(req.params.id);
    if (!call) return res.status(404).json({ error: 'Not found' });
    const settings = await getSettings();
    if (!call.transcript) {
      call.transcript = (call.turns || [])
        .filter((t) => t.role !== 'system')
        .map((t) => `${t.role === 'caller' ? 'Caller' : 'Assistant'}: ${t.text}`)
        .join('\n');
    }
    Object.assign(call, await analyzeCall(settings, call), { analyzedAt: new Date() });
    await call.save();
    res.json(call);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/calls/export/csv', auth, async (_req, res) => {
  const calls = await Call.find().sort({ createdAt: -1 }).limit(2000);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['date', 'from', 'to', 'handledBy', 'status', 'duration', 'sentiment', 'urgency', 'leadScore', 'callerName', 'summary', 'transcript'];
  const rows = calls.map((c) =>
    [c.createdAt.toISOString(), c.from, c.to, c.handledBy, c.status, c.durationSeconds, c.sentiment, c.urgency, c.leadScore, c.callerName, c.summary, c.transcript].map(esc).join(',')
  );
  res.type('text/csv').attachment('calls.csv').send([head.join(','), ...rows].join('\n'));
});

/* ------------------------------ actions ------------------------------ */

app.post('/api/actions/call', auth, async (req, res) => {
  try {
    const { to, message } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Destination number required' });
    const settings = await getSettings();
    const sid = await placeCall(settings, to, req, message);
    res.json({ ok: true, sid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/actions/sms', auth, async (req, res) => {
  try {
    const { to, body } = req.body || {};
    const settings = await getSettings();
    const msg = await twilioClient(settings).messages.create({ to, from: settings.twilioPhoneNumber, body });
    res.json({ ok: true, sid: msg.sid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/actions/ask', auth, async (req, res) => {
  try {
    const settings = await getSettings();
    const calls = await Call.find().sort({ createdAt: -1 }).limit(60);
    res.json({ answer: await askAboutCalls(settings, String(req.body.question || ''), calls) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------ analytics ------------------------------ */

app.get('/api/analytics', auth, async (_req, res) => {
  const since = new Date(Date.now() - 29 * 86400000);
  const [total, today, calls] = await Promise.all([
    Call.countDocuments(),
    Call.countDocuments({ createdAt: { $gte: new Date(new Date().toDateString()) } }),
    Call.find({ createdAt: { $gte: since } }).select('createdAt durationSeconds sentiment handledBy leadScore intent'),
  ]);

  const byDay = {};
  const bySentiment = {};
  const byHandler = {};
  const byIntent = {};
  let duration = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const c of calls) {
    const day = c.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
    if (c.sentiment) bySentiment[c.sentiment] = (bySentiment[c.sentiment] || 0) + 1;
    if (c.handledBy) byHandler[c.handledBy] = (byHandler[c.handledBy] || 0) + 1;
    if (c.intent) byIntent[c.intent] = (byIntent[c.intent] || 0) + 1;
    duration += c.durationSeconds || 0;
    if (typeof c.leadScore === 'number') {
      scoreSum += c.leadScore;
      scoreCount += 1;
    }
  }

  res.json({
    total,
    today,
    last30: calls.length,
    avgDuration: calls.length ? Math.round(duration / calls.length) : 0,
    avgLeadScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
    byDay,
    bySentiment,
    byHandler,
    topIntents: Object.entries(byIntent).sort((a, b) => b[1] - a[1]).slice(0, 5),
  });
});

/* ------------------------------ prompt templates ------------------------------ */

app.get('/api/templates', auth, async (_req, res) => res.json(await PromptTemplate.find().sort({ createdAt: -1 })));

app.post('/api/templates', auth, async (req, res) => {
  const { name, systemPrompt, greeting, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.json(await PromptTemplate.create({ name, systemPrompt, greeting, notes }));
});

app.delete('/api/templates/:id', auth, async (req, res) => {
  await PromptTemplate.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

app.post('/api/templates/:id/apply', auth, async (req, res) => {
  const t = await PromptTemplate.findById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const s = await getSettings();
  if (t.systemPrompt) s.systemPrompt = t.systemPrompt;
  if (t.greeting) s.greeting = t.greeting;
  await s.save();
  res.json(maskSettings(s));
});

/* ------------------------------ twilio webhooks ------------------------------ */

app.use('/api/voice', voiceRouter);

app.get('/', (_req, res) => res.json({ service: 'AI Call Assistant API', docs: '/api/health' }));
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

connectDB()
  .then(() => Settings.init())
  .catch((e) => console.error('[db] connection failed:', e.message))
  .finally(() => app.listen(PORT, () => console.log(`[server] listening on ${PORT}`)));
