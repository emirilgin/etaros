'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const _sdk      = require('@anthropic-ai/sdk');
const Anthropic = _sdk.default ?? _sdk.Anthropic ?? _sdk;

const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const api    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app    = express();

// ─── JSON file database (no native deps, works everywhere) ────────────────────
const DB_FILE = path.join(__dirname, 'sidekick-data.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { licenses: {}, usage: {}, freeTotal: {} }; }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ─── Tier limits ──────────────────────────────────────────────────────────────
const FREE_TOTAL = 5;
const PRO_LIMIT  = 50;

// ─── License helpers ──────────────────────────────────────────────────────────
function getLicense(key) {
  if (!key) return null;
  const lic = readDB().licenses[key];
  return lic?.isActive ? lic : null;
}

function generateKey() {
  // Format: SIDE-XXXX-XXXX-XXXX
  const seg = () => Math.random().toString(36).toUpperCase().slice(2,6).padEnd(4,'X');
  return `SIDE-${seg()}-${seg()}-${seg()}`;
}

// ─── Usage helpers ────────────────────────────────────────────────────────────
function getToday() {
  return new Date().toISOString().slice(0,10);
}

function getFreeTotal(deviceId) {
  return readDB().freeTotal[deviceId] || 0;
}

function bumpFreeTotal(deviceId) {
  const data = readDB();
  data.freeTotal[deviceId] = (data.freeTotal[deviceId] || 0) + 1;
  writeDB(data);
  return data.freeTotal[deviceId];
}

function getDailyUsage(deviceId, date) {
  return readDB().usage[`${deviceId}:${date}`] || 0;
}

function bumpDailyUsage(deviceId, date) {
  const data = readDB();
  const key  = `${deviceId}:${date}`;
  data.usage[key] = (data.usage[key] || 0) + 1;
  writeDB(data);
  return data.usage[key];
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());

// Stripe webhook needs raw body — must come before json middleware
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json({ limit: '4mb' })); // screenshots can be big

// ─── POST /api/validate ───────────────────────────────────────────────────────
// Called by the app on launch to check tier + usage
app.post('/api/validate', (req, res) => {
  const { licenseKey, deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

  const lic = getLicense(licenseKey);

  if (lic?.tier === 'max') {
    return res.json({ tier: 'max', used: 0, limit: Infinity });
  }

  if (lic?.tier === 'pro') {
    const today = getToday();
    const used  = getDailyUsage(deviceId, today);
    return res.json({ tier: 'pro', used, limit: PRO_LIMIT });
  }

  // Free trial
  const used = getFreeTotal(deviceId);
  return res.json({ tier: 'free', used, limit: FREE_TOTAL, remaining: FREE_TOTAL - used });
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────
// Validates license, calls Claude, streams NDJSON back
app.post('/api/chat', async (req, res) => {
  const { licenseKey, deviceId, systemPrompt, messages } = req.body;

  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
  if (!messages?.length) return res.status(400).json({ error: 'messages required' });

  const lic   = getLicense(licenseKey);
  const today = getToday();

  // ── Tier check ──
  let tier, used, limit, model;

  if (lic?.tier === 'max') {
    tier  = 'max';
    used  = 0;
    limit = Infinity;
    model = process.env.MAX_MODEL || 'claude-sonnet-4-20250514';
  } else if (lic?.tier === 'pro') {
    used  = getDailyUsage(deviceId, today);
    limit = PRO_LIMIT;
    if (used >= limit) {
      return res.status(429).json({ error: `Pro limit reached (${limit}/day). Resets at midnight.`, tier: 'pro', used, limit });
    }
    tier  = 'pro';
    model = process.env.PRO_MODEL || 'claude-sonnet-4-20250514';
  } else {
    used  = getFreeTotal(deviceId);
    limit = FREE_TOTAL;
    if (used >= limit) {
      return res.status(429).json({ error: 'Free trial used up. Upgrade to Pro or Max in Settings.', tier: 'free', used, limit });
    }
    tier  = 'free';
    model = process.env.FREE_MODEL || 'claude-haiku-4-20251001';
  }

  // ── Set up SSE / NDJSON streaming ──
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');

  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  try {
    // Build Anthropic message array (convert our internal format)
    const apiMessages = messages.map(m => {
      if (m._b64) {
        return {
          role: m.role,
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m._b64 } },
            { type: 'text',  text: m.content },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    const stream = api.messages.stream({
      model,
      max_tokens: 2048,
      system:   systemPrompt || '',
      messages: apiMessages,
    });

    let full = '';
    stream.on('text', (chunk) => {
      full += chunk;
      send({ message: { content: chunk } }); // matches Ollama NDJSON format
    });

    await stream.finalMessage();

    // Bump usage AFTER successful response
    if (tier === 'pro') {
      used = bumpDailyUsage(deviceId, today);
    } else if (tier === 'free') {
      used = bumpFreeTotal(deviceId);
    }

    // Final NDJSON line with tier metadata (app reads this to update UI)
    send({ done: true, _tier: tier, _used: used, _limit: limit });
    res.end();

  } catch (err) {
    console.error('[chat]', err.message);
    send({ error: err.message });
    res.end();
  }
});

// ─── POST /api/checkout ───────────────────────────────────────────────────────
// Creates a Stripe Checkout session and returns the URL
app.post('/api/checkout', async (req, res) => {
  const { tier, email } = req.body; // tier: 'pro' | 'max'

  const priceId = tier === 'max'
    ? process.env.STRIPE_PRICE_MAX_MONTHLY
    : process.env.STRIPE_PRICE_PRO_MONTHLY;

  if (!priceId) return res.status(500).json({ error: 'Stripe price not configured' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || undefined,
      metadata: { tier },
      success_url: `${process.env.APP_URL}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.APP_URL}/checkout-cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Stripe webhook ───────────────────────────────────────────────────────────
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe webhook] signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const tier    = session.metadata?.tier || 'pro';
    const email   = session.customer_email || session.customer_details?.email;
    const subId   = session.subscription;

    const key  = generateKey();
    const data = readDB();
    data.licenses[key] = {
      email, tier, stripeSubId: subId,
      isActive: true, createdAt: new Date().toISOString(),
    };
    writeDB(data);

    console.log(`[stripe] New ${tier} license: ${key} → ${email}`);

    // Email the key
    if (email && process.env.RESEND_API_KEY) {
      await resend.emails.send({
        from:    process.env.EMAIL_FROM || 'Sidekick <noreply@example.com>',
        to:      email,
        subject: `Your Sidekick ${tier.charAt(0).toUpperCase() + tier.slice(1)} license key`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <h2 style="color:#CF6E3C;margin-bottom:8px">Welcome to Sidekick ${tier === 'max' ? 'Max' : 'Pro'} ✦</h2>
            <p style="color:#555;line-height:1.6">Here's your license key — paste it in <strong>Settings → License</strong>:</p>
            <div style="background:#1C1917;border-radius:10px;padding:18px 22px;margin:20px 0;text-align:center">
              <code style="font-size:20px;letter-spacing:.12em;color:#D98060;font-family:monospace">${key}</code>
            </div>
            <p style="color:#555;font-size:13px;line-height:1.6">
              ${tier === 'pro' ? '50 messages per day' : 'Unlimited messages'}, Claude-powered vision, auto-updating.
            </p>
            <p style="color:#888;font-size:12px;margin-top:24px">
              Questions? Reply to this email — we reply within a few hours.
            </p>
          </div>`,
      });
    }
  }

  // Handle subscription cancellation
  if (event.type === 'customer.subscription.deleted') {
    const subId = event.data.object.id;
    const data  = readDB();
    for (const [key, lic] of Object.entries(data.licenses)) {
      if (lic.stripeSubId === subId) { data.licenses[key].isActive = false; }
    }
    writeDB(data);
    console.log(`[stripe] Subscription cancelled: ${subId}`);
  }

  res.json({ received: true });
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sidekick server running on port ${PORT}`);
  console.log(`Model: free=${process.env.FREE_MODEL || 'claude-haiku-4-20251001'}, pro/max=${process.env.PRO_MODEL || 'claude-sonnet-4-20250514'}`);
});
