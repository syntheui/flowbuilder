# Flow Builder — deploying with a hidden AI key

The Groq key is no longer in `index.html`. It lives only in a tiny
serverless function (`api/feedback.js`) that runs on Vercel's servers,
reads the key from an environment variable, and proxies the grading
request. The browser never sees it.

## What changed

- `index.html` now calls `POST /api/feedback` instead of calling Groq
  directly. No key in the page source anymore.
- `api/feedback.js` is a Vercel serverless function that adds the
  `Authorization` header server-side using `process.env.GROQ_API_KEY`.
- Each visitor gets **one AI grading per mission (scenario)**. This is
  tracked in the browser's `localStorage`, so it survives page reloads
  but resets if they clear site data or switch browsers/devices — see
  "About the once-per-mission limit" below for what that does and
  doesn't protect against.

## Deploy steps

1. **Get a Groq key** (free): https://console.groq.com/keys
2. **Push this folder to a GitHub repo** (or use the Vercel CLI directly
   from this folder — `vercel` also works without git).
3. **Import the repo in Vercel** (https://vercel.com/new) — no build
   command needed, it's a static file plus one serverless function.
4. **Add the environment variable** in Vercel: Project → Settings →
   Environment Variables:
   - `GROQ_API_KEY` = your key (required)
   - `GROQ_BASE_URL` — optional, defaults to `https://api.groq.com/openai/v1`
   - `GROQ_MODEL` — optional, defaults to `openai/gpt-oss-120b`
5. **Redeploy** (Vercel needs a redeploy after adding env vars for them
   to take effect).

Locally, you can test with the Vercel CLI:
```
npm i -g vercel
cp .env.example .env   # fill in your real key
vercel dev
```

## About the once-per-mission limit

There's no login system here, so "one per mission" is enforced with
`localStorage` in the browser — it stops a normal user from spamming
the "Get AI feedback" button on one scenario, but a determined user
could clear their browser storage or open a private window to reset it.
That's a UX limit, not a security control.

`api/feedback.js` also includes a small in-memory per-IP rate limit
(40 requests/hour) as a coarse brake on scripted abuse of your Groq
quota. It's best-effort — it resets on cold starts and isn't shared
across concurrent function instances. If you want a real, robust
per-user or per-IP limit that survives restarts, add a small persistent
store like [Vercel KV](https://vercel.com/docs/storage/vercel-kv) or
[Upstash Redis](https://upstash.com/) and swap out the `hits` Map in
`api/feedback.js` for a call to it. Happy to wire that up if you want
it more airtight.
