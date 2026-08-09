// ai.js — Google Gemini helpers: live conversation replies + post-call analysis
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getModel(settings, overrides = {}) {
  const key = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini API key is not configured');
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: overrides.model || settings.aiModel || 'gemini-1.5-flash',
    generationConfig: {
      temperature: overrides.temperature ?? settings.temperature ?? 0.7,
      maxOutputTokens: overrides.maxOutputTokens ?? settings.maxOutputTokens ?? 220,
    },
  });
}

function buildHistory(turns = []) {
  return turns
    .filter((t) => t.role === 'caller' || t.role === 'assistant')
    .map((t) => ({
      role: t.role === 'caller' ? 'user' : 'model',
      parts: [{ text: t.text || '' }],
    }));
}

/** Generate the next spoken reply for a live call. */
async function generateReply(settings, call, callerText) {
  const model = getModel(settings);
  const context = [
    settings.systemPrompt,
    `Caller number: ${call.from || 'unknown'}.`,
    'Speak plainly, no markdown, no emojis, no lists. This text is read aloud by a phone voice.',
  ].join('\n');

  const chat = model.startChat({
    history: [
      { role: 'user', parts: [{ text: context }] },
      { role: 'model', parts: [{ text: 'Understood.' }] },
      ...buildHistory(call.turns),
    ],
  });

  const result = await chat.sendMessage(callerText);
  const text = (result.response.text() || '').trim();
  return text || settings.fallbackMessage;
}

function safeJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Analyse a finished call transcript. Returns a plain object of fields. */
async function analyzeCall(settings, call) {
  const transcript =
    call.transcript ||
    (call.turns || []).map((t) => `${t.role === 'caller' ? 'Caller' : 'Assistant'}: ${t.text}`).join('\n');

  if (!transcript.trim()) return { summary: 'No speech captured.', sentiment: 'unknown' };

  const model = getModel(settings, { maxOutputTokens: 900, temperature: 0.2 });
  const prompt = `${settings.analysisPrompt}

Reply with ONLY valid JSON using these keys:
{"summary":"","intent":"","sentiment":"positive|neutral|negative","urgency":"low|medium|high","actionItems":[""],"leadScore":0,"callerName":"","callbackNumber":"","tags":[""]}

Transcript:
${transcript}`;

  const result = await model.generateContent(prompt);
  const parsed = safeJson(result.response.text()) || {};

  return {
    summary: String(parsed.summary || '').slice(0, 4000),
    intent: String(parsed.intent || ''),
    sentiment: String(parsed.sentiment || 'neutral'),
    urgency: String(parsed.urgency || 'low'),
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String).slice(0, 20) : [],
    leadScore: Number.isFinite(Number(parsed.leadScore)) ? Math.max(0, Math.min(100, Number(parsed.leadScore))) : null,
    callerName: String(parsed.callerName || ''),
    callbackNumber: String(parsed.callbackNumber || ''),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 10) : [],
  };
}

/** Free-form ask over stored call data (used by the dashboard "Ask AI" box). */
async function askAboutCalls(settings, question, calls) {
  const model = getModel(settings, { maxOutputTokens: 700, temperature: 0.3 });
  const digest = calls
    .map(
      (c, i) =>
        `#${i + 1} ${new Date(c.createdAt).toISOString()} from ${c.from} (${c.sentiment || '-'}, score ${
          c.leadScore ?? '-'
        }): ${c.summary || (c.transcript || '').slice(0, 300)}`
    )
    .join('\n');
  const result = await model.generateContent(
    `You are an analyst for a phone assistant. Answer the question using only the call data below.\n\nCALLS:\n${digest}\n\nQUESTION: ${question}`
  );
  return (result.response.text() || '').trim();
}

/** Quick credential check used by the Settings screen. */
async function testAi(settings) {
  const model = getModel(settings, { maxOutputTokens: 20 });
  const r = await model.generateContent('Reply with the single word: ok');
  return (r.response.text() || '').trim();
}

module.exports = { generateReply, analyzeCall, askAboutCalls, testAi };
