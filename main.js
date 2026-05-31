'use strict';

const { init: sentryInit } = require('@sentry/electron/main');
sentryInit({
  dsn: 'https://e43ea3481b44b42aebfaf0723599733e@o4511469742391296.ingest.de.sentry.io/4511469748355152',
});

const {
  app, BrowserWindow, desktopCapturer, ipcMain,
  Tray, Menu, nativeImage, Notification, screen, globalShortcut, shell,
} = require('electron');
const path           = require('path');
const os             = require('os');
const { randomUUID } = require('crypto');
const Store          = require('electron-store');
const { autoUpdater } = require('electron-updater');

// Machine fingerprint — encrypts the store so users can't manually reset usage
function machineKey() {
  const seed = `${os.hostname()}-${(os.cpus()[0]?.model || 'cpu')}-${os.platform()}`;
  let h = 5381;
  for (const c of seed) { h = ((h << 5) + h) ^ c.charCodeAt(0); h = h >>> 0; }
  return h.toString(36).padStart(8, '0');
}

const _sdk      = require('@anthropic-ai/sdk');
const Anthropic = _sdk.default ?? _sdk.Anthropic ?? _sdk;

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Built-in API config ──────────────────────────────────────────────────────
// Loaded from app.config.js — baked into the app at build time.
// Users never see or configure this. AI just works on download.
let APP_CONFIG = { geminiKey: '', anthropicKey: '' };
try { APP_CONFIG = require('./app.config'); } catch { /* no config yet */ }

// ─── Constants ────────────────────────────────────────────────────────────────
const WINDOW_WIDTH    = 360;
const COLLAPSED_WIDTH = 48;
const DIFF_THRESHOLD  = 0.15;
const RETRY_MS        = 15_000;
const OLLAMA_BASE     = 'http://localhost:11434';

// Tier limits
const FREE_TOTAL = 15;  // beta: enough messages to properly evaluate the app
// Pro = unlimited daily — no cap. Max = unlimited + better model.

// ─── System prompts ───────────────────────────────────────────────────────────
// ─── Focus Modes ──────────────────────────────────────────────────────────────
// Each mode is a hyper-focused scan personality. Free users get Ghost only.
// Pro/Max unlock all 5.
const MODES = {
  ghost: {
    id: 'ghost', icon: '◉', name: 'Ghost', color: '#8b7fd4',
    tagline: 'Privacy & security guard',
    tier: 'free',
    prompt: `You are Sidekick in Ghost Mode — a silent cybersecurity guardian watching for privacy threats and security risks.

FOCUS EXCLUSIVELY ON:
- Phishing: look-alike domains (g00gle.com, paypa1.com), fake login pages, suspicious URLs
- Credential harvesting: password/2FA forms on HTTP or suspicious sites
- Dark patterns: fake urgency, hidden unsubscribe, pre-ticked data-consent boxes
- Data exposure: personal info entered on sketchy sites
- Tracking: sites pushing excessive permissions (location, microphone, contacts)
- Social engineering: too-good-to-be-true offers, fake tech support, fake prizes
- Malware: fake download buttons, bundled software warnings, suspicious installers
- Privacy violations: apps/sites collecting far more data than the task requires

BE SILENT on normal safe activity. Only flag genuine security/privacy risks.

Respond ONLY as valid JSON:
{"items":[{"type":"risk|warn|tip","title":"threat name under 8 words","detail":"exactly what is suspicious and why","action":"specific step to stay safe","notify":true,"query":null}],"summary":"one sharp threat assessment","context":"security"}

notify:true only for active phishing/attack/credential theft. Return {"items":[],"summary":"","context":"security"} when nothing suspicious.`,
  },

  vault: {
    id: 'vault', icon: '◈', name: 'Vault', color: '#5ab47a',
    tagline: 'Wealth guard',
    tier: 'pro',
    prompt: `You are Sidekick in Vault Mode — a financial bodyguard watching for anything threatening the user's money.

FOCUS EXCLUSIVELY ON:
- Subscription traps: auto-renewing charges, hard-to-cancel services, "free trial" converting to paid
- Hidden fees: surprise shipping, processing fees, taxes added late in checkout
- Overcharging: items priced above market rate — name the cheaper alternative + exact price
- Price manipulation: fake "was $X now $Y" discounts, fake scarcity, countdown timers
- Financial dark patterns: pre-ticked upsells, confusing refund policies, cancellation friction
- Better rates: if they're paying for something, flag if competitor is cheaper
- Impulsive spending triggers: "limited time", "only 2 left", FOMO — call them out
- Subscription fatigue: if multiple subscription pages visible, name the combined monthly cost

Respond ONLY as valid JSON:
{"items":[{"type":"save|warn|tip","title":"financial issue under 8 words","detail":"exact amounts, store names, prices — be specific","action":"concrete money-saving step","notify":false,"query":"search term for price comparison or null"}],"summary":"one sharp financial verdict","context":"finance"}

notify:true only for active financial scam or confirmed overcharge >$20. Return {"items":[],"summary":"","context":"finance"} when nothing notable.`,
  },

  bloom: {
    id: 'bloom', icon: '◇', name: 'Bloom', color: '#4db89e',
    tagline: 'Health coach',
    tier: 'pro',
    prompt: `You are Sidekick in Bloom Mode — a calm, honest health companion watching what the user eats, orders, and reads.

FOCUS EXCLUSIVELY ON:
- Food ordering: on UberEats/DoorDash/restaurant sites, give real calorie estimates, flag unhealthy choices
- Nutritional red flags: ultra-processed foods, excessive sugar/sodium/saturated fat — specific not preachy
- Healthier swaps: name a specific better alternative at the same restaurant
- Health misinformation: pseudoscience, miracle supplements, detox claims — call them out gently
- Wellness scams: overpriced supplements with no evidence, fake "doctor endorsed" products
- Positive reinforcement: if ordering something healthy, briefly acknowledge it
- Pattern spotting: frequently ordering from same unhealthy place, note the pattern

Be encouraging not lecturing. One actionable insight beats five warnings.

Respond ONLY as valid JSON:
{"items":[{"type":"rec|warn|tip","title":"health insight under 8 words","detail":"specific food, real calorie numbers, ingredients","action":"healthier alternative or next step","notify":false,"query":null}],"summary":"one warm health note","context":"health"}

Return {"items":[],"summary":"","context":"health"} when nothing health-relevant on screen.`,
  },

  flow: {
    id: 'flow', icon: '◌', name: 'Flow', color: '#d4a43e',
    tagline: 'Focus guard',
    tier: 'pro',
    prompt: `You are Sidekick in Flow Mode — a sharp productivity guardian keeping the user in deep work and out of distraction traps.

FOCUS EXCLUSIVELY ON:
- Distraction detection: Reddit, Twitter/X, YouTube, TikTok, Instagram, news sites during work
- Notification traps: sites pushing browser notification permissions, badge counts, red dots
- Content rabbit holes: "recommended" feeds, autoplay videos, comment sections
- Context switching: too many unrelated open tabs, task-jumping patterns
- Procrastination patterns: opening social media after a hard task, Wikipedia spirals
- Acknowledge good focus: if they're clearly working hard, a brief positive note is fine

Be brief and non-judgmental. One observation. Don't lecture.

Respond ONLY as valid JSON:
{"items":[{"type":"tip|warn","title":"focus note under 8 words","detail":"what you spotted and why it matters","action":"one concrete refocus step","notify":false,"query":null}],"summary":"one sharp focus note","context":"productivity"}

Return {"items":[],"summary":"","context":"productivity"} when user appears focused on productive work.`,
  },

  hawk: {
    id: 'hawk', icon: '◆', name: 'Hawk', color: '#d4703e',
    tagline: 'Deal hunter',
    tier: 'pro',
    prompt: `You are Sidekick in Hawk Mode — a razor-sharp deal hunter watching for savings and price intelligence.

FOCUS EXCLUSIVELY ON:
- Live price comparison: when shopping, is this item cheaper elsewhere RIGHT NOW? Name store + price
- Coupon codes: actively suggest working promo codes for the site/product visible
- Cashback: flag if retailer has cashback via TopCashback, Rakuten, Honey
- Price history: if price seems inflated, note "this typically sells for $X"
- Bundle deals: if buying separately, flag if bundle is better value
- Student/professional discounts: flag if applicable from context
- Timing: "this goes on sale every Black Friday" type intelligence
- Shipping: free shipping thresholds, click & collect savings

Be specific: "Buy on Amazon for $23 less" beats "try other stores."

Respond ONLY as valid JSON:
{"items":[{"type":"save|tip","title":"deal insight under 8 words","detail":"exact price, store name, savings amount","action":"direct next step to save","notify":false,"query":"best search term to find it cheaper"}],"summary":"one sharp deal verdict","context":"shopping"}

Return {"items":[],"summary":"","context":"shopping"} when no shopping activity visible.`,
  },
};

function getActiveMode() {
  const id = String(store.get('activeMode') ?? 'ghost');
  return MODES[id] ?? MODES.ghost;
}

function getScanPrompt() {
  const mode = getActiveMode();
  const city = String(store.get('city') ?? '').trim();
  return mode.prompt + (city ? `\n\nUser location: ${city}.` : '');
}

const CHAT_PROMPT_BASE = `You are Sidekick — a sharp, witty AI companion who sees the user's screen in real time and remembers everything about them. You're like that brilliant friend who notices everything, knows your history, and tells it straight — direct, specific, occasionally funny, never boring.

Be direct and specific. Name real products, real prices, real restaurants, real alternatives. Don't hedge. Lead with what's most useful.

If they ask about food: give real restaurant names, specific dishes, honest takes. Use their city if you know it.
If they ask about shopping: give real prices, real competitors, actual coupon codes if you know them.
If you know something relevant about them (city, diet, budget, job, goals) — use it naturally without announcing it.
If you spot something on screen worth flagging: call it out naturally.
If they want to chat: be warm, engaging, human. You know them.

Use markdown for structure when helpful. Go deep when asked. Keep it conversational.`;

function CHAT_PROMPT() {
  return CHAT_PROMPT_BASE + buildMemoryContext();
}

// ─── Store (encrypted — machine-specific key prevents manual resets) ──────────
const store = new Store({ encryptionKey: machineKey() });

// ─── Memory system ────────────────────────────────────────────────────────────
// Persistent facts about the user — injected into every AI call.
// Structure: [{ key, value, type, updated }]

const MEMORY_MAX = 80; // max facts stored

function getMemory() {
  return Array.isArray(store.get('memory')) ? store.get('memory') : [];
}

function saveMemory(facts) {
  store.set('memory', facts);
}

function upsertFacts(newFacts) {
  if (!Array.isArray(newFacts) || !newFacts.length) return;
  const mem = getMemory();
  for (const f of newFacts) {
    if (!f.key || !f.value) continue;
    const key = String(f.key).toLowerCase().trim().replace(/\s+/g, '_');
    const idx = mem.findIndex(m => m.key === key);
    const entry = { key, value: String(f.value).slice(0, 200), type: f.type || 'personal', updated: Date.now() };
    if (idx >= 0) mem[idx] = entry;
    else mem.unshift(entry);
  }
  // Keep most recently updated, cap at MEMORY_MAX
  mem.sort((a, b) => b.updated - a.updated);
  saveMemory(mem.slice(0, MEMORY_MAX));
}

function buildMemoryContext() {
  const mem = getMemory();
  if (!mem.length) return '';
  const lines = mem.slice(0, 30).map(f => `- ${f.key.replace(/_/g,' ')}: ${f.value}`).join('\n');
  return `\n\nWHAT YOU KNOW ABOUT THIS USER (use naturally, never recite):\n${lines}`;
}

// Extract facts from conversation in background (non-blocking, uses cheapest model)
async function extractAndLearn(userText, aiReply) {
  const geminiKey = getGeminiKey();
  if (!geminiKey) return;
  try {
    const genAI  = new GoogleGenerativeAI(geminiKey);
    const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    const prompt = `Extract personal facts about the user from this exchange.
User: ${String(userText).slice(0, 400)}
Assistant: ${String(aiReply).slice(0, 400)}

Return ONLY valid JSON (or {"learn":[]} if nothing new):
{"learn":[{"key":"fact_name","value":"fact value","type":"location|preference|goal|habit|personal|interest|finance|health"}]}

Rules:
- Only concrete facts explicitly stated by the user
- Keys: simple lowercase with underscores (city, job, diet, budget, hobby, age, etc.)
- Max 4 facts. Skip vague inferences.`;

    const result = await model.generateContent(prompt);
    const raw    = result.response.text();
    const m      = raw.match(/\{[\s\S]*\}/);
    if (!m) return;
    const parsed = JSON.parse(m[0]);
    if (Array.isArray(parsed.learn)) upsertFacts(parsed.learn);
  } catch {
    // Memory extraction is best-effort — never block the user
  }
}

// Journal: save a summary entry per day
function journalEntry(summary, context) {
  if (!summary) return;
  const today   = new Date().toISOString().slice(0, 10);
  const journal = Array.isArray(store.get('journal')) ? store.get('journal') : [];
  const entry   = { date: today, summary, context, ts: Date.now() };
  // Keep last 90 days, max 500 entries
  journal.unshift(entry);
  store.set('journal', journal.slice(0, 500));
}

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow     = null;
let settingsWindow = null;
let setupWindow    = null;
let tray           = null;
let scanTimer      = null;
let lastBitmap     = null;
let isStreaming    = false;
let retryTimer     = null;
let anthropic      = null;
let cachedKey      = '';
let chatHistory    = [];
let lastNotifyTime = 0;
const NOTIFY_COOLDOWN_MS = 5 * 60_000; // max 1 OS notification per 5 min

// ─── Tier system — HMAC-signed key validation ─────────────────────────────────
// Keys are signed at generation time using a secret in app.config.js.
// Format: PREFIX-R1-R2-C3 where C3 = first 4 hex of HMAC-SHA256(secret, R1+R2)
// Random guesses that match the prefix pattern will fail the checksum with >99.99% prob.
const { createHmac } = require('crypto');

function verifyKeyHmac(key) {
  const secret = APP_CONFIG.licenseSecret;
  if (!secret || secret === 'YOUR_64_CHAR_HEX_SECRET_HERE') {
    // No secret configured — fall through to pattern-only (dev/test mode)
    return true;
  }
  // Parse: PREFIX-R1-R2-C3
  const m = key.match(/^(SMAX|SIDE|STEST)-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})$/);
  if (!m) return false;
  const [, , r1, r2, given] = m;
  const expected = createHmac('sha256', secret)
    .update(r1 + r2)
    .digest('hex')
    .slice(0, 4)
    .toUpperCase();
  return given === expected;
}

function getTier() {
  if (APP_CONFIG.ownerMode) return 'max';  // dev/owner build — local only, never commit
  const key = String(store.get('licenseKey') ?? '').trim().toUpperCase();
  if (!key) return 'free';

  // Verify HMAC signature before accepting tier
  if (!verifyKeyHmac(key)) return 'free'; // failed signature = not a valid key

  if (/^SMAX-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key))  return 'max';
  if (/^SIDE-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key))  return 'pro';
  if (/^STEST-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key)) return 'max'; // beta tester
  return 'free';
}

function getFreeUsed()  { return Number(store.get('freeUsed') ?? 0); }
function bumpFreeUsed() { const n = getFreeUsed() + 1; store.set('freeUsed', n); return n; }

// Pro is now unlimited — no daily counter needed, but we track for display
function getProUsed() { return Number(store.get('proUsed') ?? 0); }
function bumpProUsed() { const n = getProUsed() + 1; store.set('proUsed', n); return n; }

function getLicenseInfo() {
  const tier = getTier();
  if (tier === 'max') return { tier, used: 0,            limit: 0          };
  if (tier === 'pro') return { tier, used: getProUsed(), limit: 0          }; // 0 limit = unlimited
  return                     { tier, used: getFreeUsed(), limit: FREE_TOTAL };
}

// ─── Notifications ────────────────────────────────────────────────────────────
function fireNotification(title, body) {
  const now = Date.now();
  if (now - lastNotifyTime < NOTIFY_COOLDOWN_MS) return;
  if (!Notification.isSupported()) return;
  lastNotifyTime = now;
  try {
    const n = new Notification({
      title:    'Sidekick',
      subtitle: title,             // macOS: shows under title
      body:     String(body || '').slice(0, 160),
      silent:   false,             // plays system notification sound
    });
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    n.show();
  } catch (e) {
    console.warn('[notify]', e.message);
  }
}

// ─── Window modes ─────────────────────────────────────────────────────────────
function fullscreenBounds() {
  const d = screen.getPrimaryDisplay();
  const w = Math.min(1180, d.bounds.width  - 80);
  const h = Math.min(840,  d.bounds.height - 60);
  return {
    x: d.bounds.x + Math.round((d.bounds.width  - w) / 2),
    y: d.bounds.y + Math.round((d.bounds.height - h) / 2),
    width: w, height: h,
  };
}

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  store.set('windowMode', mode);
  if (mode === 'fullscreen') {
    mainWindow.setResizable(true);
    mainWindow.setMovable(true);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setBounds(fullscreenBounds(), true);
  } else {
    const collapsed = mode === 'collapsed';
    mainWindow.setResizable(false);
    mainWindow.setMovable(false);
    mainWindow.setBounds(dockedBounds(collapsed), true);
    if (process.platform === 'darwin') mainWindow.setAlwaysOnTop(true, 'screen-saver');
    else mainWindow.setAlwaysOnTop(true);
  }
  push('mode-changed', { mode });
}

// ─── Clients ──────────────────────────────────────────────────────────────────
function getAnthropicClient() {
  const key = String(store.get('apiKey') ?? '').trim() || APP_CONFIG.anthropicKey;
  if (!key) return null;
  if (!anthropic || cachedKey !== key) {
    anthropic = new Anthropic({ apiKey: key });
    cachedKey = key;
  }
  return anthropic;
}

function getGeminiKey() {
  return String(store.get('geminiKey') ?? '').trim() || APP_CONFIG.geminiKey;
}

// ─── Screen capture ───────────────────────────────────────────────────────────
async function captureScreen() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'], thumbnailSize: { width: 1920, height: 1080 },
    });
    if (!sources?.length) {
      push('error', { message: 'Screen access denied. Go to System Settings → Privacy & Security → Screen Recording → enable Sidekick.' });
      return null;
    }
    return sources[0].thumbnail;
  } catch (err) {
    console.error('[capture]', err.message);
    return null;
  }
}

// ─── Pixel diff ───────────────────────────────────────────────────────────────
function pixelDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let changed = 0;
  const total = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 30) changed++;
  }
  return changed / total;
}

function thumbToB64(thumbnail) {
  return thumbnail.resize({ width: 1280, quality: 'better' }).toJPEG(75).toString('base64');
}

// ─── History formatters ───────────────────────────────────────────────────────
function historyForClaude(history) {
  return history.map(m => {
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
}

function historyForOllama(history) {
  return history.map(m => {
    if (m._b64) return { role: m.role, content: m.content, images: [m._b64] };
    return { role: m.role, content: m.content };
  });
}

// ─── Stream: Gemini (free, default for everyone) ─────────────────────────────
// Uses Google's free API — no credit card needed, 1500 req/day free.
// This is what powers the app out of the box.
// Tries gemini-2.0-flash first, falls back to gemini-1.5-flash on quota errors.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-lite-latest'];

async function streamGeminiWithModel(modelName, key, systemPrompt, history) {
  const genai = new GoogleGenerativeAI(key);
  const model = genai.getGenerativeModel({
    model:             modelName,
    systemInstruction: systemPrompt,
  });

  const geminiHistory = history.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: m._b64
      ? [{ inlineData: { mimeType: 'image/jpeg', data: m._b64 } }, { text: m.content }]
      : [{ text: m.content }],
  }));

  const last      = history[history.length - 1];
  const lastParts = last._b64
    ? [{ inlineData: { mimeType: 'image/jpeg', data: last._b64 } }, { text: last.content }]
    : [{ text: last.content }];

  const chat   = model.startChat({ history: geminiHistory });
  const result = await chat.sendMessageStream(lastParts);

  let full = '';
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) { full += text; push('stream-chunk', { content: text }); }
  }
  return full;
}

async function streamGemini(systemPrompt, history) {
  const key = getGeminiKey();
  if (!key) throw new Error('No AI key set. Open Settings → AI → paste your free Gemini key from aistudio.google.com → Save. Only need to do this once.');

  let lastErr;
  for (const modelName of GEMINI_MODELS) {
    try {
      return await streamGeminiWithModel(modelName, key, systemPrompt, history);
    } catch (err) {
      const msg = String(err.message ?? '');
      const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
      if (is429) {
        // Extract retry delay if available
        const retryMatch = msg.match(/retry[^0-9]*(\d+)[^0-9]/i);
        const retrySecs  = retryMatch ? parseInt(retryMatch[1]) : null;
        console.warn(`[gemini] ${modelName} quota hit, trying next model…`);
        lastErr = err;
        continue; // try next model
      }
      // Non-quota error — surface it immediately with a clean message
      const clean = msg.includes('API key') || msg.includes('API_KEY') || msg.includes('INVALID_ARGUMENT')
                  ? 'Gemini key invalid. Open Settings → AI → paste your key from aistudio.google.com → Save.'
                  : msg.split('\n')[0]; // first line only — strip the giant JSON
      throw new Error(clean);
    }
  }

  // All models exhausted — quota hit across the board
  // Keys do NOT expire — this is daily quota (resets at midnight Pacific)
  // User does NOT need a new key, just wait or use their own key
  throw new Error('Daily AI quota reached — resets at midnight. Your key is still valid.\n\nTip: paste your own free Gemini key in Settings → AI to get a higher personal quota (takes 30 seconds at aistudio.google.com).');
}

// ─── Stream: Claude (optional, for Pro/Max if Anthropic key is set) ───────────
async function streamClaude(systemPrompt, history) {
  const client = getAnthropicClient();
  if (!client) throw new Error('No Anthropic key configured.');

  let full = '';
  const stream = client.messages.stream({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system:     systemPrompt,
    messages:   historyForClaude(history),
  });
  stream.on('text', text => { full += text; push('stream-chunk', { content: text }); });
  await stream.finalMessage();
  return full;
}

// ─── Pick the right AI for this request ──────────────────────────────────────
async function streamAI(systemPrompt, history) {
  const provider = String(store.get('provider') || 'builtin');
  if (provider === 'ollama') return streamOllama(systemPrompt, history);

  // For Pro/Max: use Claude if an Anthropic key is available (better quality)
  // Fall back to Gemini if no Anthropic key is set
  const tier = getTier();
  if ((tier === 'pro' || tier === 'max') && getAnthropicClient()) {
    return streamClaude(systemPrompt, history);
  }

  // Default: Gemini (free, works for everyone)
  return streamGemini(systemPrompt, history);
}

// ─── Stream: Ollama (local, developer option) ─────────────────────────────────
async function streamOllama(systemPrompt, history) {
  const model    = String(store.get('ollamaModel') || 'llava');
  const messages = [
    { role: 'system', content: systemPrompt },
    ...historyForOllama(history),
  ];

  let res;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(120_000),
      body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0.7 } }),
    });
  } catch (err) {
    throw new Error('Ollama is not running. Start it with: ollama serve');
  }

  if (!res.ok) throw new Error(`Ollama error ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
      try {
        const data  = JSON.parse(line);
        const chunk = data.message?.content ?? '';
        if (chunk) { full += chunk; push('stream-chunk', { content: chunk }); }
      } catch { /* partial line */ }
    }
  }
  return full;
}

// ─── Core: check limits before sending ───────────────────────────────────────
function checkLimits() {
  const tier = getTier();
  if (tier === 'max') return null; // unlimited
  if (tier === 'pro') return null; // unlimited
  if (tier === 'free' && getFreeUsed() >= FREE_TOTAL) return 'free';
  return null; // ok
}

function bumpUsage() {
  const tier = getTier();
  if (tier === 'pro')  return { tier, used: bumpProUsed(), limit: 0 };         // 0 = unlimited
  if (tier === 'free') return { tier, used: bumpFreeUsed(), limit: FREE_TOTAL };
  return                      { tier: 'max', used: 0, limit: 0 };
}

// ─── Core: send a chat message ────────────────────────────────────────────────
async function chat(userText, thumbnail) {
  if (isStreaming) return;
  isStreaming = true;

  // Check limits
  const limitHit = checkLimits();
  if (limitHit) {
    const info = getLicenseInfo();
    push('upgrade-prompt', info);
    isStreaming = false;
    return;
  }

  const b64 = thumbnail ? thumbToB64(thumbnail) : null;
  chatHistory.push({ role: 'user', content: userText, _b64: b64 });

  push('stream-start', {});

  try {
    const reply = await streamAI(CHAT_PROMPT(), chatHistory);
    chatHistory.push({ role: 'assistant', content: reply });

    // Extract facts from this exchange in background (non-blocking)
    extractAndLearn(userText, reply).catch(() => {});

    // Bump usage counter and send tier info back to renderer
    const usage = bumpUsage();
    push('stream-done', { _tier: usage.tier, _used: usage.used, _limit: usage.limit });

  } catch (err) {
    console.error('[chat]', err.message);
    push('stream-error', { message: err.message });
    chatHistory.pop();
  } finally {
    isStreaming = false;
  }
}

// ─── Core: proactive scan ─────────────────────────────────────────────────────
async function proactiveScan(thumbnail) {
  if (isStreaming) return;

  // Silently skip if free user has hit their limit (don't nag)
  if (checkLimits() === 'free') return;

  push('scan-status', { scanning: true });

  try {
    const b64         = thumbToB64(thumbnail);
    const scanPrompt  = getScanPrompt();
    const userPrompt  = 'Analyse this screen. Respond ONLY with valid JSON.';
    const scanHistory = [{ role: 'user', content: userPrompt, _b64: b64 }];

    const raw = await streamAI(scanPrompt, scanHistory);

    let parsed = null;
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
    if (!parsed?.items?.length) return;

    // Save to journal
    journalEntry(parsed.summary, parsed.context);

    // Fire OS notification ONLY for active risk/warn items explicitly marked notify:true
    const notifyItems = parsed.items.filter(i => i.notify && (i.type === 'risk' || i.type === 'warn'));
    if (notifyItems.length) {
      const top = notifyItems[0];
      fireNotification(top.title, top.detail || top.action || '');
    }

    chatHistory.push({
      role:    'assistant',
      content: `I noticed something: ${parsed.summary}\n\n${
        parsed.items.map(i => `**${i.title}**: ${i.detail}${i.action ? `\n→ ${i.action}` : ''}`).join('\n\n')
      }`,
    });

    // Track stats: scan count + threats caught
    const scans   = Number(store.get('statScans')   ?? 0) + 1;
    const threats = Number(store.get('statThreats') ?? 0)
      + parsed.items.filter(i => i.type === 'risk' || i.type === 'warn').length;
    store.set('statScans',   scans);
    store.set('statThreats', threats);
    push('stats-updated', getStats());

    push('analysis', parsed);

  } catch (err) {
    console.error('[scan]', err.message);
    push('error', { message: err.message });
    scheduleRetry(thumbnail);
  } finally {
    push('scan-status', { scanning: false });
  }
}

function scheduleRetry(thumb) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => proactiveScan(thumb), RETRY_MS);
}

// ─── Scan loop ────────────────────────────────────────────────────────────────
async function runScan() {
  const thumb = await captureScreen();
  if (!thumb) return;
  const small  = thumb.resize({ width: 160 });
  const bitmap = small.toBitmap();
  if (lastBitmap && pixelDiff(lastBitmap, bitmap) < DIFF_THRESHOLD) return;
  lastBitmap = bitmap;
  proactiveScan(thumb);
}

function startScanLoop() {
  stopScanLoop();
  const secs = Number(store.get('scanInterval') ?? 30);
  if (!secs) return;
  scanTimer = setInterval(runScan, secs * 1000);
}
function stopScanLoop() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function getStats() {
  const savings = (store.get('savings') ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return {
    threats: Number(store.get('statThreats') ?? 0),
    scans:   Number(store.get('statScans')   ?? 0),
    saved:   Math.round(savings * 100) / 100,
  };
}

// ─── Push to renderer ─────────────────────────────────────────────────────────
function push(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// ─── Ollama status ────────────────────────────────────────────────────────────
async function getOllamaStatus() {
  try {
    const res  = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const all    = (data.models ?? []).map(m => m.name);
    const vision = all.filter(n => /llava|vision|moondream|bakllava|minicpm/i.test(n));
    return { running: true, models: vision.length ? vision : all, allModels: all };
  } catch {
    return { running: false, models: [], allModels: [] };
  }
}

// ─── Windows ──────────────────────────────────────────────────────────────────
function dockedBounds(collapsed = false) {
  const d = screen.getPrimaryDisplay();
  const w = collapsed ? COLLAPSED_WIDTH : WINDOW_WIDTH;
  return { x: d.bounds.x + d.bounds.width - w, y: d.bounds.y, width: w, height: d.bounds.height };
}

function createMainWindow() {
  const saved = store.get('windowBounds', {});
  // Ignore saved bounds from old docked/narrow mode — always start fullscreen-ish
  const bounds = (saved.width && saved.width >= 700 && saved.height && saved.height >= 500)
    ? saved : fullscreenBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 700, minHeight: 500,
    frame: false, transparent: false,
    alwaysOnTop: Boolean(store.get('alwaysOnTop') ?? false),
    skipTaskbar: false, resizable: true, movable: true, hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  mainWindow.loadFile('index.html');
  // Persist window bounds
  const saveBounds = () => { if (!mainWindow.isDestroyed()) store.set('windowBounds', mainWindow.getBounds()); };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move',   saveBounds);
  // Close button hides to tray — doesn't quit
  mainWindow.on('close', e => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function openSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.focus(); return; }
  setupWindow = new BrowserWindow({
    width: 480, height: 520, frame: false, transparent: true,
    resizable: false, alwaysOnTop: true, center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  setupWindow.loadFile('setup.html');
  setupWindow.on('closed', () => { setupWindow = null; });
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 480, height: 660, frame: false, transparent: true,
    resizable: false, alwaysOnTop: true, center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  // Use built icon if available, else fallback to generated dot
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    const SIZE = 16;
    const buf  = Buffer.alloc(SIZE * SIZE * 4);
    const cx = 7.5, cy = 7.5, r = 6;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (Math.hypot(x - cx, y - cy) <= r) {
        buf[i]=212; buf[i+1]=112; buf[i+2]=62; buf[i+3]=255;
      }
    }
    trayIcon = nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: 1 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Sidekick');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Sidekick',  click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Hide Sidekick',  click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Settings',       click: openSettings },
    { type: 'separator' },
    { label: 'Quit Sidekick',  click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function registerIPC() {
  ipcMain.handle('get-settings', () => ({
    apiKey:        String(store.get('apiKey')       ?? ''),
    geminiKey:     String(store.get('geminiKey')    ?? ''),
    city:          String(store.get('city')         ?? ''),
    scanInterval:  Number(store.get('scanInterval') ?? 5),
    autoScan:      Boolean(store.get('autoScan')    ?? true),
    licenseKey:    String(store.get('licenseKey')   ?? ''),
    startOnLogin:  app.getLoginItemSettings().openAtLogin,
    provider:      String(store.get('provider')     ?? 'builtin'),
    ollamaModel:   String(store.get('ollamaModel')  ?? 'llava'),
    hasBuiltInKey: !!(APP_CONFIG.geminiKey || APP_CONFIG.anthropicKey),
  }));

  ipcMain.handle('save-settings', (_, s) => {
    if (s.apiKey       != null) { store.set('apiKey',       s.apiKey);      anthropic = null; cachedKey = ''; }
    if (s.geminiKey    != null) { store.set('geminiKey', s.geminiKey); push(s.geminiKey ? 'key-ok' : 'no-key', {}); }
    if (s.city         != null)   store.set('city',         s.city);
    if (s.scanInterval != null)   store.set('scanInterval', s.scanInterval);
    if (s.autoScan     != null)   store.set('autoScan',     s.autoScan);
    if (s.licenseKey   != null)   store.set('licenseKey',   s.licenseKey);
    if (s.provider     != null)   store.set('provider',     s.provider);
    if (s.ollamaModel  != null)   store.set('ollamaModel',  s.ollamaModel);
    if (s.startOnLogin != null)   app.setLoginItemSettings({ openAtLogin: Boolean(s.startOnLogin) });
    Boolean(store.get('autoScan') ?? true) ? startScanLoop() : stopScanLoop();
    push('settings-updated', {});
    return { ok: true };
  });

  // Profile (avatar + display name)
  ipcMain.handle('get-profile', () => ({
    name:   String(store.get('profileName')   ?? ''),
    avatar: String(store.get('profileAvatar') ?? ''), // base64 data URL or ''
  }));
  ipcMain.handle('save-profile', (_, { name, avatar }) => {
    if (name   != null) store.set('profileName',   name);
    if (avatar != null) store.set('profileAvatar', avatar);
    push('profile-updated', { name, avatar });
    return { ok: true };
  });

  // Returns { tier, used, limit } — no server call needed
  ipcMain.handle('check-license', () => getLicenseInfo());

  ipcMain.handle('get-stats', () => getStats());

  // Mode system
  ipcMain.handle('get-mode',  () => {
    const mode = getActiveMode();
    const tier = getTier();
    return {
      active: mode.id,
      modes: Object.values(MODES).map(m => ({
        id: m.id, icon: m.icon, name: m.name, color: m.color,
        tagline: m.tagline, tier: m.tier,
        locked: m.tier !== 'free' && tier === 'free',
      })),
    };
  });
  ipcMain.handle('set-mode', (_, id) => {
    if (!MODES[id]) return { ok: false };
    const tier = getTier();
    if (MODES[id].tier !== 'free' && tier === 'free') return { ok: false, reason: 'upgrade' };
    store.set('activeMode', id);
    push('mode-changed', { mode: id, icon: MODES[id].icon, name: MODES[id].name, color: MODES[id].color });
    return { ok: true };
  });

  ipcMain.handle('check-ollama', () => getOllamaStatus());

  ipcMain.handle('chat', async (_, text) => {
    const thumb = await captureScreen();
    // Send thumb preview to renderer so user bubble shows screenshot context
    if (thumb) {
      const previewB64 = thumb.resize({ width: 280, quality: 'good' }).toJPEG(60).toString('base64');
      push('screen-preview', { b64: previewB64 });
    }
    await chat(text, thumb);
    return { ok: true };
  });

  ipcMain.handle('manual-scan', async () => {
    const thumb = await captureScreen();
    if (thumb) { lastBitmap = thumb.resize({ width: 160 }).toBitmap(); await proactiveScan(thumb); }
    return { ok: true };
  });

  // Analyze a user-provided image (drag & drop or file picker)
  ipcMain.handle('analyze-image', async (_, b64) => {
    if (isStreaming) return { ok: false, reason: 'busy' };
    const limitHit = checkLimits();
    if (limitHit) { push('upgrade-prompt', getLicenseInfo()); return { ok: false, reason: 'limit' }; }

    isStreaming = true;
    push('stream-start', {});
    try {
      const scanPrompt  = getScanPrompt();
      const userPrompt  = 'Analyse this image the user provided. Respond ONLY with valid JSON.';
      const scanHistory = [{ role: 'user', content: userPrompt, _b64: b64 }];
      const raw = await streamAI(scanPrompt, scanHistory);

      let parsed = null;
      try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}

      if (parsed?.items?.length) {
        journalEntry(parsed.summary, parsed.context);
        const scans   = Number(store.get('statScans')   ?? 0) + 1;
        const threats = Number(store.get('statThreats') ?? 0)
          + parsed.items.filter(i => i.type === 'risk' || i.type === 'warn').length;
        store.set('statScans',   scans);
        store.set('statThreats', threats);
        push('stats-updated', getStats());
        push('analysis', parsed);
      }

      chatHistory.push({ role: 'assistant', content: raw });
      const usage = bumpUsage();
      push('stream-done', { _tier: usage.tier, _used: usage.used, _limit: usage.limit });
    } catch (err) {
      console.error('[analyze-image]', err.message);
      push('stream-error', { message: err.message });
    } finally {
      isStreaming = false;
    }
    return { ok: true };
  });

  ipcMain.on('clear-history', () => {
    chatHistory = [];
    push('history-cleared', {});
  });

  // ── Auto-estimate calories for a food item ────────────────────────────────
  ipcMain.handle('estimate-kcal', async (_, item) => {
    try {
      const key = getGeminiKey();
      if (!key) return null;
      const genai = new GoogleGenerativeAI(key);
      const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(
        `How many calories (kcal) are in a typical single serving of: "${item}"?\n` +
        `Reply with ONLY an integer number. No units, no explanation, no punctuation. Just the number.`
      );
      const text = result.response.text().trim().replace(/\D/g, '');
      const kcal = parseInt(text, 10);
      return isNaN(kcal) ? null : Math.min(Math.max(kcal, 0), 5000);
    } catch { return null; }
  });

  ipcMain.handle('get-memory',    ()      => ({ facts: getMemory(), journal: (store.get('journal') ?? []).slice(0, 30) }));
  ipcMain.handle('clear-memory',  ()      => { saveMemory([]); store.set('journal', []); return { ok: true }; });
  ipcMain.handle('delete-fact',   (_, k)  => { saveMemory(getMemory().filter(f => f.key !== k)); return { ok: true }; });
  ipcMain.handle('add-note',      (_, text) => {
    upsertFacts([{ key: 'note_' + Date.now(), value: text, type: 'personal' }]);
    extractAndLearn(text, '').catch(() => {});
    return { ok: true };
  });

  // ── Notes ──────────────────────────────────────────────────────────────────
  ipcMain.handle('get-notes', () => store.get('notes') ?? []);
  ipcMain.handle('save-note', (_, { id, text, pinned }) => {
    const notes = store.get('notes') ?? [];
    const idx   = notes.findIndex(n => n.id === id);
    if (idx >= 0) { notes[idx] = { ...notes[idx], text, pinned: !!pinned, updated: Date.now() }; }
    else          { notes.unshift({ id: randomUUID(), text, pinned: !!pinned, created: Date.now(), updated: Date.now() }); }
    store.set('notes', notes.slice(0, 500));
    return { ok: true };
  });
  ipcMain.handle('delete-note', (_, id) => {
    store.set('notes', (store.get('notes') ?? []).filter(n => n.id !== id));
    return { ok: true };
  });
  ipcMain.handle('pin-note', (_, id) => {
    const notes = (store.get('notes') ?? []).map(n => n.id === id ? { ...n, pinned: !n.pinned } : n);
    store.set('notes', notes);
    return { ok: true };
  });

  // ── Savings log ────────────────────────────────────────────────────────────
  ipcMain.handle('get-savings', () => store.get('savings') ?? []);
  ipcMain.handle('log-saving',  (_, { item, amount, currency = 'USD' }) => {
    const log = store.get('savings') ?? [];
    log.unshift({ id: randomUUID(), item, amount: Number(amount), currency, date: Date.now() });
    store.set('savings', log.slice(0, 1000));
    return { ok: true };
  });
  ipcMain.handle('delete-saving', (_, id) => {
    store.set('savings', (store.get('savings') ?? []).filter(s => s.id !== id));
    return { ok: true };
  });

  // ── Diet log ───────────────────────────────────────────────────────────────
  ipcMain.handle('get-diet',    () => store.get('diet') ?? []);
  ipcMain.handle('log-diet',    (_, { item, kcal, action = 'avoided' }) => {
    const log = store.get('diet') ?? [];
    log.unshift({ id: randomUUID(), item, kcal: Number(kcal) || 0, action, date: Date.now() });
    store.set('diet', log.slice(0, 1000));
    return { ok: true };
  });
  ipcMain.handle('delete-diet', (_, id) => {
    store.set('diet', (store.get('diet') ?? []).filter(d => d.id !== id));
    return { ok: true };
  });

  ipcMain.on('hide-window',     () => mainWindow?.hide());
  ipcMain.on('minimize-window', () => mainWindow?.minimize());
  ipcMain.on('open-settings',  openSettings);
  ipcMain.on('close-settings', () => settingsWindow?.close());
  ipcMain.on('close-setup',    () => setupWindow?.close());

  ipcMain.handle('request-screen-permission', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      return sources?.length > 0;
    } catch { return false; }
  });
  ipcMain.on('toggle-scan',    (_, on) => { store.set('autoScan', on); on ? startScanLoop() : stopScanLoop(); });
  ipcMain.on('set-collapsed',  (_, c)  => setWindowMode(c ? 'collapsed' : 'sidebar'));
  ipcMain.on('open-url',       (_, u)  => shell.openExternal(u));
  ipcMain.on('open-urls',      (_, urls) => {
    // Open multiple URLs as separate tabs — stagger slightly so browser groups them
    urls.forEach((u, i) => setTimeout(() => shell.openExternal(u), i * 120));
  });
  ipcMain.handle('get-window-mode', () => 'fullscreen');
}

// ─── Auto-updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  // Don't check for updates in dev (no app.asar)
  if (!app.isPackaged) return;

  autoUpdater.autoDownload     = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update',  ()      => push('update-status', { status: 'checking' }));
  autoUpdater.on('update-available',     (info)  => push('update-status', { status: 'available',    version: info.version }));
  autoUpdater.on('update-not-available', ()      => push('update-status', { status: 'up-to-date' }));
  autoUpdater.on('download-progress',    (prog)  => push('update-status', { status: 'downloading', percent: Math.round(prog.percent) }));
  autoUpdater.on('update-downloaded',    (info)  => push('update-status', { status: 'ready',       version: info.version }));
  autoUpdater.on('error',                (err)   => console.warn('[updater]', err.message));

  // Check on launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 10_000);
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000);

  // IPC: renderer can trigger install-and-restart
  ipcMain.on('install-update', () => autoUpdater.quitAndInstall(false, true));
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  registerIPC();
  setupAutoUpdater();

  // Show setup screen on first run
  if (!store.get('setupDone')) {
    setTimeout(openSetup, 800); // slight delay so main window appears first
    store.set('setupDone', true);
  }

  // Warn if no Gemini key — show banner in UI
  setTimeout(() => {
    const hasKey = Boolean(getGeminiKey());
    push(hasKey ? 'key-ok' : 'no-key', {});
  }, 1200); // after renderer is ready
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
  if (store.get('autoScan') !== false) startScanLoop();
});

app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('activate', () => { mainWindow?.show(); mainWindow?.focus(); }); // dock click
app.on('before-quit', () => { app.isQuitting = true; stopScanLoop(); globalShortcut.unregisterAll(); });
