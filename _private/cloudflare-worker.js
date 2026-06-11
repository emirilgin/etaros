/**
 * Etaros demo proxy — Cloudflare Worker
 * Hides the Groq key + rate-limits visitors. Frontend calls THIS, never Groq directly.
 *
 * SETUP (all in the Cloudflare dashboard, no CLI):
 * 1. dash.cloudflare.com → Workers & Pages → Create → Worker → name it "etaros-demo" → Deploy
 * 2. Edit code → paste this whole file → Deploy
 * 3. Settings → Variables → add Secret:  GROQ_KEY = gsk_...your key...
 * 4. Storage & Databases → KV → Create namespace "etaros_rl"
 *    → back in the Worker → Settings → Bindings → add KV binding:  Variable name RL  →  namespace etaros_rl
 * 5. Copy your worker URL (https://etaros-demo.<you>.workers.dev) → give it to me
 *
 * Limit: DAILY_LIMIT requests per visitor IP per day.
 */

const DAILY_LIMIT = 8;
const ALLOWED_ORIGIN = '*'; // tighten to 'https://emirilgin.github.io' once live

const SYSTEM = `You are Etaros, a cybersecurity AI. Analyze what the user gives you for phishing, scams, fraud, or security threats. Be direct and concise. Start with a one-line verdict: SAFE, SUSPICIOUS, or DANGEROUS — then 2-4 short bullet points on why and what to do.`;

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')   return json({ error: 'POST only' }, 405, cors);

    // ── rate limit by IP per day ──
    const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
    const day = new Date().toISOString().slice(0, 10);
    const key = `${ip}:${day}`;
    let count = 0;
    if (env.RL) {
      count = parseInt(await env.RL.get(key) || '0', 10);
      if (count >= DAILY_LIMIT) {
        return json({ error: `Demo limit reached (${DAILY_LIMIT}/day). Download the app for unlimited checks.` }, 429, cors);
      }
    }

    let input = '';
    try { input = (await request.json()).input?.toString().slice(0, 2000) || ''; } catch {}
    if (!input.trim()) return json({ error: 'No input' }, 400, cors);

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 600,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: input }],
      }),
    });
    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return json({ error: data?.error?.message || 'AI error' }, 502, cors);

    if (env.RL) await env.RL.put(key, String(count + 1), { expirationTtl: 172800 }); // 2 days

    return json({ reply }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
