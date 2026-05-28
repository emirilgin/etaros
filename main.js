'use strict';

const {
  app, BrowserWindow, desktopCapturer, ipcMain,
  Tray, Menu, nativeImage, Notification, screen, globalShortcut, shell,
} = require('electron');
const path           = require('path');
const { randomUUID } = require('crypto');
const Store          = require('electron-store');

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
const FREE_TOTAL = 5;   // lifetime free messages
const PRO_LIMIT  = 50;  // messages per day on Pro

// ─── System prompts ───────────────────────────────────────────────────────────
const SCAN_PROMPT = `You are Sidekick — a sharp, real-time AI companion watching the user's screen.
Spot what's happening and surface the most valuable insight possible.

Watch for: shopping (overpricing, scams, better deals, coupon codes), food (what they're ordering, healthier/cheaper alternatives, local spots), finance (subscriptions, unusual charges, better rates), health concerns, travel prices, time-wasting patterns, security risks.

Respond ONLY as valid JSON:
{"items":[{"type":"save|risk|rec|tip|warn","title":"short punchy title under 8 words","detail":"specific detail with real names/numbers/prices","action":"concrete next step","notify":true,"query":"product search term"}],"summary":"one sharp sentence","context":"shopping|food|finance|travel|health|productivity|other"}

For shopping items: set "query" to the best search term to find this product cheaper (e.g. "Sony WH-1000XM5 headphones"). Leave "query" null for non-shopping items.
Mark notify:true EXTREMELY rarely — only active scam/fraud risk, confirmed security threat, or data being stolen RIGHT NOW. Never for deals, tips, recommendations, or general advice. Default is always notify:false. Max 1 notify:true per scan.
If nothing notable is happening, return: {"items":[],"summary":"","context":"other"}`;

const CHAT_PROMPT = `You are Sidekick — a sharp, witty AI companion who sees the user's screen in real time. You're like that brilliant friend who notices everything and tells it straight — direct, specific, occasionally funny, never boring.

Be direct and specific. Name real products, real prices, real restaurants, real alternatives. Don't hedge. Lead with what's most useful.

If they ask about food: give real restaurant names, specific dishes, honest takes on what to order. If they mention a city, give local spots.
If they ask about shopping: give real prices, real competitors, actual coupon codes if you know them.
If you spot something on screen worth flagging: call it out naturally in conversation.
If they want to chat: be warm, engaging, human.

Use markdown for structure when helpful. Go deep when asked. Keep it conversational.`;

// ─── Store ────────────────────────────────────────────────────────────────────
const store = new Store();

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

// ─── Tier system (local, no server needed) ────────────────────────────────────
function getTier() {
  const key = String(store.get('licenseKey') ?? '').trim();
  if (!key) return 'free';
  // Max keys start with SMAX-, Pro keys with SIDE-
  if (/^SMAX-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return 'max';
  if (/^SIDE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return 'pro';
  if (/^STEST-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return 'max'; // tester key
  return 'free';
}

function getFreeUsed()  { return Number(store.get('freeUsed') ?? 0); }
function bumpFreeUsed() { const n = getFreeUsed() + 1; store.set('freeUsed', n); return n; }

function getProUsed() {
  const today = new Date().toISOString().slice(0, 10);
  if (store.get('proDate') !== today) { store.set('proDate', today); store.set('proUsed', 0); }
  return Number(store.get('proUsed') ?? 0);
}
function bumpProUsed() { const n = getProUsed() + 1; store.set('proUsed', n); return n; }

function getLicenseInfo() {
  const tier = getTier();
  if (tier === 'max') return { tier, used: 0, limit: 0 };
  if (tier === 'pro') return { tier, used: getProUsed(),  limit: PRO_LIMIT  };
  return                      { tier, used: getFreeUsed(), limit: FREE_TOTAL };
}

// ─── Notifications ────────────────────────────────────────────────────────────
function fireNotification(title, body) {
  const now = Date.now();
  if (now - lastNotifyTime < NOTIFY_COOLDOWN_MS) return;
  if (!Notification.isSupported()) return;
  lastNotifyTime = now;
  try {
    const n = new Notification({
      title:    '✦ Sidekick',
      subtitle: title,             // macOS: shows under title
      body:     String(body || '').slice(0, 160),
      silent:   false,             // plays system notification sound
    });
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        // Uncollapse if collapsed
        const mode = String(store.get('windowMode') || 'sidebar');
        if (mode !== 'fullscreen') {
          mainWindow.setResizable(false);
          mainWindow.setMovable(false);
          mainWindow.setBounds(dockedBounds(false), true);
          if (process.platform === 'darwin') mainWindow.setAlwaysOnTop(true, 'screen-saver');
          else mainWindow.setAlwaysOnTop(true);
          store.set('windowMode', 'sidebar');
        }
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
  if (!key) throw new Error('No Gemini key found. Get a free one at aistudio.google.com → Get API key → Create API key in new project');

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
      const clean = msg.includes('API key') ? 'Invalid Gemini API key. Get a fresh one at aistudio.google.com'
                  : msg.includes('limit: 0')  ? 'Gemini quota exhausted. Get a new API key at aistudio.google.com (create a NEW project, no billing).'
                  : msg.split('\n')[0]; // first line only — strip the giant JSON
      throw new Error(clean);
    }
  }

  // All models exhausted — show helpful message
  const retryMatch = String(lastErr?.message ?? '').match(/retry[^0-9]*(\d+)/i);
  const wait = retryMatch ? ` Try again in ${retryMatch[1]}s.` : '';
  throw new Error(`Gemini rate limit hit on all models.${wait} Your API key may be from a billing-enabled project — create a new key at aistudio.google.com in a project WITHOUT billing enabled.`);
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
  if (tier === 'pro' && getProUsed() >= PRO_LIMIT)  return 'pro';
  if (tier === 'free' && getFreeUsed() >= FREE_TOTAL) return 'free';
  return null; // ok
}

function bumpUsage() {
  const tier = getTier();
  if (tier === 'pro')  return { tier, used: bumpProUsed(),  limit: PRO_LIMIT  };
  if (tier === 'free') return { tier, used: bumpFreeUsed(), limit: FREE_TOTAL  };
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
    const reply = await streamAI(CHAT_PROMPT, chatHistory);
    chatHistory.push({ role: 'assistant', content: reply });

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
    const b64    = thumbToB64(thumbnail);
    const city   = String(store.get('city') ?? '').trim();
    const prompt = `Analyse this screen.${city ? ` User is in ${city}.` : ''} Respond ONLY with valid JSON.`;
    const scanHistory = [{ role: 'user', content: prompt, _b64: b64 }];

    const raw = await streamAI(SCAN_PROMPT, scanHistory);

    let parsed = null;
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
    if (!parsed?.items?.length) return;

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
  const secs = Number(store.get('scanInterval') ?? 5);
  if (!secs) return;
  scanTimer = setInterval(runScan, secs * 1000);
}
function stopScanLoop() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
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
  mainWindow = new BrowserWindow({
    ...dockedBounds(),
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: false, resizable: false, movable: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  mainWindow.loadFile('index.html');
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
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
    if (s.geminiKey    != null)   store.set('geminiKey',    s.geminiKey);
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

  // Returns { tier, used, limit } — no server call needed
  ipcMain.handle('check-license', () => getLicenseInfo());

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

  ipcMain.on('clear-history', () => {
    chatHistory = [];
    push('history-cleared', {});
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
  ipcMain.on('set-mode',       (_, m)  => setWindowMode(m));
  ipcMain.on('open-url',       (_, u)  => shell.openExternal(u));
  ipcMain.on('open-urls',      (_, urls) => {
    // Open multiple URLs as separate tabs — stagger slightly so browser groups them
    urls.forEach((u, i) => setTimeout(() => shell.openExternal(u), i * 120));
  });
  ipcMain.handle('get-window-mode', () => String(store.get('windowMode') || 'sidebar'));
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  registerIPC();

  // Show setup screen on first run
  if (!store.get('setupDone')) {
    setTimeout(openSetup, 800); // slight delay so main window appears first
    store.set('setupDone', true);
  }
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
  if (store.get('autoScan') !== false) startScanLoop();
});

app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('activate', () => { mainWindow?.show(); mainWindow?.focus(); }); // dock click
app.on('before-quit', () => { app.isQuitting = true; stopScanLoop(); globalShortcut.unregisterAll(); });
