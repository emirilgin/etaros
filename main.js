'use strict';

const { init: sentryInit } = require('@sentry/electron/main');
let _sentryDsn = '';
try { _sentryDsn = require('./app.config').sentryDsn || ''; } catch { /* no config */ }
if (_sentryDsn) sentryInit({ dsn: _sentryDsn });

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

// ─── Supabase client ──────────────────────────────────────────────────────────
// ─── Supabase Auth — raw fetch (no SDK, avoids Electron main process issues) ──
function sbUrl()  { return (APP_CONFIG.supabaseUrl  ?? '').replace(/\/$/, ''); }
function sbKey()  { return  APP_CONFIG.supabaseAnonKey ?? ''; }
function sbReady(){ return !!(sbUrl() && sbKey()); }

async function sbFetch(path, body, token) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 8000);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'apikey':        sbKey(),
      'Authorization': `Bearer ${token || sbKey()}`,
    };
    const res = await fetch(`${sbUrl()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json();
    return { ok: res.ok, data, status: res.status };
  } catch (e) {
    return { ok: false, data: { error_description: e.message }, status: 0 };
  } finally {
    clearTimeout(tid);
  }
}

async function sbGet(path, token) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${sbUrl()}${path}`, {
      method: 'GET',
      headers: {
        'apikey':        sbKey(),
        'Authorization': `Bearer ${token || sbKey()}`,
      },
      signal: ctrl.signal,
    });
    const data = await res.json();
    return { ok: res.ok, data, status: res.status };
  } catch (e) {
    return { ok: false, data: { message: e.message }, status: 0 };
  } finally {
    clearTimeout(tid);
  }
}

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
// ─── Scan prompt — single unified Etaros mode ──────────────────────────────
const SCAN_PROMPT_BASE = `You are Etaros — an elite cybersecurity and fraud-detection AI. You watch the user's screen and catch online threats before they cost them money or compromise their accounts. Security is your ONLY job. You are the digital bodyguard that notices what humans miss.

Your single mission: detect scams, phishing, fraud, and credential theft in real time. Be the sharpest threat analyst alive. Be specific, be technical, be certain.

WHAT YOU HUNT FOR:

PHISHING & FAKE PAGES:
- Lookalike / typosquatted domains: paypa1.com, g00gle.com, micros0ft-support.com, amaz0n.net
- HTTP (not HTTPS) login or payment pages — passwords sent in plain text
- Fake login pages that copy a real brand (PayPal, banks, Microsoft 365, Google, iCloud, Coinbase)
- Homograph attacks (Cyrillic/Unicode characters that look like Latin letters)
- URLs where the real domain is buried (e.g. paypal.com.secure-login.ru)

SCAMS & SOCIAL ENGINEERING:
- Fake tech support ("Your computer is infected, call this number")
- Prize / lottery / "you've won" notifications
- Romance scams, investment/crypto fraud ("guaranteed 30% returns"), pig-butchering
- Urgency & fear manipulation ("account suspended", "act in 24 hours or lose access")
- Impersonation: emails/DMs pretending to be a bank, government (Belastingdienst, DigiD), delivery service (PostNL, DHL), or a known contact
- Gift-card / wire-transfer / crypto payment requests — almost always fraud
- Invoice fraud / fake payment requests

CREDENTIAL & ACCOUNT RISKS:
- Password or 2FA code being entered on an unverified or suspicious page
- Requests for full card number, CVV, PIN, SSN/BSN, passport, or recovery codes
- OAuth / "Sign in with..." prompts from a suspicious site asking for broad permissions
- Browser extension or download prompting for risky permissions
- Malware / suspicious download ("your Flash is out of date", fake installers, cracked software)

DARK PATTERNS & HIDDEN TRAPS (only when clearly deceptive/financial):
- Free trials that silently auto-charge, pre-ticked subscription boxes, cancellation buried in fine print
- Hidden fees added at the final checkout step

HOW TO REPORT:
- Be SILENT on normal, safe activity — false alarms destroy trust. Most screens are fine.
- Name the EXACT threat vector. "This could be a scam" is worthless. "This URL spells PayPal as 'Paypai.com' — a known phishing domain; do not enter your password" is excellent.
- Quote the suspicious URL, sender, amount, or phrase exactly.
- Give ONE clear action: "Close this tab", "Do not enter your code", "Verify by going to bank.com directly".

Respond ONLY as valid JSON:
{"items":[{"type":"risk|warn|tip","title":"threat in under 8 words","detail":"specific, concrete — exact URL, sender, phrase, technique","action":"one clear protective step","notify":false}],"summary":"one sharp sentence","context":"security"}

type: "risk" = active danger (phishing/credential theft/fraud in progress) → set notify:true. "warn" = suspicious, be careful. "tip" = a safety improvement.
Return {"items":[],"summary":"","context":"general"} when the screen is safe / nothing security-relevant.

NEVER flag Etaros itself, its own UI, or its screen-monitoring. That is expected and consented.`;

function getScanPrompt() {
  const city = String(store.get('city') ?? '').trim();
  return SCAN_PROMPT_BASE + (city ? `\n\nUser location: ${city}.` : '');
}

const CHAT_PROMPT_BASE = `You are Etaros — a world-class cybersecurity expert and digital bodyguard. You are SINGULARLY focused on online safety, scams, phishing, fraud, privacy, and account security. This is the only thing you do, and you do it better than anyone. You see the user's screen in real time and you protect them.

You speak like an elite security analyst who happens to be a trusted friend: sharp, precise, technical when it counts, calm under pressure, never condescending, never vague, never corporate.

═══ YOUR EXPERTISE (deep, not surface-level) ═══
- Phishing & spoofing: typosquatting, homograph/Unicode attacks, subdomain tricks (paypal.com.evil.ru), display-name spoofing, lookalike SSL certs, HTTP vs HTTPS, fake login pages, QR-code phishing (quishing)
- Email/message analysis: sender domain vs display name, SPF/DKIM/DMARC reasoning, link inspection, attachment risk, urgency/fear/authority manipulation tactics
- Scams: tech-support, romance/pig-butchering, investment & crypto fraud, lottery/prize, marketplace (Vinted/Marktplaats) scams, fake invoices, CEO/BEC fraud, impersonation of banks, Belastingdienst, DigiD, PostNL/DHL, police
- Account & identity security: strong passwords, password managers, 2FA/MFA, passkeys, SIM-swapping, session hijacking, credential-stuffing, what to do AFTER a breach or hack (exact recovery steps)
- Malware & devices: suspicious downloads, fake updaters, cracked software risk, malicious browser extensions, ransomware basics, mobile threats
- Privacy & data: data breaches (haveibeenpwned), oversharing, tracking, VPN reality vs hype, safe public-Wi-Fi habits, doxxing protection
- Safe practices: secure backups, software updates, phishing-resistant habits, teaching non-technical people (elderly, kids)

═══ HOW YOU ANSWER ═══
- For any "is this safe?" (URL, email, message, screenshot): give a VERDICT FIRST — ✅ SAFE / ⚠️ SUSPICIOUS / 🚨 DANGEROUS — then the exact reasoning.
- Name the precise red flag. Not "this looks suspicious" but "The sender domain is paypa1-support.com — that's a digit 1, not the letter l. Classic phishing."
- Reason step by step like a real analyst: check the domain, the links, the urgency, the ask, the payment method.
- Always end actionable: numbered protective steps. If they may already be compromised, give recovery steps (change password, enable 2FA, contact bank, etc.).
- Be certain. On security, confident specifics beat hedging.

═══ STAY IN YOUR LANE ═══
- You ONLY do cybersecurity, scams, fraud, privacy, and online safety.
- If asked something off-topic (shopping, coding help, homework, general chit-chat, recipes), briefly and warmly redirect: you're a security AI, and offer to help check if anything they're doing is safe. One sentence, no lecture, then steer back.
- If something dangerous is on their screen, warn them even if they didn't ask.

FORMAT:
- Markdown when it helps (verdict line, **bold** the key warning, numbered steps)
- Never open with "I", "Sure", or "Great question"
- Lead with the verdict or the single most important thing`;

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
    const model  = genAI.getGenerativeModel({ model: GEMINI_CHEAP_MODEL });
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
let tray           = null;
let scanTimer      = null;
let searchBrowserView = null;
let lastBitmap     = null;
let isStreaming    = false;
let retryTimer     = null;
let quotaCooldownUntil = 0;   // pause auto-scans after a quota hit (avoid API hammering)
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

// ─── Tier system — server validation + HMAC offline fallback ─────────────────
// New keys (from Supabase): PREFIX-XXXX-XXXX (3 segments, server validates)
// Old keys (HMAC-signed):   PREFIX-XXXX-XXXX-XXXX (4 segments, offline HMAC)
// Server validation result cached 24h in store.
const { createHmac } = require('crypto');

// Machine ID for device tracking (reuse machineKey output as stable device ID)
function getMachineId() {
  let mid = store.get('machineId');
  if (!mid) { mid = `${machineKey()}-${Date.now().toString(36)}`; store.set('machineId', mid); }
  return mid;
}

// HMAC check for legacy 4-segment keys
function verifyKeyHmac(key) {
  const secret = APP_CONFIG.licenseSecret;
  if (!secret || secret === 'YOUR_64_CHAR_HEX_SECRET_HERE') return true;
  const m = key.match(/^(SMAX|SIDE|STEST)-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})$/);
  if (!m) return false;
  const [, , r1, r2, given] = m;
  const expected = createHmac('sha256', secret).update(r1 + r2).digest('hex').slice(0, 4).toUpperCase();
  return given === expected;
}

// Offline tier from key format (used when server unreachable)
function tierFromKeyOffline(key) {
  // New 3-segment server keys — accept format, trust cache or retry later
  if (/^SMAX-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key))  return 'max';
  if (/^SIDE-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key))  return 'pro';
  if (/^STEST-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key)) return 'max';
  // Legacy 4-segment HMAC keys
  if (/^SMAX-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key)  && verifyKeyHmac(key)) return 'max';
  if (/^SIDE-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key)  && verifyKeyHmac(key)) return 'pro';
  if (/^STEST-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(key) && verifyKeyHmac(key)) return 'max';
  return null;
}

// Fetch tier from Supabase profile — cache 30min
// Refresh access token using refresh_token
async function refreshAccessToken() {
  const refreshToken = store.get('sbRefreshToken');
  if (!refreshToken || !sbReady()) return false;
  const { ok, data } = await sbFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
  if (!ok || !data.access_token) return false;
  store.set('sbAccessToken',  data.access_token);
  store.set('sbRefreshToken', data.refresh_token ?? refreshToken);
  if (data.user?.id) store.set('sbUserId', data.user.id);
  return true;
}

async function refreshTierFromServer() {
  if (APP_CONFIG.ownerMode || !sbReady()) return null;
  // Tester/beta override is sticky — never let a server read downgrade it.
  // (Server-side tier PATCH needs service_role; until an Edge Function does it,
  //  the redeemed Max tier lives client-side and must survive refreshes.)
  if (store.get('testerTier')) return store.get('testerTier');
  let accessToken = store.get('sbAccessToken');
  const userId    = store.get('sbUserId');
  if (!accessToken || !userId) return null;

  const CACHE_TTL = 30 * 60 * 1000;
  const cachedTs  = store.get('sbTierTs');
  if (cachedTs && Date.now() - Number(cachedTs) < CACHE_TTL) {
    return store.get('sbTier') ?? null;
  }

  // Try fetch; if 401 refresh token and retry once
  let result = await sbGet(`/rest/v1/profiles?select=tier&id=eq.${userId}&limit=1`, accessToken);
  if (result.status === 401 || result.status === 403) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) return null;
    accessToken = store.get('sbAccessToken');
    result = await sbGet(`/rest/v1/profiles?select=tier&id=eq.${userId}&limit=1`, accessToken);
  }
  if (!result.ok || !Array.isArray(result.data) || !result.data[0]) {
    console.warn('[auth] profile fetch failed', result.data);
    return null;
  }

  const tier = result.data[0].tier ?? 'free';
  store.set('sbTier',   tier);
  store.set('sbTierTs', Date.now());
  push('tier-updated', { tier });
  return tier;
}

function getTierSync() {
  if (APP_CONFIG.ownerMode) return 'max';
  // Tester/beta override wins (sticky, survives server refresh)
  const tester = store.get('testerTier');
  if (tester) return tester;
  // Supabase account tier takes priority
  const userId = store.get('sbUserId');
  if (userId) {
    const t = store.get('sbTier');
    if (t) return t;
  }
  // Legacy: license key fallback
  const key = String(store.get('licenseKey') ?? '').trim().toUpperCase();
  if (!key) return 'free';
  const cached = store.get(`serverTier_${key}`);
  if (cached) return cached;
  return tierFromKeyOffline(key) ?? 'free';
}

function currentMonth() { return new Date().toISOString().slice(0, 7); } // e.g. "2026-05"
function getFreeUsed() {
  // Reset counter when month changes
  const month = currentMonth();
  if (store.get('freeMonth') !== month) {
    store.set('freeMonth', month);
    store.set('freeUsed', 0);
  }
  return Number(store.get('freeUsed') ?? 0);
}
function bumpFreeUsed() { const n = getFreeUsed() + 1; store.set('freeUsed', n); return n; }

function getProUsed() { return Number(store.get('proUsed') ?? 0); }
function bumpProUsed() { const n = getProUsed() + 1; store.set('proUsed', n); return n; }

function getLicenseInfo() {
  const tier = getTierSync();
  if (tier === 'max') return { tier, used: 0,            limit: 0          };
  if (tier === 'pro') return { tier, used: getProUsed(), limit: 0          };
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
      title:    'Etaros',
      subtitle: title,             // macOS: shows under title
      body:     String(body || '').slice(0, 160),
      silent:   true,              // no sound — avoids macOS ducking/pausing user's music
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
      push('error', { message: 'Screen access denied. Go to System Settings → Privacy & Security → Screen Recording → enable Etaros.' });
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
// Uses Google's free API — no credit card needed, generous free daily quota.
// This is what powers the app out of the box.
// Fallback chain: on a 429/quota error we try the next model in order.
const GEMINI_MODELS      = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];
const GEMINI_CHEAP_MODEL = 'gemini-2.0-flash-lite'; // background tasks (fact extraction)

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

// Turn raw network/SDK errors into something a human understands
function friendlyError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network|ERR_INTERNET|dns/i.test(msg)
      || err?.name === 'AbortError' || err?.code === 'ENOTFOUND') {
    return "Can't reach the AI — you appear to be offline. Check your internet connection and try again.";
  }
  return msg.split('\n')[0]; // first line only, never dump giant JSON at the user
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
  const tier = getTierSync();
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
// Server-authoritative: always fetch fresh tier from Supabase before allowing
// a paid action. Cached tier is only used if server is unreachable (offline).
// This closes the local-store tampering attack vector.
async function checkLimitsAsync() {
  if (!APP_CONFIG.ownerMode && sbReady()) {
    // Force a fresh server check (bypass cache TTL)
    const userId = store.get('sbUserId');
    let token    = store.get('sbAccessToken');
    if (userId && token) {
      let result = await sbGet(`/rest/v1/profiles?select=tier&id=eq.${userId}&limit=1`, token);
      if (result.status === 401 || result.status === 403) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          token  = store.get('sbAccessToken');
          result = await sbGet(`/rest/v1/profiles?select=tier&id=eq.${userId}&limit=1`, token);
        }
      }
      if (result.ok && Array.isArray(result.data) && result.data[0]) {
        const serverTier = result.data[0].tier ?? 'free';
        // Only allow testerTier to upgrade, never downgrade below server value
        const tester = store.get('testerTier');
        const effectiveTier = tester === 'max' ? 'max' : serverTier;
        store.set('sbTier', effectiveTier);
        store.set('sbTierTs', Date.now());
        if (effectiveTier === 'max' || effectiveTier === 'pro') return null;
        if (getFreeUsed() >= FREE_TOTAL) return 'free';
        return null;
      }
    }
  }
  // Offline fallback — use cached tier
  const tier = getTierSync();
  if (tier === 'max') return null;
  if (tier === 'pro') return null;
  if (tier === 'free' && getFreeUsed() >= FREE_TOTAL) return 'free';
  return null;
}

function checkLimits() {
  const tier = getTierSync();
  if (tier === 'max') return null;
  if (tier === 'pro') return null;
  if (tier === 'free' && getFreeUsed() >= FREE_TOTAL) return 'free';
  return null;
}

function bumpUsage() {
  const tier = getTierSync();
  if (tier === 'pro')  return { tier, used: bumpProUsed(), limit: 0 };         // 0 = unlimited
  if (tier === 'free') return { tier, used: bumpFreeUsed(), limit: FREE_TOTAL };
  return                      { tier: 'max', used: 0, limit: 0 };
}

// ─── Core: send a chat message ────────────────────────────────────────────────
async function chat(userText, thumbnail) {
  if (isStreaming) return;
  isStreaming = true;

  // Check limits — server-authoritative (closes local store tamper attack)
  const limitHit = await checkLimitsAsync();
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
    push('stream-error', { message: friendlyError(err) });
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
  if ((await checkLimitsAsync()) === 'free') return;

  // Skip auto-scans while in quota cooldown (manual scans always allowed)
  if (!manual && Date.now() < quotaCooldownUntil) return;

  push('scan-status', { scanning: true });

  try {
    const b64         = thumbToB64(thumbnail);
    const scanPrompt  = getScanPrompt();
    const userPrompt  = 'Analyse this screen. Respond ONLY with valid JSON.';
    const scanHistory = [{ role: 'user', content: userPrompt, _b64: b64 }];

    const raw = await streamAI(scanPrompt, scanHistory);
    quotaCooldownUntil = 0; // success → clear any quota pause

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
    const msg = String(err?.message ?? '');
    // Quota exhausted or offline → retrying just hammers the API. Don't.
    const isQuota   = /quota|429|RESOURCE_EXHAUSTED/i.test(msg);
    const dontRetry = isQuota || /offline|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg);
    // Quota hit → pause auto-scans for 10 min so we stop spamming the API
    if (isQuota) quotaCooldownUntil = Date.now() + 10 * 60 * 1000;
    if (manual) push('error', { message: friendlyError(err) });
    else if (!dontRetry) scheduleRetry(thumbnail);
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

function openSettings() {
  // Unified: open the in-app inline settings page (legacy settings.html window retired)
  if (mainWindow && !mainWindow.isDestroyed()) {
    setWindowMode('fullscreen');
    mainWindow.show();
    mainWindow.focus();
    push('open-settings-inline', {});
  }
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
  tray.setToolTip('Etaros');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Etaros',  click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Hide Etaros',  click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Settings',       click: openSettings },
    { type: 'separator' },
    { label: 'Quit Etaros',  click: () => { app.isQuitting = true; app.quit(); } },
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
    if (s.geminiKey    != null) { store.set('geminiKey', s.geminiKey); quotaCooldownUntil = 0; push(getGeminiKey() ? 'key-ok' : 'no-key', {}); }
    if (s.city         != null)   store.set('city',         s.city);
    if (s.scanInterval != null)   store.set('scanInterval', s.scanInterval);
    if (s.autoScan     != null)   store.set('autoScan',     s.autoScan);
    if (s.licenseKey   != null) {
      store.set('licenseKey', s.licenseKey);
      // Clear cached server validation so new key gets re-verified
      const oldKey = String(s.licenseKey ?? '').trim().toUpperCase();
      store.delete(`serverTier_${oldKey}`);
      store.delete(`serverTier_${oldKey}_ts`);
      // Validate new key against server immediately (async)
      if (s.licenseKey) validateKeyWithServer(s.licenseKey.trim().toUpperCase()).catch(() => {});
    }
    if (s.provider     != null)   store.set('provider',     s.provider);
    if (s.ollamaModel  != null)   store.set('ollamaModel',  s.ollamaModel);
    if (s.startOnLogin != null)   app.setLoginItemSettings({ openAtLogin: Boolean(s.startOnLogin) });
    Boolean(store.get('autoScan') ?? false) ? startScanLoop() : stopScanLoop();
    push('settings-updated', {});
    return { ok: true };
  });

  // Profile (name, email, avatar, language)
  ipcMain.handle('get-profile', () => {
    // Supabase email is authoritative — always prefer it over local store
    const sbEmail = store.get('profileEmail') ?? '';
    return {
      name:     String(store.get('profileName')   ?? ''),
      avatar:   String(store.get('profileAvatar') ?? ''),
      email:    sbEmail,
      language: String(store.get('profileLang')   ?? 'en'),
    };
  });
  ipcMain.handle('save-profile', (_, { name, avatar, language }) => {
    // Email is NOT editable — set by Supabase auth, never by user input
    if (name     != null) store.set('profileName',   name);
    if (avatar   != null) store.set('profileAvatar', avatar);
    if (language != null) store.set('profileLang',   language);
    const email = store.get('profileEmail') ?? '';
    push('profile-updated', { name, avatar, email, language });
    return { ok: true };
  });
  ipcMain.handle('logout', async () => {
    // Sign out from Supabase (fire-and-forget)
    const token = store.get('sbAccessToken');
    if (token && sbReady()) {
      sbFetch('/auth/v1/logout', {}, token).catch(() => {});
    }
    store.delete('sbAccessToken');
    store.delete('sbRefreshToken');
    store.delete('sbUserId');
    store.delete('sbTier');
    store.delete('sbTierTs');
    store.delete('testerTier');   // don't let next user inherit beta Max
    store.delete('profileName');
    store.delete('profileEmail');
    store.delete('profileAvatar');
    store.delete('profileLang');
    store.delete('licenseKey');
    store.delete('setupDone');
    push('profile-updated', { name: '', avatar: '', email: '', language: 'en' });
    push('logged-out', {});
    return { ok: true };
  });

  // ─── Supabase Auth IPC (raw fetch — no SDK) ──────────────────────────────

  ipcMain.handle('auth-login', async (_, { email, password }) => {
    if (!sbReady()) return { ok: false, error: 'Supabase not configured' };
    const { ok, data } = await sbFetch('/auth/v1/token?grant_type=password', { email, password });
    if (!ok) return { ok: false, error: data?.error_description ?? data?.msg ?? 'Login failed' };
    store.set('sbAccessToken',  data.access_token);
    store.set('sbRefreshToken', data.refresh_token);
    store.set('sbUserId',       data.user.id);
    store.set('profileEmail',   data.user.email);
    refreshTierFromServer().catch(() => {});
    return { ok: true, user: { id: data.user.id, email: data.user.email } };
  });

  ipcMain.handle('auth-register', async (_, { email, password }) => {
    if (!sbReady()) return { ok: false, error: 'Supabase not configured' };
    const { ok, data } = await sbFetch('/auth/v1/signup', { email, password });
    if (!ok) return { ok: false, error: data?.msg ?? data?.error_description ?? 'Registration failed' };
    if (!data.access_token) return { ok: true, needsConfirmation: true };
    const userId = data.user.id;
    store.set('sbAccessToken',  data.access_token);
    store.set('sbRefreshToken', data.refresh_token);
    store.set('sbUserId',       userId);
    store.set('profileEmail',   data.user.email);
    // Create profile row manually (no trigger)
    try {
      await fetch(`${sbUrl()}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': sbKey(),
          'Authorization': `Bearer ${data.access_token}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ id: userId, email, tier: 'free' }),
      });
    } catch (e) { console.warn('[register] profile insert failed:', e.message); }
    return { ok: true, user: { id: userId, email: data.user.email } };
  });

  ipcMain.handle('auth-session', async () => {
    if (APP_CONFIG.ownerMode || !sbReady()) {
      return { loggedIn: true, skipAuth: true, tier: 'max' };
    }
    const userId = store.get('sbUserId');
    const email  = store.get('profileEmail') ?? '';
    if (!userId) return { loggedIn: false };
    refreshTierFromServer().catch(() => {});
    return { loggedIn: true, user: { id: userId, email }, tier: getTierSync() };
  });

  ipcMain.handle('auth-reset-password', async (_, { email }) => {
    if (!sbReady()) return { ok: false, error: 'Supabase not configured' };
    const resetPage = 'https://emirilgin.github.io/sidekick/reset-password.html';
    const { ok, data } = await sbFetch('/auth/v1/recover', { email, redirectTo: resetPage });
    if (!ok) return { ok: false, error: data?.msg ?? 'Failed' };
    return { ok: true };
  });

  ipcMain.handle('auth-get-upgrade-url', (_, { planTier }) => {
    const userId = store.get('sbUserId') ?? '';
    const email  = store.get('profileEmail') ?? '';
    // Stripe payment links — set these in app.config.js
    const links = APP_CONFIG.stripePlanLinks ?? {};
    const base  = links[planTier] ?? links.pro ?? '';
    if (!base) return { url: null };
    const url = `${base}?client_reference_id=${userId}&prefilled_email=${encodeURIComponent(email)}`;
    return { url };
  });

  // Tester/beta invite code redemption
  ipcMain.handle('redeem-tester-code', async (_, { code }) => {
    if (!code) return { ok: false, error: 'No code entered' };
    const normalized = code.trim().toUpperCase();
    const validCodes = (APP_CONFIG.testerCodes ?? []).map(c => c.toUpperCase());
    if (!validCodes.includes(normalized)) return { ok: false, error: 'Invalid code' };

    const userId      = store.get('sbUserId');
    const accessToken = store.get('sbAccessToken');

    // Sticky local override — guarantees Max access even though the server-side
    // tier PATCH below is blocked by RLS (needs service_role). Survives refreshes.
    store.set('testerTier', 'max');
    store.set('sbTier', 'max');
    store.set('sbTierTs', Date.now());

    // Best-effort server update (works only if an Edge Function / service-role path exists)
    if (userId && accessToken && sbReady()) {
      try {
        await fetch(`${sbUrl()}/rest/v1/profiles?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': sbKey(),
            'Authorization': `Bearer ${accessToken}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ tier: 'max' }),
        });
      } catch (e) {
        console.warn('[redeem] DB update failed (expected if RLS blocks user writes):', e.message);
      }
    }
    push('tier-updated', { tier: 'max' });
    return { ok: true, tier: 'max' };
  });

  // Returns { tier, used, limit }
  ipcMain.handle('check-license', async () => {
    // Fire-and-forget tier refresh
    refreshTierFromServer().catch(() => {});
    return getLicenseInfo();
  });

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
    const limitHit = await checkLimitsAsync();
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
      push('stream-error', { message: friendlyError(err) });
    } finally {
      isStreaming = false;
    }
    return { ok: true };
  });

  ipcMain.on('clear-history', () => {
    chatHistory = [];
    push('history-cleared', {});
  });

  // ── Memory (facts the AI learns about you) ─────────────────────────────────
  ipcMain.handle('get-memory',    ()      => ({ facts: getMemory(), journal: (store.get('journal') ?? []).slice(0, 30) }));
  ipcMain.handle('clear-memory',  ()      => { saveMemory([]); store.set('journal', []); return { ok: true }; });
  ipcMain.handle('delete-fact',   (_, k)  => { saveMemory(getMemory().filter(f => f.key !== k)); return { ok: true }; });
  ipcMain.handle('add-note',      (_, text) => {
    upsertFacts([{ key: 'note_' + Date.now(), value: text, type: 'personal' }]);
    extractAndLearn(text, '').catch(() => {});
    return { ok: true };
  });

  ipcMain.on('flash-window', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setWindowMode('fullscreen');
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') app.dock?.bounce?.('critical');
    else mainWindow.flashFrame(true);
  });
  ipcMain.on('hide-window',     () => mainWindow?.hide());
  ipcMain.on('minimize-window', () => mainWindow?.minimize());
  ipcMain.on('open-settings',  openSettings);

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
  ipcMain.handle('get-app-version', () => app.getVersion());

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

  autoUpdater.on('update-available', (info) => {
    const v = info.version;
    let url;
    if (process.platform === 'darwin') {
      const arch = process.arch === 'arm64' ? '-arm64' : '';
      url = `https://github.com/emirilgin/etaros/releases/download/v${v}/Etaros-${v}${arch}.dmg`;
    } else {
      url = `https://github.com/emirilgin/etaros/releases/download/v${v}/Etaros.Setup.${v}.exe`;
    }
    push('update-status', { status: 'available', version: v, url });
  });
  autoUpdater.on('update-not-available', ()     => {});
  autoUpdater.on('error',                (err)  => console.warn('[updater]', err.message));

  // Check on launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);

  // IPC: renderer opens download page
  ipcMain.on('install-update', () => {
    shell.openExternal('https://github.com/emirilgin/etaros/releases/latest');
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  initChat(); // restore last conversation
  createMainWindow();
  createTray();
  registerIPC();
  setupAutoUpdater();

  // Onboarding is handled by the in-app login/register overlay (renderer).
  // The legacy setup.html window was retired — it duplicated the auth flow.

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

// ─── Deep-link protocol: sidekick:// ──────────────────────────────────────────
// Used by the password-reset page to bring the app forward after a reset.
app.setAsDefaultProtocolClient('sidekick');

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setWindowMode('fullscreen');
  mainWindow.show();
  mainWindow.focus();
  // Tell renderer what deep-link fired (e.g. sidekick://reset-done)
  push('deep-link', { url });
});

// Windows: second-instance deep-link
app.on('second-instance', (_event, argv) => {
  const url = argv.find(a => a.startsWith('sidekick://'));
  if (mainWindow && !mainWindow.isDestroyed()) {
    setWindowMode('fullscreen');
    mainWindow.show();
    mainWindow.focus();
    if (url) push('deep-link', { url });
  }
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
