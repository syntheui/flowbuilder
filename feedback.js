// /api/feedback.js
// Tiny serverless proxy so the Groq key never reaches the browser.
// Runs on Vercel's Node.js runtime. Reads secrets from environment
// variables set in the Vercel dashboard (Project -> Settings -> Environment
// Variables) — never commit real keys into this file or into git.
//
// Required env var:
//   GROQ_API_KEY     your Groq key
// Optional env vars:
//   GROQ_BASE_URL     defaults to https://api.groq.com/openai/v1
//   GROQ_MODEL        defaults to openai/gpt-oss-120b

const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// ---------------------------------------------------------------------
// Very lightweight best-effort abuse guard.
//
// This is an in-memory counter, so it resets whenever the serverless
// function cold-starts and isn't shared across concurrent instances.
// It is NOT a substitute for the per-mission limit — that's enforced
// in the browser (see index.html, usedMissions in localStorage) because
// this app has no login/session to key a real per-user limit off of.
// Treat this only as a coarse brake on runaway/scripted abuse of your
// Groq quota. For a real distributed limit, swap this for Upstash
// Redis or Vercel KV.
// ---------------------------------------------------------------------
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 40;
const hits = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    res.status(503).json({ error: 'AI feedback isn\u2019t configured for this deployment.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests right now — please try again later.' });
    return;
  }

  const { systemPrompt, userPrompt, jsonMode, temperature, maxTokens } = req.body || {};
  if (!systemPrompt || !userPrompt) {
    res.status(400).json({ error: 'Missing systemPrompt or userPrompt.' });
    return;
  }

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: String(systemPrompt).slice(0, 8000) },
      { role: 'user', content: String(userPrompt).slice(0, 8000) }
    ],
    temperature: typeof temperature === 'number' ? temperature : 0.4,
    max_tokens: typeof maxTokens === 'number' ? Math.min(maxTokens, 1000) : 700
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  try {
    const groqRes = await fetch(GROQ_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify(body)
    });

    const data = await groqRes.json().catch(() => null);

    if (!groqRes.ok) {
      const msg = data?.error?.message || `Request failed (${groqRes.status})`;
      res.status(groqRes.status).json({ error: msg });
      return;
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      res.status(502).json({ error: 'Empty response from the model.' });
      return;
    }

    res.status(200).json({ text });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the AI provider.' });
  }
};
