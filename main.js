'use strict';

const { init: sentryInit } = require('@sentry/electron/main');
sentryInit({
  dsn: 'https://e43ea3481b44b42aebfaf0723599733e@o4511469742391296.ingest.de.sentry.io/4511469748355152',
});

const {
  app, BrowserWindow, BrowserView, desktopCapturer, ipcMain,
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
const FREE_TOTAL = 5;   // 5 free messages, then upgrade required
// Pro = unlimited daily — no cap. Max = unlimited + better model.

// ─── System prompts ───────────────────────────────────────────────────────────
// ─── Scan prompt — single unified Sidekick mode ──────────────────────────────
const SCAN_PROMPT_BASE = `You are Sidekick — an elite AI analyst with the combined expertise of a cybersecurity engineer, financial advisor, and personal coach. You see what's on the user's screen and give them information they couldn't easily get themselves.

Your job is to be the smartest person in the room about whatever is on screen. Be specific, be useful, be real.

SECURITY — catch threats before they cost the user:
- Phishing: spot lookalike domains (g00gle.com, paypa1.com), HTTP login pages, urgency manipulation
- Scams: fake tech support, prize notifications, romance scams, investment fraud patterns
- Dark patterns: pre-ticked boxes, hard-to-find unsubscribe, fake countdown timers
- Credential risks: password entry on unverified pages

FINANCE — protect every euro/dollar:
- Subscriptions: name the service, the exact charge, how to cancel in 2 steps
- Overcharging: if you know the real market price, state it. "This Samsung TV is €180 cheaper on Coolblue right now."
- Hidden fees: flag checkout surprises before they click pay
- Price history: "This typically sells for X, wait for sale"
- Cashback: "Rakuten gives 8% cashback on this store"

SHOPPING — give them the edge:
- Specific cheaper alternatives with real prices from real stores
- Actual coupon/promo codes if you know them
- "Buy now" vs "wait" intelligence based on product and season

HEALTH — honest, not preachy:
- Food ordering: real calories, real ingredients, one better swap at the same place
- Wellness scams: overpriced supplements, pseudoscience claims
- One insight max, encouraging tone

FOCUS — brief and non-judgmental:
- Distraction detected during work? One sentence, no lecturing

RULES:
- Be SILENT on normal safe activity — false alarms destroy trust
- One sharp insight beats five weak ones
- Name real stores, real prices, real alternatives — never vague
- "This could be a scam" is worthless. "This URL misspells PayPal as 'Paypai.com' — a known phishing domain targeting Dutch users" is excellent

Respond ONLY as valid JSON:
{"items":[{"type":"risk|warn|save|tip|rec","title":"insight under 8 words","detail":"specific, concrete — names, amounts, exact URLs, real prices","action":"one clear actionable step","notify":false,"query":"search term for comparison or null"}],"summary":"one sharp sentence","context":"security|finance|shopping|health|productivity"}

notify:true ONLY for active phishing/credential theft/financial scam. Return {"items":[],"summary":"","context":"general"} when nothing notable.

NEVER flag Sidekick itself, its own UI, or its own privacy/screen-monitoring features. That is expected and consented behavior.`;

function getScanPrompt() {
  const city = String(store.get('city') ?? '').trim();
  return SCAN_PROMPT_BASE + (city ? `\n\nUser location: ${city}.` : '');
}

const CHAT_PROMPT_BASE = `You are Sidekick — the AI that sees what you see and knows what you need before you ask. You combine the knowledge of a cybersecurity expert, financial analyst, personal shopper, and life coach. You speak like a brilliant, trusted friend — direct, specific, occasionally witty, never vague or corporate.

WHAT MAKES YOU DIFFERENT:
- You see the user's screen in real time. Use this. "I can see you're looking at X" beats generic advice.
- You remember everything about this user. Use their name, city, preferences, goals — naturally, not mechanically.
- You give real answers: real store names, real prices, real alternatives, real steps. Never hedge with "it depends."

WHEN THEY ASK ABOUT SHOPPING OR PRICES:
- Name the specific cheaper store and the exact price difference
- Mention cashback portals (Rakuten, TopCashback, Honey) if relevant
- Call out fake discounts: "That 'was €199' price was never real — it's always been €89"

WHEN THEY ASK ABOUT SECURITY:
- Name the specific threat vector, not just "be careful"
- "This login page is HTTP, not HTTPS — your password would be sent in plain text"

WHEN THEY ASK ABOUT FINANCE:
- Calculate actual impact: "That subscription is €9.99/mo — you'll have spent €240 in 2 years"
- Name specific cancel steps: "Go to Account → Billing → Cancel plan (not Pause)"

WHEN THEY WANT TO CHAT:
- Be warm, human, engaging. Not robotic.
- Short responses for small talk. Long when depth is needed.

FORMAT:
- Use markdown when structure helps (lists for steps, bold for key info)
- Never start with "I" or "Sure" or "Great question"
- Lead with the most useful thing immediately`;

function CHAT_PROMPT() {
  const name = String(store.get('profileName') ?? '').trim();
  const lang = String(store.get('profileLang') ?? 'en').trim();
  const langNote = lang && lang !== 'en'
    ? `\n\nIMPORTANT: Always respond in the user's language (${lang}). Never switch to English unless asked.`
    : '';
  const nameNote = name && name !== 'You' ? `\n\nUser's name: ${name}. Use it naturally in conversation.` : '';
  return CHAT_PROMPT_BASE + nameNote + langNote + buildMemoryContext();
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
let searchBrowserView = null;
let lastBitmap     = null;
let isStreaming    = false;
let retryTimer     = null;
let anthropic      = null;
let cachedKey      = '';
let chatHistory    = [];
let activeChatId   = null;
let lastNotifyTime = 0;
let overlayWindow  = null;

// ─── Region selector ──────────────────────────────────────────────────────────
function startRegionSelect() {
  return new Promise(resolve => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();

    const display     = screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor;

    overlayWindow = new BrowserWindow({
      x: display.bounds.x, y: display.bounds.y,
      width:  display.bounds.width,
      height: display.bounds.height,
      frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false,
      focusable: true, hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload:          path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          false,
      },
    });

    if (process.platform === 'darwin') {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    overlayWindow.loadFile('overlay.html');
    overlayWindow.show();
    overlayWindow.focus();

    const onSelected = async (_, region) => {
      cleanup();
      // Hide overlay before capture so it's not in the screenshot
      overlayWindow?.hide();
      await new Promise(r => setTimeout(r, 180));

      try {
        // Capture at physical pixel resolution
        const physW = Math.round(display.bounds.width  * scaleFactor);
        const physH = Math.round(display.bounds.height * scaleFactor);
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: physW, height: physH },
        });
        if (!sources.length) { overlayWindow?.close(); overlayWindow = null; return resolve(null); }

        // Crop: logical coords × scaleFactor (handle retina)
        const sf = region.dpr || scaleFactor;
        const cropped = sources[0].thumbnail.crop({
          x:      Math.max(0, Math.round(region.x      * sf)),
          y:      Math.max(0, Math.round(region.y      * sf)),
          width:  Math.max(1, Math.round(region.width  * sf)),
          height: Math.max(1, Math.round(region.height * sf)),
        });

        const b64 = cropped.toJPEG(92).toString('base64');
        overlayWindow?.close(); overlayWindow = null;
        resolve(b64);
      } catch (err) {
        console.error('[region]', err.message);
        overlayWindow?.close(); overlayWindow = null;
        resolve(null);
      }
    };

    const onCancelled = () => { cleanup(); overlayWindow?.close(); overlayWindow = null; resolve(null); };

    function cleanup() {
      ipcMain.removeListener('region-selected',  onSelected);
      ipcMain.removeListener('region-cancelled', onCancelled);
    }

    ipcMain.once('region-selected',  onSelected);
    ipcMain.once('region-cancelled', onCancelled);

    overlayWindow.on('closed', () => { cleanup(); overlayWindow = null; resolve(null); });
  });
}

// ─── Conversation persistence ─────────────────────────────────────────────────
// Conversations stored as: [{ id, title, messages: [{role,content,_b64?}], updatedAt }]
const CONV_MAX = 50;

function getConversations() {
  return Array.isArray(store.get('conversations')) ? store.get('conversations') : [];
}

function saveConversations(convs) {
  store.set('conversations', convs.slice(0, CONV_MAX));
}

function saveCurrentChat() {
  if (!chatHistory.length || !activeChatId) return;
  const convs = getConversations();
  const idx   = convs.findIndex(c => c.id === activeChatId);
  // Title = first user message, truncated
  const firstUser = chatHistory.find(m => m.role === 'user');
  const title = firstUser ? String(firstUser.content).slice(0, 60) : 'New chat';
  const entry = { id: activeChatId, title, messages: chatHistory, updatedAt: Date.now() };
  if (idx >= 0) convs[idx] = entry;
  else convs.unshift(entry);
  convs.sort((a, b) => b.updatedAt - a.updatedAt);
  saveConversations(convs);
}

function loadChat(id) {
  const convs = getConversations();
  const conv  = convs.find(c => c.id === id);
  if (!conv) return null;
  activeChatId = id;
  chatHistory  = Array.isArray(conv.messages) ? conv.messages : [];
  return { id, title: conv.title, messages: chatHistory };
}

function newChat() {
  saveCurrentChat(); // persist current before switching
  activeChatId = randomUUID();
  chatHistory  = [];
  return { id: activeChatId, conversations: getConversations() };
}

function deleteConversation(id) {
  const convs = getConversations().filter(c => c.id !== id);
  saveConversations(convs);
  if (activeChatId === id) {
    activeChatId = randomUUID();
    chatHistory  = [];
  }
  return { conversations: convs, activeChatId };
}

// Init active chat on startup — restore last conversation
function initChat() {
  const convs = getConversations();
  if (convs.length) {
    activeChatId = convs[0].id;
    chatHistory  = Array.isArray(convs[0].messages) ? convs[0].messages : [];
  } else {
    activeChatId = randomUUID();
    chatHistory  = [];
  }
}
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

  // Build history: exclude last msg (sent separately), drop leading model msgs (Gemini requires user first)
  let geminiHistory = history.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: m._b64
      ? [{ inlineData: { mimeType: 'image/jpeg', data: m._b64 } }, { text: m.content }]
      : [{ text: m.content }],
  }));
  // Drop any leading model messages — Gemini requires first turn to be 'user'
  while (geminiHistory.length && geminiHistory[0].role === 'model') geminiHistory.shift();

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

  // Strip scan-poisoned messages from history before sending
  // (old conversations had scan JSON in history which makes AI respond with JSON)
  chatHistory = chatHistory.filter(m => {
    const c = String(m.content || '');
    return !(c.includes('"items"') && c.includes('"summary"') && c.includes('"context"'));
  });

  const b64 = thumbnail ? thumbToB64(thumbnail) : null;
  chatHistory.push({ role: 'user', content: userText, _b64: b64 });

  push('stream-start', {});

  try {
    const reply = await streamAI(CHAT_PROMPT(), chatHistory);
    chatHistory.push({ role: 'assistant', content: reply });

    // Extract facts from this exchange in background (non-blocking)
    extractAndLearn(userText, reply).catch(() => {});

    // Persist conversation
    saveCurrentChat();
    push('conv-updated', { conversations: getConversations(), activeChatId });

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
// manual=true  → always show results in chat (user explicitly asked)
// manual=false → only show if real risk/warn detected, otherwise stay silent
async function proactiveScan(thumbnail, manual = false) {
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
    const urgentItems = parsed.items.filter(i => i.type === 'risk' || i.type === 'warn');
    const notifyItems = urgentItems.filter(i => i.notify);
    if (notifyItems.length) {
      const top = notifyItems[0];
      fireNotification(top.title, top.detail || top.action || '');
    }

    // Track stats
    const scans   = Number(store.get('statScans')   ?? 0) + 1;
    const threats = Number(store.get('statThreats') ?? 0) + urgentItems.length;
    store.set('statScans',   scans);
    store.set('statThreats', threats);
    push('stats-updated', getStats());

    // Show in chat: always for manual scan, only for real threats on auto-scan
    const shouldShow = manual || urgentItems.length > 0;
    if (shouldShow) push('analysis', parsed);

  } catch (err) {
    console.error('[scan]', err.message);
    if (manual) push('error', { message: err.message });
    else scheduleRetry(thumbnail);
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
    autoScan:      Boolean(store.get('autoScan')    ?? false),
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
    Boolean(store.get('autoScan') ?? false) ? startScanLoop() : stopScanLoop();
    push('settings-updated', {});
    return { ok: true };
  });

  // Profile (name, email, avatar, language)
  ipcMain.handle('get-profile', () => ({
    name:     String(store.get('profileName')   ?? ''),
    avatar:   String(store.get('profileAvatar') ?? ''),
    email:    String(store.get('profileEmail')  ?? ''),
    language: String(store.get('profileLang')   ?? 'en'),
  }));
  ipcMain.handle('save-profile', (_, { name, avatar, email, language }) => {
    if (name     != null) store.set('profileName',   name);
    if (avatar   != null) store.set('profileAvatar', avatar);
    if (email    != null) store.set('profileEmail',  email);
    if (language != null) store.set('profileLang',   language);
    push('profile-updated', { name, avatar, email, language });
    return { ok: true };
  });
  ipcMain.handle('logout', () => {
    store.delete('profileName');
    store.delete('profileEmail');
    store.delete('profileAvatar');
    store.delete('profileLang');
    store.delete('licenseKey');
    store.delete('setupDone');
    push('profile-updated', { name: '', avatar: '', email: '', language: 'en' });
    setTimeout(openSetup, 400);
    return { ok: true };
  });

  // Returns { tier, used, limit } — no server call needed
  ipcMain.handle('check-license', () => getLicenseInfo());

  ipcMain.handle('get-stats', () => getStats());

  // Conversation management
  ipcMain.handle('get-conversations', () => ({
    conversations: getConversations(),
    activeChatId,
  }));
  ipcMain.handle('new-chat',    () => newChat());
  ipcMain.handle('load-chat',   (_, id) => loadChat(id));
  ipcMain.handle('delete-chat', (_, id) => deleteConversation(id));
  ipcMain.handle('rename-chat', (_, { id, title }) => {
    const convs = getConversations();
    const conv  = convs.find(c => c.id === id);
    if (conv) { conv.title = String(title).slice(0, 80); saveConversations(convs); }
    return { conversations: convs, activeChatId };
  });
  ipcMain.handle('pin-chat', (_, id) => {
    const convs = getConversations();
    const conv  = convs.find(c => c.id === id);
    if (conv) conv.pinned = !conv.pinned;
    convs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
    saveConversations(convs);
    return { conversations: convs, activeChatId };
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

  // Region selector — CMD+SHIFT+4 style
  ipcMain.handle('region-select', async () => {
    mainWindow?.hide(); // hide main window so overlay is clean
    await new Promise(r => setTimeout(r, 120));
    const b64 = await startRegionSelect();
    mainWindow?.show(); mainWindow?.focus();
    return { b64 };
  });
  ipcMain.handle('manual-scan', async () => {
    const thumb = await captureScreen();
    if (thumb) { lastBitmap = thumb.resize({ width: 160 }).toBitmap(); await proactiveScan(thumb, true); }
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

      // Don't push raw JSON scan output to chatHistory — pollutes chat context
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

  // ── Links (URL analysis with alternatives) ────────────────────────────────
  ipcMain.handle('get-links', () => store.get('savedLinks', []));
  ipcMain.handle('delete-link', (_, id) => {
    store.set('savedLinks', (store.get('savedLinks', [])).filter(l => l.id !== id));
    return { ok: true };
  });
  ipcMain.handle('analyze-link', async (_, { url, note }) => {
    const key = getGeminiKey();
    if (!key) throw new Error('No AI key');
    const genAI = new GoogleGenerativeAI(key);
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr;
    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const prompt = `You are a smart shopping assistant. Analyze this URL and find real alternatives.

URL: ${url}
${note ? `User note: ${note}` : ''}

Find the product/service and return 3-5 real, specific alternatives with actual working URLs. Focus on cheaper or better value options. If it's a subscription/service, find competitors. If it's a product, find the same or similar at lower prices.

Respond ONLY with valid JSON, no markdown:
{"title":"product or service name","what":"one sentence describing what this is","domain":"the site domain","alternatives":[{"name":"Alternative name","url":"https://real-url.com/product","why":"Why this is better or cheaper — be specific","saving":"estimated saving or value difference, e.g. '~$15 cheaper' or 'free tier available'"}]}`;
        const result = await model.generateContent(prompt);
        const text   = result.response.text();
        const match  = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON in response');
        const parsed = JSON.parse(match[0]);
        // Save to store
        const links = store.get('savedLinks', []);
        links.unshift({ id: randomUUID(), url, note: note || '', ts: Date.now(), ...parsed });
        store.set('savedLinks', links.slice(0, 200));
        return parsed;
      } catch (e) {
        lastErr = e;
        if (!e.message?.includes('429') && !e.message?.includes('quota')) throw e;
      }
    }
    throw lastErr;
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
  ipcMain.on('set-collapsed',  (_, c)  => setWindowMode(c ? 'collapsed' : 'fullscreen'));
  ipcMain.on('set-mode',       (_, m)  => setWindowMode(m));
  ipcMain.on('open-url',       (_, u)  => shell.openExternal(u));
  ipcMain.on('open-urls',      (_, urls) => {
    // Open multiple URLs as separate tabs — stagger slightly so browser groups them
    urls.forEach((u, i) => setTimeout(() => shell.openExternal(u), i * 120));
  });
  ipcMain.handle('get-window-mode', () => 'fullscreen');

  // ─── Embedded search browser (BrowserView) ────────────────────────────────
  function destroySearchBrowserView() {
    if (searchBrowserView && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.removeBrowserView(searchBrowserView);
        searchBrowserView.webContents.destroy();
      } catch {}
    }
    searchBrowserView = null;
  }

  ipcMain.handle('show-search-browser', async (_, { url, x, y, width, height }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no window' };
    try {
      if (!searchBrowserView) {
        searchBrowserView = new BrowserView({
          webPreferences: {
            nodeIntegration: false, contextIsolation: true, sandbox: false,
          },
        });
        mainWindow.addBrowserView(searchBrowserView);
        searchBrowserView.webContents.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        // Keep all navigation inside the view
        searchBrowserView.webContents.setWindowOpenHandler(({ url: u }) => {
          searchBrowserView?.webContents.loadURL(u);
          return { action: 'deny' };
        });
      }
      const bx = Math.round(x), by = Math.round(y),
            bw = Math.max(1, Math.round(width)), bh = Math.max(1, Math.round(height));
      searchBrowserView.setBounds({ x: bx, y: by, width: bw, height: bh });
      await searchBrowserView.webContents.loadURL(url);
      return { ok: true };
    } catch (e) {
      console.error('[search-browser] error:', e.message);
      destroySearchBrowserView();
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('hide-search-browser', () => {
    destroySearchBrowserView();
    return { ok: true };
  });

  ipcMain.handle('get-search-url', () => {
    try { return searchBrowserView?.webContents.getURL() || ''; } catch { return ''; }
  });

  // Resize search view when main window resizes
  mainWindow.on('resize', () => {
    if (!searchBrowserView) return;
    mainWindow.webContents.send('search-view-resize');
  });
}

// ─── Auto-updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  // Don't check for updates in dev (no app.asar)
  if (!app.isPackaged) return;

  // No code signing → don't attempt silent install; just notify user and open download page
  autoUpdater.autoDownload         = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available',     (info) => push('update-status', { status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', ()     => {});
  autoUpdater.on('error',                (err)  => console.warn('[updater]', err.message));

  // Check on launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);

  // IPC: renderer opens download page
  ipcMain.on('install-update', () => {
    shell.openExternal('https://github.com/emirilgin/sidekick/releases/latest');
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  initChat(); // restore last conversation
  createMainWindow();
  createTray();
  registerIPC();
  setupAutoUpdater();

  // Show setup screen on first run or if no profile name set
  if (!store.get('setupDone') || !store.get('profileName')) {
    setTimeout(openSetup, 800);
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
  // Auto-scan off by default — user can enable in Settings
  if (store.get('autoScan') === true) startScanLoop();
});

app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('activate', () => {
  if (!mainWindow) return;
  // Dock click → always show fullscreen, never sidebar strip
  if (!mainWindow.isVisible()) setWindowMode('fullscreen');
  mainWindow.show();
  mainWindow.focus();
});
app.on('before-quit', () => { app.isQuitting = true; stopScanLoop(); globalShortcut.unregisterAll(); });
