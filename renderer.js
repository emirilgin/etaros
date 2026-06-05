'use strict';

// ─── DOM ─────────────────────────────────────────────────────────────────────
const shell        = document.getElementById('shell');
const strip        = document.getElementById('strip');
const hdrDot       = document.getElementById('hdr-dot');
const tierBadge    = document.getElementById('tier-badge');
const upgrade      = document.getElementById('upgrade');
const counter      = document.getElementById('counter');
const feed         = document.getElementById('feed');
const empty        = document.getElementById('empty');
const trialInfo    = document.getElementById('trial-info');
const thinking     = document.getElementById('thinking');
const thinkTime    = document.getElementById('think-time');
const msg          = document.getElementById('msg');
const send         = document.getElementById('send');
const scanBtn      = document.getElementById('scan-btn');
const settingsBtn  = document.getElementById('settings-btn');
const collapseBtn  = document.getElementById('collapse-btn');
const clearBtn     = document.getElementById('clear-btn');
const expandBtn    = document.getElementById('expand-btn');
const shrinkBtn    = document.getElementById('shrink-btn');
const hideBtn      = document.getElementById('hide-btn');
const upBtn        = document.getElementById('up-btn');
const newChatBtn   = document.getElementById('new-chat-btn');
const scanFsBtn    = document.getElementById('scan-fs-btn');
const settingsFsBtn= document.getElementById('settings-fs-btn');
const memoryBtn    = document.getElementById('memory-btn');
const memModal     = document.getElementById('memory-modal');
const memBody      = document.getElementById('mem-body');
const memCount     = document.getElementById('mem-count');
const memNoteInput = document.getElementById('mem-note-input');
const memNoteBtn   = document.getElementById('mem-note-btn');
const memCloseBtn  = document.getElementById('mem-close-btn');
const memClearBtn  = document.getElementById('mem-clear-btn');

// ─── State ────────────────────────────────────────────────────────────────────
let collapsed      = false;
let hasMessages    = false;
let userScrolled   = false;
let lastMsgTime    = 0;
let streamEl       = null;
let streamBuffer   = '';
let currentMode    = 'sidebar';
let pendingPreview = null; // screenshot b64 to attach to next user bubble

// ─── Time utils ───────────────────────────────────────────────────────────────
const fmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const now = () => fmt.format(new Date());

// ─── Simple markdown renderer ─────────────────────────────────────────────────
function md(raw) {
  let s = raw
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_,lang,code) =>
    `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  s = s.replace(/^---+$/gm, '<hr>');
  s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  s = s.replace(/<\/ul>\s*<ul>/g, '');
  s = s.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  s = s.replace(/(<oli>[\s\S]*?<\/oli>)/g, '<ol>$1</ol>');
  s = s.replace(/<\/ol>\s*<ol>/g, '');
  s = s.replace(/<oli>/g,'<li>').replace(/<\/oli>/g,'</li>');
  const BLOCK = /^<(h[123]|ul|ol|pre|hr)/;
  s = s.split(/\n\n+/).map(chunk => {
    chunk = chunk.trim();
    if (!chunk) return '';
    if (BLOCK.test(chunk)) return chunk;
    return `<p>${chunk.replace(/\n/g,'<br>')}</p>`;
  }).join('\n');
  return s;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Scroll ───────────────────────────────────────────────────────────────────
function scrollBottom(force = false) {
  if (force || !userScrolled) feed.scrollTop = feed.scrollHeight;
}
feed.addEventListener('scroll', () => {
  userScrolled = feed.scrollHeight - feed.scrollTop - feed.clientHeight > 60;
});

// ─── Show feed ────────────────────────────────────────────────────────────────
function showFeed() {
  if (!hasMessages) { empty.style.display = 'none'; hasMessages = true; }
}

// ─── Time divider ─────────────────────────────────────────────────────────────
function maybeTimeDivider() {
  const GAP = 8 * 60 * 1000;
  if (hasMessages && Date.now() - lastMsgTime > GAP) {
    const d = document.createElement('div');
    d.className = 'time-div';
    d.textContent = now();
    feed.insertBefore(d, thinking);
  }
  lastMsgTime = Date.now();
}

// ─── Mode ─────────────────────────────────────────────────────────────────────
function applyMode(_mode) {
  currentMode = 'fullscreen'; // always fullscreen layout
  document.documentElement.dataset.mode = 'fullscreen';
  shell?.classList.remove('collapsed');
  collapsed = false;
}

// ─── Collapse ─────────────────────────────────────────────────────────────────
collapseBtn.addEventListener('click', () => setCollapsed(true));
strip.addEventListener('click',       () => setCollapsed(false));
function setCollapsed(v) {
  collapsed = v;
  shell.classList.toggle('collapsed', v);
  window.sk.setCollapsed(v);
}

// ─── Window mode toggle ────────────────────────────────────────────────────────
expandBtn.addEventListener('click', () => window.sk.setMode('fullscreen'));
shrinkBtn.addEventListener('click', () => window.sk.setMode('sidebar'));
hideBtn.addEventListener('click',   () => window.sk.hideWindow());

// ─── Conversation list ────────────────────────────────────────────────────────
const convList = document.getElementById('conv-list');

function renderConvList(conversations, activeChatId) {
  if (!convList) return;
  window._lastConvData = { conversations, activeChatId };
  if (!conversations?.length) {
    convList.innerHTML = '<div class="conv-empty">No conversations yet</div>';
    return;
  }
  const fmtConvDate = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const days = Math.floor((now - d) / 86400000);
    if (days < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  convList.innerHTML = conversations.map(c => `
    <div class="conv-item${c.id === activeChatId ? ' active' : ''}" data-id="${esc(c.id)}" data-pinned="${c.pinned ? '1' : '0'}">
      ${c.pinned ? '<span class="conv-pin-icon">📌</span>' : ''}
      <span class="conv-title">${esc(c.title || 'New chat')}</span>
      <span class="conv-date">${fmtConvDate(c.updatedAt)}</span>
      <button class="conv-menu-btn" data-id="${esc(c.id)}" title="Options">···</button>
    </div>
  `).join('');

  convList.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', async e => {
      if (e.target.classList.contains('conv-menu-btn')) return;
      if (e.target.classList.contains('conv-rename-input')) return;
      const id = el.dataset.id;
      const res = await window.sk.loadChat(id);
      if (res) {
        convList.querySelectorAll('.conv-item').forEach(x => x.classList.toggle('active', x.dataset.id === id));
        clearFeed();
        if (res.messages?.length) {
          res.messages.forEach(m => {
            if (m.role === 'user')      appendUser(m.content);
            else if (m.role === 'assistant') appendAiGroup(m.content);
          });
        } else {
          showEmpty();
        }
      }
    });
    // Right-click → context menu
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      showConvCtxMenu(el.dataset.id, e.clientX, e.clientY, el.dataset.pinned === '1');
    });
  });

  convList.querySelectorAll('.conv-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = btn.closest('.conv-item');
      showConvCtxMenu(btn.dataset.id, e.clientX, e.clientY, item?.dataset.pinned === '1');
    });
  });
}

// ─── Conversation context menu ────────────────────────────────────────────────
let ctxTargetId   = null;
let ctxTargetItem = null;
const ctxMenu     = document.getElementById('conv-ctx-menu');

function showConvCtxMenu(id, x, y, isPinned) {
  ctxTargetId = id;
  ctxTargetItem = convList.querySelector(`.conv-item[data-id="${id}"]`);
  document.getElementById('ctx-pin').textContent = isPinned ? '📌 Unpin' : '📌 Pin';
  ctxMenu.style.display = 'block';
  // Position so it doesn't overflow viewport
  const menuW = 160, menuH = 120;
  const left  = Math.min(x, window.innerWidth  - menuW - 8);
  const top   = Math.min(y, window.innerHeight - menuH - 8);
  ctxMenu.style.left = left + 'px';
  ctxMenu.style.top  = top  + 'px';
}

function hideConvCtxMenu() {
  ctxMenu.style.display = 'none';
  ctxTargetId   = null;
  ctxTargetItem = null;
}

document.addEventListener('click', e => {
  if (ctxMenu && !ctxMenu.contains(e.target)) hideConvCtxMenu();
  const pm = document.getElementById('profile-menu');
  const ur = document.getElementById('sb-user-row');
  if (pm && ur && !pm.contains(e.target) && !ur.contains(e.target)) {
    pm.classList.remove('open');
  }
});

document.getElementById('ctx-rename')?.addEventListener('click', () => {
  const item = ctxTargetItem;
  const id   = ctxTargetId;
  hideConvCtxMenu();
  if (!item) return;
  // Show inline rename input
  const titleEl = item.querySelector('.conv-title');
  const current = titleEl.textContent;
  const input   = document.createElement('input');
  input.className = 'conv-rename-input';
  input.value = current;
  titleEl.replaceWith(input);
  input.focus(); input.select();
  async function doRename() {
    const newTitle = input.value.trim() || current;
    const res = await window.sk.renameChat(id, newTitle);
    renderConvList(res.conversations, res.activeChatId);
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); doRename(); }
    if (e.key === 'Escape') { renderConvList(window._lastConvData?.conversations || [], window._lastConvData?.activeChatId); }
  });
  input.addEventListener('blur', doRename);
});

document.getElementById('ctx-pin')?.addEventListener('click', async () => {
  const id = ctxTargetId;
  hideConvCtxMenu();
  if (!id) return;
  const res = await window.sk.pinChat(id);
  renderConvList(res.conversations, res.activeChatId);
});

document.getElementById('ctx-delete')?.addEventListener('click', async () => {
  const id = ctxTargetId;
  hideConvCtxMenu();
  if (!id) return;
  const res = await window.sk.deleteChat(id);
  renderConvList(res.conversations, res.activeChatId);
  if (res.activeChatId !== id) return;
  clearFeed(); showEmpty();
});

// New chat button
document.getElementById('new-chat-btn')?.addEventListener('click', async () => {
  switchTab('chat');
  const res = await window.sk.newChat();
  renderConvList(res.conversations, res.id);
  clearFeed(); showEmpty();
  showToast('New conversation', 'info', 1800);
});

// Listen for conv updates from main (after each AI reply)
window.sk.on('conv-updated', ({ conversations, activeChatId }) => {
  renderConvList(conversations, activeChatId);
});

function clearFeed() {
  if (!feed) return;
  const children = Array.from(feed.children);
  children.forEach(c => {
    if (c.id !== 'empty' && c.id !== 'thinking') c.remove();
  });
}

function showEmpty() {
  if (empty) empty.style.display = '';
  hasMessages = false;
}

// ─── Traffic lights (fullscreen macOS titlebar) ───────────────────────────────
document.getElementById('tl-close')?.addEventListener('click', () => window.sk.hideWindow());
document.getElementById('tl-min')  ?.addEventListener('click', () => window.sk.minimizeWindow());
document.getElementById('tl-max')  ?.addEventListener('click', () => window.sk.setMode('fullscreen'));

// ─── Buttons ──────────────────────────────────────────────────────────────────
// settings button removed from sidebar
settingsFsBtn.addEventListener('click',  () => openSettingsPage('profile'));
upBtn.addEventListener('click',          () => openSettingsPage('plan'));
clearBtn.addEventListener('click', () => window.sk.clearHistory());

// No-key banner → open inline settings at the AI / Gemini-key section
const noKeyBanner = document.getElementById('no-key-banner');
const noKeyBtn    = document.getElementById('no-key-settings-btn');
if (noKeyBtn) noKeyBtn.addEventListener('click', () => openSettingsPage('advanced'));
window.sk.on('no-key', () => { if (noKeyBanner) noKeyBanner.style.display = 'flex'; });
window.sk.on('key-ok',  () => { if (noKeyBanner) noKeyBanner.style.display = 'none'; });

// ─── Offline detection ────────────────────────────────────────────────────────
// Anticipate the failure: show status before the user wastes a message offline.
const offlineBanner = document.createElement('div');
offlineBanner.id = 'offline-banner';
offlineBanner.style.cssText =
  'display:none;position:fixed;top:44px;left:0;right:0;z-index:9997;padding:7px 12px;' +
  'background:#7a1f1f;color:#ffe;font-size:12.5px;text-align:center;font-weight:500;' +
  '-webkit-app-region:no-drag;letter-spacing:.01em';
offlineBanner.textContent = '⚠ You\'re offline — AI features need an internet connection.';
document.body.appendChild(offlineBanner);

function setOnlineState(online) {
  offlineBanner.style.display = online ? 'none' : 'block';
  if (send) send.disabled = !online;
  if (msg)  msg.placeholder = online
    ? (msg.dataset.basePlaceholder || msg.placeholder)
    : 'Offline — reconnect to chat';
}
if (msg) msg.dataset.basePlaceholder = msg.placeholder;
window.addEventListener('online',  () => { setOnlineState(true);  showToast('Back online', 'ok'); });
window.addEventListener('offline', () => { setOnlineState(false); });
setOnlineState(navigator.onLine);

// Scan
async function doScan(btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '…';
  await window.sk.manualScan();
  btn.disabled = false; btn.textContent = orig;
}
scanBtn.addEventListener('click',    () => doScan(scanBtn));
scanFsBtn?.addEventListener('click', () => doScan(scanFsBtn));
document.getElementById('scan-sidebar-btn')?.addEventListener('click', () => doScan(scanBtn));
document.getElementById('scan-input-btn')?.addEventListener('click', () => doScan(scanBtn));

// Region selector button — CMD+SHIFT+4 style
document.getElementById('region-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('region-btn');
  if (btn) { btn.style.opacity = '.4'; btn.style.pointerEvents = 'none'; }
  try {
    const result = await window.sk.regionSelect();
    if (result?.b64) {
      // Show as attached image, same as drag-drop
      pendingPreview = result.b64;
      const previewBar  = document.getElementById('drop-preview-bar');
      const previewImg  = document.getElementById('drop-preview-img');
      const previewName = document.getElementById('drop-preview-name');
      if (previewBar && previewImg) {
        previewImg.src      = `data:image/jpeg;base64,${result.b64}`;
        if (previewName) previewName.textContent = 'Region screenshot';
        previewBar.style.display = '';
        msg.placeholder = 'Ask about this region, or send to analyze…';
        msg.focus();
      }
    }
  } finally {
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
});
document.getElementById('clear-chat-btn')?.addEventListener('click',   () => window.sk.clearHistory());

// ─── Quick messages (chips + fs-nav) ─────────────────────────────────────────
function sendQuickMsg(text) {
  if (!text || streamEl) return;
  appendUser(text);
  send.disabled = true;
  window.sk.chat(text).then(() => { send.disabled = false; });
}

document.querySelectorAll('.empty-chip').forEach(chip =>
  chip.addEventListener('click', () => sendQuickMsg(chip.dataset.msg)));

document.querySelectorAll('.fs-quick').forEach(btn =>
  btn.addEventListener('click', () => sendQuickMsg(btn.dataset.msg)));

// ─── Input auto-grow + send button state ─────────────────────────────────────
msg.addEventListener('input', () => {
  msg.style.height = 'auto';
  msg.style.height = Math.min(msg.scrollHeight, 160) + 'px';
  send.disabled = !msg.value.trim() && !pendingDropB64;
});

// ─── Send ─────────────────────────────────────────────────────────────────────
async function sendMsg() {
  if (pendingDropB64) {
    await analyzeDropped(pendingDropB64, dropPreviewName?.textContent);
    return;
  }
  const text = msg.value.trim();
  if (!text || streamEl) return;
  appendUser(text);
  msg.value = ''; msg.style.height = 'auto';
  send.disabled = true;
  // Show spinning logo immediately (hidden once the stream starts)
  showFeed();
  thinking.style.display = 'flex';
  scrollBottom(true);
  await window.sk.chat(text);
  send.disabled = false;
}
send.addEventListener('click', sendMsg);
msg.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});

// ─── Drag & Drop image analysis ──────────────────────────────────────────────
const dropZone       = document.getElementById('drop-zone');
const dropPreviewBar = document.getElementById('drop-preview-bar');
const dropPreviewImg = document.getElementById('drop-preview-img');
const dropPreviewName= document.getElementById('drop-preview-name');
const dropClose      = document.getElementById('drop-preview-close');
const attachBtn      = document.getElementById('attach-btn');
const fileInput      = document.getElementById('file-input');

let pendingDropB64   = null;
let dragCounter      = 0;

function readFileAsB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => {
      // Strip data URL prefix → raw base64
      resolve(e.target.result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showDropPreview(file, b64) {
  pendingDropB64 = b64;
  dropPreviewImg.src  = `data:${file.type};base64,${b64}`;
  dropPreviewName.textContent = file.name || 'image';
  dropPreviewBar.style.display = 'block';
  msg.placeholder = 'Ask about this image, or send to analyze…';
  send.disabled = false; // enable send when image attached
}

function clearDropPreview() {
  pendingDropB64  = null;
  dropPreviewBar.style.display = 'none';
  dropPreviewImg.src  = '';
  dropPreviewName.textContent = '';
  msg.placeholder = 'Ask anything — or drop a screenshot…';
  fileInput.value = '';
  send.disabled = !msg.value.trim();
}

async function analyzeDropped(b64, labelText) {
  if (!b64) return;
  const text = msg.value.trim() || 'Analyze this image.';
  appendUser(text + (labelText ? ` [image: ${labelText}]` : ''));
  msg.value = ''; msg.style.height = 'auto';
  clearDropPreview();
  send.disabled = true;
  // Show preview thumbnail in feed
  push_screen_preview(b64);
  await window.sk.analyzeImage(b64);
  send.disabled = false;
}

function push_screen_preview(b64) {
  // Reuse existing screen-preview mechanism
  const event = new CustomEvent('sidekick-preview', { detail: { b64 } });
  document.dispatchEvent(event);
}
document.addEventListener('sidekick-preview', ({ detail }) => { pendingPreview = detail.b64; });

// Override sendMsg to include attached image
// Drag events — whole window
document.addEventListener('dragenter', e => {
  if (!e.dataTransfer.types.includes('Files')) return;
  dragCounter++;
  dropZone.classList.add('active');
  e.preventDefault();
});
document.addEventListener('dragleave', e => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropZone.classList.remove('active'); }
});
document.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('drop', async e => {
  e.preventDefault();
  dragCounter = 0;
  dropZone.classList.remove('active');

  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;

  try {
    const b64 = await readFileAsB64(file);
    const text = msg.value.trim();
    if (text) {
      // Has message → analyze immediately
      await analyzeDropped(b64, file.name);
    } else {
      // No message → show preview, let user add context
      showDropPreview(file, b64);
    }
  } catch (err) {
    console.error('Drop read error:', err);
  }
});

// 📎 attach buttons → file picker
attachBtn?.addEventListener('click', () => fileInput?.click());
document.getElementById('upload-sidebar-btn')?.addEventListener('click', () => {
  fileInput?.click();
  switchTab('chat'); // switch to chat so the preview shows
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const b64 = await readFileAsB64(file);
    showDropPreview(file, b64);
  } catch (err) { console.error('File read error:', err); }
});

// Remove attached image
dropClose.addEventListener('click', clearDropPreview);

// ─── Render: user bubble ──────────────────────────────────────────────────────
function appendUser(text) {
  showFeed();
  maybeTimeDivider();
  const wrap = document.createElement('div');
  wrap.className = 'user-wrap';
  const bub = document.createElement('div');
  bub.className = 'user-bubble';
  if (pendingPreview) {
    bub.innerHTML = `<div class="screen-thumb-wrap">
      <img class="screen-thumb" src="data:image/jpeg;base64,${pendingPreview}" alt="screen">
      <span class="screen-thumb-label">SCREEN</span>
    </div>`;
    pendingPreview = null;
  }
  bub.innerHTML += esc(text);
  wrap.appendChild(bub);
  feed.insertBefore(wrap, thinking);
  scrollBottom(true);
}

// ─── Render: AI group ─────────────────────────────────────────────────────────
const AI_ICON_SVG = `<svg viewBox="0 0 32 32" fill="none"><path d="M3 16C3 16 8.5 7 16 7C23.5 7 29 16 29 16C29 16 23.5 25 16 25C8.5 25 3 16 3 16Z" stroke="url(#gi)" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/><circle cx="16" cy="16" r="5" stroke="url(#gi)" stroke-width="1.8" fill="none"/><circle cx="16" cy="16" r="2.3" fill="url(#gi)"/><defs><linearGradient id="gi" x1="3" y1="7" x2="29" y2="25" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#D4723A"/><stop offset="100%" stop-color="#A34E18"/></linearGradient></defs></svg>`;

function makeGroup() {
  // Claude-style: clean message, no per-message avatar or name label
  const el = document.createElement('div');
  el.className = 'group';
  return el;
}

// Render a complete AI message (for history restore)
function appendAiGroup(text) {
  showFeed();
  const el = makeGroup();
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.innerHTML = md(text);
  el.appendChild(msgDiv);
  feed.insertBefore(el, thinking);
}

// ─── Render: streaming ────────────────────────────────────────────────────────
function createStreamEl() {
  showFeed();
  const el = makeGroup();
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.innerHTML = '<div class="chat-body"></div><span class="stream-cursor"></span>';
  el.appendChild(msgDiv);
  feed.insertBefore(el, thinking);
  return el;
}

function appendChunk(text) {
  if (!streamEl) return;
  streamBuffer += text;
  streamEl.querySelector('.chat-body').innerHTML = md(streamBuffer);
  scrollBottom();
}

function finalizeStream(data) {
  if (!streamEl) return;
  const cursor = streamEl.querySelector('.stream-cursor');
  if (cursor) cursor.remove();
  streamEl.querySelector('.chat-body').innerHTML = md(streamBuffer);
  if (data?._tier) setTierDisplay(data._tier, data._used, data._limit);
  streamEl = null; streamBuffer = '';
  scrollBottom();
}

// ─── Render: insight cards ────────────────────────────────────────────────────
function renderAnalysis(data) {
  showFeed();
  maybeTimeDivider();
  const items = Array.isArray(data.items) ? data.items : [];

  // High-confidence active threat → fire the full danger alert
  const danger = items.find(i => i.type === 'risk' && i.notify);
  if (danger) triggerDangerAlert(danger);

  const group = makeGroup();
  const wrap  = document.createElement('div');
  wrap.className = 'cards-wrap';

  const TYPES = new Set(['save','risk','rec','tip','warn']);
  items.forEach(item => {
    const t = TYPES.has(item.type) ? item.type : 'tip';
    const c = document.createElement('div');
    c.className = `card ${t}`;
    let h = `<div class="card-top"><span class="badge ${t}">${t.toUpperCase()}</span><span class="card-title">${esc(item.title)}</span></div>`;
    if (item.detail) h += `<div class="card-detail">${esc(item.detail)}</div>`;
    if (item.action) h += `<span class="card-action">${esc(item.action)}</span>`;
    c.innerHTML = h;

    // Shopping item with a product query → show "Compare prices" button
    if (item.query) {
      const q   = encodeURIComponent(item.query);
      const btn = document.createElement('button');
      btn.className   = 'compare-btn';
      btn.textContent = 'Compare prices →';
      btn.addEventListener('click', () => {
        window.sk.openUrls([
          `https://www.google.com/search?q=${q}&tbm=shop`,
          `https://www.amazon.com/s?k=${q}`,
          `https://www.ebay.com/sch/i.html?_nkw=${q}`,
          `https://camelcamelcamel.com/search?sq=${q}`,
        ]);
      });
      c.appendChild(btn);
    }

    wrap.appendChild(c);
  });

  group.appendChild(wrap);
  if (data.summary) {
    const s = document.createElement('div');
    s.className = 'g-summary';
    s.textContent = data.summary;
    group.appendChild(s);
  }

  if (data?._tier) setTierDisplay(data._tier, data._used, data._limit);
  feed.insertBefore(group, thinking);
  scrollBottom();
}

// ─── Render: error ────────────────────────────────────────────────────────────
function appendError(message) {
  showFeed();
  if (streamEl) { finalizeStream({}); }
  const wrap = document.createElement('div');
  wrap.className = 'err';
  wrap.innerHTML = `<div class="err-inner"><span style="opacity:.6">△</span> ${esc(message)}</div>`;
  feed.insertBefore(wrap, thinking);
  scrollBottom();
}

// ─── Tier display ─────────────────────────────────────────────────────────────
function setTierDisplay(tier, used, limit) {
  tierBadge.style.display = 'block';
  counter.style.display   = 'block';
  if (tier === 'max') {
    tierBadge.textContent = 'Max';
    counter.style.display = 'none';
    upgrade.style.display = 'none';
    return;
  }
  if (tier === 'pro') {
    tierBadge.textContent = 'Pro';
    counter.textContent   = `Pro · unlimited`;
    counter.style.color   = 'var(--t3)';
    upgrade.style.display = 'none';
    return;
  }
  tierBadge.textContent = 'Free';
  counter.textContent   = `Free trial · ${used} / ${limit} messages`;
  counter.style.color   = (limit - used <= 1) ? 'var(--red)' : 'var(--t3)';
  if (used >= limit) upgrade.style.display = 'block';
}

// ─── Events from main ─────────────────────────────────────────────────────────
window.sk.on('stream-start', () => {
  streamBuffer = '';
  streamEl = createStreamEl();
  hdrDot.classList.add('on');
  document.getElementById('sb-mark')?.classList.add('spinning');
  thinking.style.display = 'none';
  thinkTime.textContent  = '';
});

window.sk.on('stream-chunk', ({ content }) => appendChunk(content));

window.sk.on('stream-done', (data) => {
  hdrDot.classList.remove('on');
  document.getElementById('sb-mark')?.classList.remove('spinning');
  finalizeStream(data);
});

window.sk.on('stream-error', ({ message }) => {
  hdrDot.classList.remove('on');
  document.getElementById('sb-mark')?.classList.remove('spinning');
  if (streamEl) { streamEl.remove(); streamEl = null; streamBuffer = ''; }
  appendError(message);
  showToast('Something went wrong', 'err', 3500);
});

// ─── Danger alert — unmissable warning on an active threat ────────────────────
let _dangerOpen = false;
function triggerDangerAlert(item) {
  if (_dangerOpen) return;
  _dangerOpen = true;
  const ov = document.getElementById('danger-overlay');
  if (!ov) { _dangerOpen = false; return; }
  document.getElementById('danger-title').textContent  = item.title || 'Threat detected';
  document.getElementById('danger-detail').textContent = item.detail || '';
  document.getElementById('danger-action').textContent = item.action || 'Do not enter any passwords or payment details. Close this page.';
  ov.style.display = 'flex';
  // bring app to front + flash
  window.sk.flashWindow?.();
  const close = () => { ov.style.display = 'none'; _dangerOpen = false; };
  document.getElementById('danger-dismiss').onclick = close;
  document.getElementById('danger-explain').onclick = () => {
    close();
    msg.value = `Explain this threat in detail and tell me exactly what to do: ${item.title} — ${item.detail || ''}`;
    sendMsg();
  };
}

window.sk.on('analysis', renderAnalysis);
window.sk.on('screen-preview', ({ b64 }) => { pendingPreview = b64; });

window.sk.on('scan-status', ({ scanning }) => {
  hdrDot.classList.toggle('on', scanning);
  if (scanning && !streamEl) {
    thinkTime.textContent  = now();
    thinking.style.display = 'flex';
    showToast('Scanning screen…', 'info', 2000);
  } else {
    thinking.style.display = 'none';
  }
});

// ─── Auto-update banner ───────────────────────────────────────────────────────
const updateBanner = document.getElementById('update-banner');
const updateMsg    = document.getElementById('update-msg');
const updateBtn    = document.getElementById('update-btn');

let _updateUrl = '';
window.sk.on('update-status', ({ status, version, url }) => {
  if (!updateBanner) return;
  if (status === 'available') {
    _updateUrl = url || 'https://github.com/emirilgin/sidekick/releases/latest';
    updateMsg.textContent = `◆ Etaros v${version} is available`;
    if (updateBtn) updateBtn.textContent = 'Download →';
    updateBanner.style.display = 'flex';
  }
});

if (updateBtn) {
  updateBtn.addEventListener('click', () => window.sk.openUrl(_updateUrl));
}

window.sk.on('error',          ({ message })       => appendError(message));
window.sk.on('upgrade-prompt', ({ tier, used, limit }) => {
  setTierDisplay(tier || 'free', used, limit);
  upgrade.style.display = 'block';
  // Clear limit-reached message in the feed
  showFeed();
  const m = document.createElement('div');
  m.className = 'limit-msg';
  m.innerHTML = `
    <div class="limit-msg-icon">⚡</div>
    <div class="limit-msg-title">You've used all ${limit || 5} free messages this month</div>
    <div class="limit-msg-sub">Upgrade to Pro for unlimited messages, AI Compare, and priority scanning.</div>
    <button class="limit-msg-btn" id="limit-upgrade-btn">Upgrade to Pro — €9/mo</button>`;
  feed.insertBefore(m, thinking);
  m.querySelector('#limit-upgrade-btn')?.addEventListener('click', () => openSettingsPage('plan'));
  scrollBottom(true);
  showToast('Free limit reached', 'err', 3500);
});
window.sk.on('mode-changed',   ({ mode })           => applyMode(mode));
window.sk.on('settings-updated', ()                  => init());

window.sk.on('history-cleared', () => {
  [...feed.children].forEach(c => {
    if (c.id !== 'empty' && c.id !== 'thinking') c.remove();
  });
  empty.style.display = 'flex';
  hasMessages = false;
  lastMsgTime = 0;
});

// ─── Memory modal ─────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  location:   '#3460A8', preference: '#C0601E', goal:    '#2A7A50',
  habit:      '#906818', personal:   '#6A6460', interest:'#8B5CF6',
  finance:    '#2A7A50', health:     '#B83030',
};

function renderMemory(facts) {
  if (!facts.length) {
    memBody.innerHTML = '<div class="mem-empty">Nothing remembered yet.<br>Start chatting and I\'ll learn about you automatically.</div>';
    memCount.textContent = '0 facts';
    return;
  }
  memCount.textContent = `${facts.length} fact${facts.length !== 1 ? 's' : ''}`;
  memBody.style.display = 'flex';
  memBody.style.flexDirection = 'column';
  memBody.style.gap = '6px';
  memBody.innerHTML = facts.map(f => {
    const color = TYPE_COLORS[f.type] || '#A09890';
    const keyLabel = (f.key || '').replace(/_/g, ' ');
    return `<div class="mem-fact-card">
      <div class="mem-fact-type-dot" style="background:${color}20;border:1.5px solid ${color}40;"></div>
      <div class="mem-fact-content">
        <div class="mem-fact-key">${esc(keyLabel)}</div>
        <div class="mem-fact-val">${esc(f.value)}</div>
      </div>
      <button class="mem-fact-del" data-key="${esc(f.key)}" title="Forget">×</button>
    </div>`;
  }).join('');
  memBody.querySelectorAll('.mem-fact-del').forEach(btn =>
    btn.addEventListener('click', async () => {
      await window.sk.deleteFact(btn.dataset.key);
      openMemory();
    }));
}

async function openMemory() {
  memModal.classList.add('open');
  const { facts, journal } = await window.sk.getMemory();
  renderMemory(facts, journal);
}

memoryBtn?.addEventListener('click', openMemory);
memCloseBtn?.addEventListener('click', () => memModal.classList.remove('open'));
memModal?.addEventListener('click', e => { if (e.target === memModal) memModal.classList.remove('open'); });

memNoteBtn?.addEventListener('click', async () => {
  const text = memNoteInput.value.trim();
  if (!text) return;
  memNoteBtn.textContent = '…';
  memNoteBtn.disabled = true;
  await window.sk.addNote(text);
  memNoteInput.value = '';
  memNoteBtn.textContent = 'Remember →';
  memNoteBtn.disabled = false;
  setTimeout(openMemory, 600); // give extraction a moment
});

memNoteInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter') memNoteBtn.click();
});

memClearBtn?.addEventListener('click', () => {
  showConfirm('Clear all memory? Etaros will forget everything it knows about you.', async () => {
    await window.sk.clearMemory();
    openMemory();
    showToast('Memory cleared', 'ok');
  });
});

// ─── Memory tabs ──────────────────────────────────────────────────────────────
document.getElementById('mem-tab-facts')?.addEventListener('click', () => {
  document.getElementById('mem-tab-facts').classList.add('active');
  document.getElementById('mem-tab-game').classList.remove('active');
  document.getElementById('mem-pane-facts').style.display = '';
  document.getElementById('mem-pane-game').style.display  = 'none';
});
document.getElementById('mem-tab-game')?.addEventListener('click', () => {
  document.getElementById('mem-tab-game').classList.add('active');
  document.getElementById('mem-tab-facts').classList.remove('active');
  document.getElementById('mem-pane-game').style.display  = '';
  document.getElementById('mem-pane-facts').style.display = 'none';
  loadNextQuestion();
});

// ─── Question game ────────────────────────────────────────────────────────────
// 200 questions across life, personality, preferences, habits, goals
const QUESTIONS = [
  // Identity
  "What do people usually come to you for advice about?",
  "What's something you're better at than most people you know?",
  "What's a skill you're secretly proud of?",
  "How would your closest friend describe you in 3 words?",
  "What's the last thing that made you genuinely laugh?",
  // Food & lifestyle
  "What's your go-to comfort food?",
  "Do you cook? What's your best dish?",
  "Are you a morning person or night owl?",
  "What does your ideal Sunday look like?",
  "Coffee, tea, or neither?",
  "What cuisine could you eat every day?",
  "Do you follow any diet (vegetarian, keto, etc.)?",
  "What food do you absolutely refuse to eat?",
  "Favorite drink on a night out?",
  "Do you prefer eating in or going out?",
  // Work & ambition
  "What are you working on that excites you most right now?",
  "What would you do if money wasn't a factor?",
  "What's your biggest professional goal this year?",
  "What skill do you most want to develop?",
  "What's your biggest distraction when you're trying to work?",
  "Are you more creative in the morning or evening?",
  "What kind of work environment do you thrive in?",
  "What's the hardest part of your job/school?",
  "What would make your work life 10x better?",
  "What's a project you abandoned that you wish you'd finished?",
  // Finance & spending
  "What's something you spend money on that others might find surprising?",
  "Are you a saver or a spender by nature?",
  "What's the last big purchase you regret?",
  "What's the last big purchase you're proud of?",
  "Do you track your expenses? If not, do you want to?",
  "What subscription do you pay for but rarely use?",
  "What would you do with an extra €1000 right now?",
  "What's your biggest recurring expense besides rent/food?",
  // Health
  "Do you exercise? What do you do?",
  "How many hours of sleep do you get on average?",
  "What's your energy like at 3pm?",
  "Do you take any supplements or vitamins?",
  "What's one health habit you want to build?",
  "How much water do you drink per day?",
  "What's your stress level like this week?",
  "Do you meditate or have a mindfulness practice?",
  // Tech & digital
  "What apps do you use every single day?",
  "What's your most-used website?",
  "iOS or Android?",
  "What gadget would you buy if money was no object?",
  "How many hours a day do you spend on your phone?",
  "What's a tech product you recommended to someone recently?",
  "Do you use any productivity tools? Which ones?",
  // Travel & places
  "Where do you want to travel most in the next year?",
  "What's the best place you've ever visited?",
  "City or nature when you travel?",
  "What's your hometown like?",
  "Do you prefer planning trips or going spontaneous?",
  "Beach or mountains?",
  "What's a place you'd love to live someday?",
  // Entertainment
  "What are you currently watching?",
  "What genre of music puts you in the best mood?",
  "What's a book that changed how you think?",
  "What's a podcast you'd recommend?",
  "What video game have you spent the most hours on?",
  "What's your go-to movie genre?",
  "What artist/musician do you love that most people haven't heard of?",
  "Last concert or live event you went to?",
  // Relationships & social
  "Are you more introverted or extroverted?",
  "What kind of people do you click with most?",
  "What's something people misunderstand about you?",
  "What's the best piece of advice someone gave you?",
  "Who do you admire most and why?",
  "What do you value most in a friend?",
  "What's a conversation topic you can talk about forever?",
  // Goals & values
  "What do you want your life to look like in 5 years?",
  "What's something you want to learn in the next 6 months?",
  "What does success mean to you?",
  "What fear is holding you back from something?",
  "What's the most important thing in your life right now?",
  "What's a belief you hold that most people disagree with?",
  "What's something you want to change about yourself?",
  "What legacy do you want to leave?",
  // Random / fun
  "What's your most used emoji?",
  "What's a useless talent you have?",
  "What's the weirdest thing you've ever eaten?",
  "What's a hobby you want to pick up someday?",
  "What's your most controversial food opinion?",
  "What's something you do that other people think is weird?",
  "What's a word or phrase you say too much?",
  "If you could have dinner with anyone (alive or dead), who?",
  "What's your guilty pleasure?",
  "What's one thing you'd do differently if you could start over?",
  // Shopping & deals
  "Do you prefer buying new or second-hand?",
  "What brand do you stay loyal to no matter what?",
  "What's your approach to shopping — research everything or impulse?",
  "What's something you always buy the expensive version of?",
  "What's something you always buy cheap?",
  "Do you use discount codes when shopping online?",
  "What's the best deal you've ever found?",
  // Online safety (relevant to the app)
  "Have you ever been scammed or almost scammed online?",
  "Do you reuse passwords across sites?",
  "Have you ever clicked a link you immediately regretted?",
  "Do you use a password manager?",
  "How careful are you about what you share online?",
  "Have you ever had an account hacked?",
  // Environment & home
  "Do you care about sustainability? How does it show?",
  "What's your living situation like?",
  "Do you have pets?",
  "What's your home workspace like?",
  "Are you a minimalist or do you like having stuff around?",
  // Learning
  "What's the last thing you learned that genuinely surprised you?",
  "How do you prefer to learn new things — videos, books, doing?",
  "What subject do you wish you studied more?",
  "What language do you want to learn?",
  "What's a topic you've been meaning to research?",
].sort(() => Math.random() - 0.5); // shuffle on load

let _qIndex = 0;
const _seenQ = new Set();

function loadNextQuestion() {
  // Pick a question not seen recently
  let attempts = 0;
  let q;
  do {
    _qIndex = Math.floor(Math.random() * QUESTIONS.length);
    q = QUESTIONS[_qIndex];
    attempts++;
  } while (_seenQ.has(q) && attempts < QUESTIONS.length);
  _seenQ.add(q);
  if (_seenQ.size > 50) _seenQ.clear(); // reset after 50 to allow repeats

  const el = document.getElementById('mem-game-q');
  const inp = document.getElementById('mem-game-input');
  const prog = document.getElementById('mem-game-progress');
  if (el) el.textContent = q;
  if (inp) { inp.value = ''; inp.focus(); }
  if (prog) prog.textContent = `Question · ${QUESTIONS.length.toLocaleString()} in the bank`;
}

document.getElementById('mem-game-skip')?.addEventListener('click', loadNextQuestion);

document.getElementById('mem-game-save')?.addEventListener('click', async () => {
  const q   = document.getElementById('mem-game-q')?.textContent;
  const ans = document.getElementById('mem-game-input')?.value.trim();
  if (!ans) { loadNextQuestion(); return; }
  const btn = document.getElementById('mem-game-save');
  btn.textContent = '…'; btn.disabled = true;
  await window.sk.addNote(`${q} → ${ans}`);
  btn.textContent = 'Save & next →'; btn.disabled = false;
  showToast('Remembered ✓', 'ok', 1600);
  loadNextQuestion();
});

document.getElementById('mem-game-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('mem-game-save').click(); }
});

// ─── Search engine ───────────────────────────────────────────────────────────
const enc = encodeURIComponent;

const SEARCH_CATS = [
  { id:'food',    icon:'◎', label:'Food',
    sites:(q,loc)=>[
      `https://www.google.com/maps/search/${enc(loc?q+' near '+loc:q)}`,
      `https://www.yelp.com/search?find_desc=${enc(q)}&find_loc=${enc(loc||'')}`,
      `https://www.ubereats.com/search?q=${enc(q)}`,
    ]},
  { id:'shop',    icon:'◈', label:'Shop',
    sites:(q)=>[
      `https://www.google.com/search?q=${enc(q)}&tbm=shop`,
      `https://www.amazon.com/s?k=${enc(q)}`,
      `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}`,
    ]},
  { id:'travel',  icon:'◇', label:'Travel',
    sites:(q)=>[
      `https://www.google.com/travel/flights?q=${enc(q)}`,
      `https://www.skyscanner.com/transport/flights/search/?query=${enc(q)}`,
      `https://www.booking.com/searchresults.html?ss=${enc(q)}`,
    ]},
  { id:'tech',    icon:'◆', label:'Tech',
    sites:(q)=>[
      `https://www.google.com/search?q=${enc(q)}`,
      `https://www.amazon.com/s?k=${enc(q)}`,
      `https://www.rtings.com/search#q=${enc(q)}`,
    ]},
  { id:'finance', icon:'◉', label:'Finance',
    sites:(q)=>[
      `https://finance.yahoo.com/search/?p=${enc(q)}`,
      `https://www.google.com/search?q=${enc(q)}+stock`,
      `https://www.investopedia.com/search/?q=${enc(q)}`,
    ]},
  { id:'health',  icon:'○', label:'Health',
    sites:(q)=>[
      `https://www.google.com/search?q=${enc(q)}`,
      `https://www.webmd.com/search/search_results/default.aspx?query=${enc(q)}`,
      `https://www.nhs.uk/search/results?q=${enc(q)}`,
    ]},
  { id:'home',    icon:'□', label:'Home',
    sites:(q,loc)=>[
      `https://www.airbnb.com/s/${enc(loc?q+' '+loc:q)}/homes`,
      `https://www.rightmove.co.uk/search.html#/for-sale?keywords=${enc(q)}`,
      `https://www.zillow.com/search/homes/${enc(q)}/`,
    ]},
  { id:'fun',     icon:'▷', label:'Fun',
    sites:(q)=>[
      `https://www.rottentomatoes.com/search?search=${enc(q)}`,
      `https://open.spotify.com/search/${enc(q)}`,
      `https://www.google.com/search?q=${enc(q)}`,
    ]},
];

const CAT_KEYS = {
  food:    /restaurant|cafe|pizza|sushi|burger|coffee|lunch|dinner|breakfast|takeaway|delivery|eat near|where to eat/i,
  shop:    /\bbuy\b|price|cheap|deal|amazon|ebay|discount|sale|coupon|order online/i,
  travel:  /flight|hotel|hostel|travel|trip|vacation|airbnb|booking\.com|resort/i,
  tech:    /\bphone\b|laptop|computer|gpu|cpu|headphones?|monitor|keyboard|iphone|macbook|review|specs/i,
  finance: /stock|crypto|bitcoin|invest|dividend|nasdaq|portfolio|\betf\b|btc|eth|forex/i,
  health:  /symptom|medicine|doctor|pain|workout|fitness|calorie|nutrition|side effect/i,
  home:    /\brent\b|apartment|flat|studio|house for sale|property|airbnb near/i,
  fun:     /\bmovie\b|film|series|netflix|spotify|anime|game\b|concert|ticket/i,
};

function detectCat(q) {
  for (const [id, rx] of Object.entries(CAT_KEYS)) if (rx.test(q)) return id;
  return null;
}

let selectedCat  = null;
let srchRecent   = JSON.parse(localStorage.getItem('sk-searches') || '[]');

function saveSrchRecent(q, catId) {
  srchRecent = [{ q, catId, ts: Date.now() },
    ...srchRecent.filter(r => r.q !== q)].slice(0, 12);
  localStorage.setItem('sk-searches', JSON.stringify(srchRecent));
}

let _lastSearchUrl   = '';
let _lastSearchLabel = '';
let _searchViewOpen  = false;

function getSearchViewBounds() {
  const panel    = document.getElementById('search-panel');
  const topBar   = document.querySelector('.search-top');
  const toolbar  = document.getElementById('search-webview-bar');
  if (!panel) return null;
  const pr = panel.getBoundingClientRect();
  const topH    = topBar   ? topBar.getBoundingClientRect().height   : 0;
  const barH    = toolbar  ? toolbar.getBoundingClientRect().height  : 36;
  return {
    x:      Math.round(pr.left),
    y:      Math.round(pr.top + topH + barH),
    width:  Math.round(pr.width),
    height: Math.round(pr.height - topH - barH),
  };
}

async function showSearchWebview(url, label) {
  _lastSearchUrl   = url;
  _lastSearchLabel = label || url;

  const body = document.getElementById('search-body');
  const bar  = document.getElementById('search-webview-bar');
  const lbl  = document.getElementById('search-web-url-label');
  if (body) body.style.display = 'none';
  if (bar)  bar.style.display  = 'flex';
  if (lbl)  lbl.textContent    = label || url;

  const bounds = getSearchViewBounds();
  if (!bounds || bounds.width < 10 || bounds.height < 10) {
    showToast('Search panel too small', 'err');
    return false;
  }
  try {
    _searchViewOpen = true;
    const res = await window.sk.showSearchBrowser({ url, ...bounds });
    if (!res?.ok) {
      showToast('Could not load: ' + (res?.error || 'unknown error'), 'err');
      return false;
    }
    return true;
  } catch (e) {
    showToast('Search browser error: ' + e.message, 'err');
    return false;
  }
}

async function hideSearchWebview() {
  const body = document.getElementById('search-body');
  const bar  = document.getElementById('search-webview-bar');
  if (body) body.style.display = '';
  if (bar)  bar.style.display  = 'none';
  if (_searchViewOpen) {
    _searchViewOpen = false;
    await window.sk.hideSearchBrowser();
  }
}

document.getElementById('search-web-back')?.addEventListener('click', hideSearchWebview);
document.getElementById('search-web-browser')?.addEventListener('click', async () => {
  const url = await window.sk.getSearchUrl() || _lastSearchUrl;
  if (url) window.sk.openUrl(url);
});
document.getElementById('search-web-ai')?.addEventListener('click', async () => {
  // Pro/Max only feature — free users get redirected to the upgrade page
  const lic = await window.sk.checkLicense();
  if (lic.tier === 'free') {
    showToast('AI Compare is a Pro feature', 'info', 2200);
    openSettingsPage('plan');
    return;
  }
  const url = await window.sk.getSearchUrl() || _lastSearchUrl;
  let q = _lastSearchLabel || document.getElementById('search-input')?.value || '';
  if (url && url.includes('google.com/search')) {
    try { q = new URL(url).searchParams.get('q') || q; } catch {}
  }
  if (!q) return;
  await hideSearchWebview();
  switchTab('chat');
  const prompt = `I'm looking to buy: "${q}"\n\nPlease compare prices and options:\n• Find the cheapest places to buy this (online + local stores)\n• Compare quality/reviews across options\n• Tell me if I should wait for a sale or buy now\n• Any coupons, cashback, or discount codes?\n• Recommend the best value option`;
  setTimeout(() => {
    if (msg) { msg.value = prompt; msg.style.height = 'auto'; sendMsg(); }
  }, 80);
});

// Handle window resize → update search view bounds
window.sk.on('search-view-resize', async () => {
  if (!_searchViewOpen) return;
  const url    = await window.sk.getSearchUrl();
  const bounds = getSearchViewBounds();
  if (bounds && url) window.sk.showSearchBrowser({ url, ...bounds });
});

async function doSearch(query, catOverride) {
  const q = (query || document.getElementById('search-input')?.value || '').trim();
  if (!q) return;
  const catId = catOverride !== undefined ? catOverride : (selectedCat || detectCat(q));
  saveSrchRecent(q, catId);
  const url = `https://www.google.com/search?q=${enc(q)}`;
  await showSearchWebview(url, q);
  renderSearch();
}

function doAiSearch() {
  const q = document.getElementById('search-input')?.value.trim();
  if (!q) return;
  switchTab('chat');
  setTimeout(() => { msg.value = q; msg.style.height = 'auto'; sendMsg(); }, 80);
}

function renderSearch() {
  const body = document.getElementById('search-body');
  if (!body) return;

  const catGrid = SEARCH_CATS.map(c => `
    <button class="search-cat-btn${selectedCat===c.id?' sel':''}" data-cat="${c.id}">
      <span class="search-cat-icon">${c.icon}</span>
      <span class="search-cat-label">${c.label}</span>
    </button>`).join('');

  const recentHtml = srchRecent.length ? `
    <div class="srch-hdr">Recent</div>
    ${srchRecent.slice(0,8).map((r,i)=>{
      const cat = SEARCH_CATS.find(c=>c.id===r.catId);
      return `<div class="srch-row" data-q="${esc(r.q)}" data-cat="${r.catId||''}">
        <span class="srch-row-icon">${cat?.icon||'○'}</span>
        <span class="srch-row-text">${esc(r.q)}</span>
        <span class="srch-row-cat">${cat?.label||''}</span>
        <button class="srch-row-del" data-idx="${i}">×</button>
      </div>`;
    }).join('')}` : `
    <div class="srch-empty">
      Search restaurants, deals, flights, health — anything.<br>
      <span style="font-size:11.5px">Pick a category or just type — Etaros routes<br>your query to the best sites automatically.</span>
    </div>`;

  body.innerHTML = `
    <div class="srch-hdr" style="padding-top:2px">Category</div>
    <div class="search-cat-grid">${catGrid}</div>
    ${recentHtml}`;

  body.querySelectorAll('.search-cat-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      selectedCat = (selectedCat === btn.dataset.cat) ? null : btn.dataset.cat;
      renderSearch();
      document.getElementById('search-input')?.focus();
    }));

  body.querySelectorAll('.srch-row').forEach(row =>
    row.addEventListener('click', e => {
      if (e.target.classList.contains('srch-row-del')) return;
      document.getElementById('search-input').value = row.dataset.q;
      doSearch(row.dataset.q, row.dataset.cat || null);
    }));

  body.querySelectorAll('.srch-row-del').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      srchRecent.splice(+btn.dataset.idx, 1);
      localStorage.setItem('sk-searches', JSON.stringify(srchRecent));
      renderSearch();
    }));
}

function loadSearch() {
  hideSearchWebview();
  renderSearch();
  setTimeout(() => document.getElementById('search-input')?.focus(), 60);
  // Mark AI Compare button with Pro badge for free users
  window.sk.checkLicense().then(lic => {
    const btn = document.getElementById('search-web-ai');
    if (!btn) return;
    if (lic.tier === 'free') {
      btn.style.opacity = '.55';
      btn.title = 'AI Compare — Pro & Max only';
      btn.textContent = '◆ AI Compare  PRO';
    } else {
      btn.style.opacity = '';
      btn.title = '';
      btn.textContent = '◆ AI Compare';
    }
  });
}

// ─── Tab system ───────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');

function switchTab(name) {
  if (name !== 'search' && _searchViewOpen) hideSearchWebview();
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === name + '-panel'));
  if (name === 'search')  { loadSearch(); }
  if (name === 'chat')    { setTimeout(() => msg?.focus(), 60); }
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ─── Search input wiring ──────────────────────────────────────────────────────
document.getElementById('search-go-btn')?.addEventListener('click', () => doSearch());
document.getElementById('search-ai-btn')?.addEventListener('click', doAiSearch);
document.getElementById('search-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.shiftKey)  { e.preventDefault(); doAiSearch(); }
  else if (e.key === 'Enter')           { e.preventDefault(); doSearch(); }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  counter.style.display   = 'none';
  upgrade.style.display   = 'none';
  tierBadge.style.display = 'none';

  const [lic, mode, convData] = await Promise.all([
    window.sk.checkLicense(),
    window.sk.getWindowMode(),
    window.sk.getConversations(),
  ]);

  applyMode(mode || 'fullscreen');
  setTierDisplay(lic.tier, lic.used, lic.limit);

  // Render conversation list
  if (convData) renderConvList(convData.conversations, convData.activeChatId);

  // Restore last conversation messages into feed
  if (convData?.conversations?.length) {
    const lastConv = convData.conversations.find(c => c.id === convData.activeChatId)
      ?? convData.conversations[0];
    if (lastConv?.messages?.length) {
      lastConv.messages.forEach(m => {
        if (m.role === 'user')           appendUser(m.content);
        else if (m.role === 'assistant') appendAiGroup(m.content);
      });
    }
  }

  if (lic.tier === 'free' && lic.used < lic.limit) {
    trialInfo.style.display = 'block';
    const rem = lic.limit - lic.used;
    trialInfo.textContent = `Free trial · ${rem} message${rem !== 1 ? 's' : ''} remaining`;
  } else {
    trialInfo.style.display = 'none';
  }

  // Show app version
  window.sk.getAppVersion?.().then(v => {
    const el = document.getElementById('app-version');
    if (el && v) el.textContent = `v${v}`;
  }).catch(() => {});
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  const t = theme || 'light';
  if (t === 'light') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('etaros_theme', t);
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t));
}
// Apply saved theme immediately on load
applyTheme(localStorage.getItem('etaros_theme') || 'light');
document.querySelectorAll('.theme-opt').forEach(btn =>
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));

// ─── Custom confirm dialog ────────────────────────────────────────────────────
function showConfirm(message, onOk) {
  const overlay = document.getElementById('confirm-overlay');
  const msg     = document.getElementById('confirm-msg');
  const okBtn   = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  if (!overlay) { if (window.confirm(message)) onOk(); return; }
  msg.textContent = message;
  overlay.style.display = 'flex'; // was display:none, now show as flex
  const close = () => { overlay.style.display = 'none'; };
  const okHandler     = () => { close(); onOk(); okBtn.removeEventListener('click', okHandler); cancelBtn.removeEventListener('click', cancelHandler); };
  const cancelHandler = () => { close(); okBtn.removeEventListener('click', okHandler); cancelBtn.removeEventListener('click', cancelHandler); };
  okBtn.addEventListener('click', okHandler);
  cancelBtn.addEventListener('click', cancelHandler);
}

// ─── Profile (avatar + name) ──────────────────────────────────────────────────
const sbUserRow    = document.getElementById('sb-user-row');
const sbUserAvatar = document.getElementById('sb-user-avatar');
const sbUserName   = document.getElementById('sb-user-name');

function applyProfile({ name, avatar }) {
  if (name)   sbUserName.textContent = name;
  if (avatar) {
    sbUserAvatar.innerHTML = `<img src="${avatar}" alt="avatar"/>`;
  }
}

// Click profile row → toggle profile menu
sbUserRow?.addEventListener('click', e => { e.stopPropagation(); toggleProfileMenu(); });

window.sk.on('profile-updated', applyProfile);

async function loadProfile() {
  const p = await window.sk.getProfile();
  applyProfile(p);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(text, type = '', duration = 2800) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { ok: '✓', err: '✕', info: '◆', '': '◆' };
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '◆'}</span>${text}`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

// ─── Profile menu ─────────────────────────────────────────────────────────────
function toggleProfileMenu() {
  const pm  = document.getElementById('profile-menu');
  const row = document.getElementById('sb-user-row');
  if (!pm) return;
  if (pm.classList.contains('open')) { pm.classList.remove('open'); return; }
  // Position above the profile row
  const rect = row.getBoundingClientRect();
  pm.style.left   = '8px';
  pm.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
  // Sync name/email/avatar
  window.sk.getProfile().then(p => {
    document.getElementById('pm-name').textContent  = (p.name && p.name !== 'You') ? p.name : 'You';
    document.getElementById('pm-email').textContent = p.email || '';
    const av = document.getElementById('pm-avatar');
    if (av) av.innerHTML = p.avatar
      ? `<img src="${p.avatar}" alt=""/>`
      : `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  });
  pm.classList.add('open');
}

document.getElementById('pm-profile-btn')?.addEventListener('click', () => {
  document.getElementById('profile-menu').classList.remove('open');
  openSettingsPage('profile');
});
document.getElementById('pm-plan-btn')?.addEventListener('click', () => {
  document.getElementById('profile-menu').classList.remove('open');
  openSettingsPage('plan');
});
document.getElementById('pm-advanced-btn')?.addEventListener('click', () => {
  document.getElementById('profile-menu').classList.remove('open');
  openSettingsPage('advanced');
});
document.getElementById('pm-help-btn')?.addEventListener('click', () => {
  document.getElementById('profile-menu').classList.remove('open');
  window.sk.openUrl('mailto:sidekickhelp@gmail.com');
});
document.getElementById('pm-logout-btn')?.addEventListener('click', () => {
  document.getElementById('profile-menu').classList.remove('open');
  showConfirm('Log out of Etaros?', async () => {
    showToast('Logged out', 'info');
    await window.sk.logout();
  });
});

// ─── Full-screen settings page ────────────────────────────────────────────────
const settingsPage = document.getElementById('settings-page');
let spAvatarDataUrl = null;

function switchSettingsTab(tabId) {
  // Settings is now a single scrollable page — scroll to section
  const target = document.getElementById(`sp-tab-${tabId}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openSettingsPage(section = 'profile') {
  if (!settingsPage) return;
  settingsPage.classList.add('open');
  switchSettingsTab(section);
  spAvatarDataUrl = null;

  // Load advanced/settings fields (now inline)
  window.sk.getSettings().then(s => {
    const city      = document.getElementById('adv-city');
    const autoScan  = document.getElementById('adv-auto-scan');
    const loginItem = document.getElementById('adv-login');
    if (city)      city.value        = s.city       || '';
    if (autoScan)  autoScan.checked  = Boolean(s.autoScan);
    if (loginItem) loginItem.checked = Boolean(s.startOnLogin);
    const interval = Number(s.scanInterval ?? 30);
    document.querySelectorAll('.adv-pill').forEach(p =>
      p.classList.toggle('active', Number(p.dataset.val) === interval));
    const prov = s.provider || 'builtin';
    document.querySelectorAll('.adv-pcard').forEach(c =>
      c.classList.toggle('active', c.dataset.prov === prov));
    const ownKeyField = document.getElementById('adv-own-key-field');
    const ownKey      = document.getElementById('adv-own-key');
    if (ownKeyField) ownKeyField.style.display = (prov === 'claude') ? '' : 'none';
    if (ownKey)      ownKey.value = s.apiKey || '';
    // Personal Gemini key
    const gKey    = document.getElementById('adv-gemini-key');
    const gStatus = document.getElementById('adv-gemini-status');
    if (gKey) gKey.value = s.geminiKey || '';
    if (gStatus) {
      gStatus.innerHTML = s.geminiKey
        ? '✓ Using your personal key — higher daily quota.'
        : 'Using shared key. Hit the daily limit? Paste your own free key from <a href="#" id="adv-gemini-link" style="color:var(--orange)">aistudio.google.com</a> for a higher personal quota.';
      // Re-bind link (innerHTML wiped listener)
      document.getElementById('adv-gemini-link')?.addEventListener('click', e => {
        e.preventDefault(); window.sk.openUrl('https://aistudio.google.com/app/apikey');
      });
    }
  });
  updateTesterStatus();

  window.sk.getProfile().then(p => {
    const n = document.getElementById('sp-name');
    const em = document.getElementById('sp-email');
    const lg = document.getElementById('sp-lang');
    if (n)  n.value  = (p.name && p.name !== 'You') ? p.name : '';
    if (em) em.value = p.email || '';
    if (lg && p.language) lg.value = p.language;
    const av = document.getElementById('sp-big-avatar');
    if (av) av.innerHTML = p.avatar
      ? `<img src="${p.avatar}" alt=""/>`
      : `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  });
  window.sk.checkLicense().then(lic => {
    // Update plan tiles
    ['free','pro','max'].forEach(tier => {
      const tile   = document.getElementById(`plan-tile-${tier}`);
      const action = document.getElementById(`plan-${tier}-action`);
      if (!tile) return;
      tile.classList.toggle('current', lic.tier === tier);
      // Highlight Pro row when user is on free plan
      tile.style.borderColor = (tier === 'pro' && lic.tier === 'free') ? 'var(--orange)' : '';
      if (action) {
        if (lic.tier === tier) {
          action.className = 'sp-plan-row-btn current-lbl';
          action.textContent = 'Current';
        } else if (tier === 'free') {
          action.className = 'sp-plan-row-btn locked';
          action.textContent = 'Downgrade';
        } else {
          action.className = 'sp-plan-row-btn upgrade';
          action.textContent = 'Upgrade →';
        }
      }
    });
    // Legacy compat
    const badge = document.getElementById('sp-tier-badge');
    const desc  = document.getElementById('sp-tier-desc');
    if (badge) badge.textContent = lic.tier;
    if (desc)  desc.textContent  = lic.tier === 'free' ? `${Math.max(0,lic.limit-lic.used)} of ${lic.limit} free messages remaining` : 'Unlimited';
  });
}

// Tab click handlers
document.querySelectorAll('.sp-tab').forEach(tab =>
  tab.addEventListener('click', () => switchSettingsTab(tab.dataset.spTab)));

document.getElementById('sp-back')?.addEventListener('click', () => settingsPage?.classList.remove('open'));

const spPfpInput = document.getElementById('sp-pfp-input');
document.getElementById('sp-big-avatar')?.addEventListener('click', () => spPfpInput?.click());
document.getElementById('sp-avatar-hint')?.addEventListener('click', () => spPfpInput?.click());
spPfpInput?.addEventListener('change', () => {
  const file = spPfpInput.files[0];
  if (!file) return;
  // Compress to max 200x200 before storing — prevents huge base64 in electron-store
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const MAX = 200;
    const scale = Math.min(MAX / img.width, MAX / img.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    spAvatarDataUrl = canvas.toDataURL('image/jpeg', 0.82);
    URL.revokeObjectURL(url);
    const av = document.getElementById('sp-big-avatar');
    if (av) av.innerHTML = `<img src="${spAvatarDataUrl}" alt=""/>`;
  };
  img.src = url;
  spPfpInput.value = '';
});

document.getElementById('sp-save-btn')?.addEventListener('click', async () => {
  const name     = document.getElementById('sp-name')?.value.trim() || 'You';
  const language = document.getElementById('sp-lang')?.value || 'en';
  const avatar   = spAvatarDataUrl || undefined;
  const activePill = document.querySelector('.adv-pill.active');
  const activeProv = document.querySelector('.adv-pcard.active');

  // Smart key routing: a Gemini key (AIza…) in any field goes to geminiKey,
  // a Claude key (sk-ant…) goes to apiKey — prevents the "pasted in wrong box" trap.
  let apiKey    = document.getElementById('adv-own-key')?.value.trim()    || '';
  let geminiKey = document.getElementById('adv-gemini-key')?.value.trim() || '';
  if (/^AIza/i.test(apiKey))    { geminiKey = apiKey; apiKey = ''; }
  if (/^sk-ant/i.test(geminiKey)) { apiKey = geminiKey; geminiKey = ''; }

  // Save profile + settings in one go
  await Promise.all([
    window.sk.saveProfile({ name, language, ...(avatar ? { avatar } : {}) }),
    window.sk.saveSettings({
      city:         document.getElementById('adv-city')?.value.trim()    || '',
      scanInterval: activePill ? Number(activePill.dataset.val)          : 30,
      autoScan:     document.getElementById('adv-auto-scan')?.checked    ?? false,
      startOnLogin: document.getElementById('adv-login')?.checked        ?? false,
      provider:     activeProv ? activeProv.dataset.prov                 : 'builtin',
      apiKey,
      geminiKey,
    }),
  ]);
  spAvatarDataUrl = null;
  settingsPage?.classList.remove('open');
  showToast('Settings saved', 'ok');
});

// Clear personal Gemini key
document.getElementById('adv-gemini-clear')?.addEventListener('click', () => {
  const g = document.getElementById('adv-gemini-key');
  if (g) g.value = '';
});
// Open Google AI Studio to get a free key
document.getElementById('adv-gemini-link')?.addEventListener('click', e => {
  e.preventDefault();
  window.sk.openUrl('https://aistudio.google.com/app/apikey');
});

document.getElementById('sp-upgrade-btn')?.addEventListener('click', () => openSettingsPage('plan'));
// Plan tile upgrade buttons → open Stripe with user ID
async function openUpgrade(planTier) {
  const res = await window.sk.authGetUpgradeUrl({ planTier });
  if (res?.url) {
    window.sk.openUrl(res.url);
  } else {
    // Fallback: no Stripe links configured yet
    showToast('Payment not configured yet', 'info');
  }
}
document.getElementById('plan-pro-action')?.addEventListener('click', () => openUpgrade('pro'));
document.getElementById('plan-max-action')?.addEventListener('click', () => openUpgrade('max'));
// sp-advanced-btn removed (advanced settings now inline in settings scroll)
document.getElementById('sp-help-btn2')?.addEventListener('click', () => window.sk.openUrl('mailto:sidekickhelp@gmail.com'));
document.getElementById('sp-logout-btn')?.addEventListener('click', () => {
  showConfirm('Log out of Etaros?', async () => {
    showToast('Logged out', 'info');
    await window.sk.logout();
    settingsPage?.classList.remove('open');
  });
});

// ─── Advanced Settings (inline in settings page) ──────────────────────────────
// Tester status helper — called when settings page opens
function updateTesterStatus() {
  window.sk.checkLicense().then(lic => {
    const el = document.getElementById('adv-tester-status');
    if (!el) return;
    if (lic.tier === 'max')      el.textContent = '✓ Max access active';
    else if (lic.tier === 'pro') el.textContent = '✓ Pro access active';
    else el.textContent = '';
  });
}

// Interval pills
document.querySelectorAll('.adv-pill').forEach(pill =>
  pill.addEventListener('click', () => {
    document.querySelectorAll('.adv-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
  }));

// Provider cards
document.querySelectorAll('.adv-pcard').forEach(card =>
  card.addEventListener('click', () => {
    document.querySelectorAll('.adv-pcard').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    const ownKeyField = document.getElementById('adv-own-key-field');
    if (ownKeyField) ownKeyField.style.display = (card.dataset.prov === 'claude') ? '' : 'none';
  }));

// Redeem tester/beta code
document.getElementById('adv-tester-btn')?.addEventListener('click', async () => {
  const code = document.getElementById('adv-tester-code')?.value.trim();
  if (!code) return;
  const btn = document.getElementById('adv-tester-btn');
  btn.disabled = true; btn.textContent = '···';
  const res = await window.sk.redeemTesterCode({ code });
  btn.disabled = false; btn.textContent = 'Redeem →';
  const el = document.getElementById('adv-tester-status');
  if (!res.ok) {
    if (el) el.textContent = '✗ ' + (res.error ?? 'Invalid code');
    showToast('Invalid code', 'err');
    return;
  }
  if (el) el.textContent = '✓ Max access unlocked!';
  showToast('Max access unlocked! 🎉', 'ok');
  window.sk.checkLicense().then(lic => setTierDisplay(lic.tier, lic.used, lic.limit));
});

// adv-save-btn removed — sp-save-btn now saves everything (profile + settings)

// ─── Auth overlay ─────────────────────────────────────────────────────────────
const authOverlay   = document.getElementById('auth-overlay');
const authError     = document.getElementById('auth-error');
const authSuccess   = document.getElementById('auth-success');
const authSubtitle  = document.getElementById('auth-subtitle');

function showAuthForm(name) {
  document.getElementById('auth-form-login').style.display    = name === 'login'    ? '' : 'none';
  document.getElementById('auth-form-register').style.display = name === 'register' ? '' : 'none';
  document.getElementById('auth-form-forgot').style.display   = name === 'forgot'   ? '' : 'none';
  authError.style.display   = 'none';
  authSuccess.style.display = 'none';
  authSubtitle.textContent =
    name === 'register' ? 'Create a free account' :
    name === 'forgot'   ? 'Reset your password' :
                          'Sign in to your account';
}

function setAuthError(msg)   { authError.textContent = msg;   authError.style.display   = ''; authSuccess.style.display = 'none'; }
function setAuthSuccess(msg) { authSuccess.textContent = msg; authSuccess.style.display = ''; authError.style.display   = 'none'; }

function setAuthLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? '···' : btn.dataset.label ?? btn.textContent;
  const wrap = document.getElementById('auth-logo-wrap');
  if (wrap) wrap.classList.toggle('loading', loading);
}

// Navigation
document.getElementById('auth-goto-register')?.addEventListener('click', () => showAuthForm('register'));
document.getElementById('auth-goto-login')?.addEventListener('click',    () => showAuthForm('login'));
document.getElementById('auth-goto-login2')?.addEventListener('click',   () => showAuthForm('login'));
document.getElementById('auth-forgot-btn')?.addEventListener('click',    () => showAuthForm('forgot'));

// Login
const loginBtn = document.getElementById('auth-login-btn');
loginBtn.dataset.label = 'Sign in';
loginBtn?.addEventListener('click', async () => {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { setAuthError('Fill in email and password'); return; }
  setAuthLoading(loginBtn, true);
  const res = await window.sk.authLogin({ email, password });
  setAuthLoading(loginBtn, false);
  if (!res.ok) { setAuthError(res.error ?? 'Login failed'); return; }
  bootApp();
});

// Register
const registerBtn = document.getElementById('auth-register-btn');
registerBtn.dataset.label = 'Create account';
registerBtn?.addEventListener('click', async () => {
  const email     = document.getElementById('auth-reg-email').value.trim();
  const password  = document.getElementById('auth-reg-password').value;
  const password2 = document.getElementById('auth-reg-password2')?.value;
  if (!email || !password) { setAuthError('Fill in email and password'); return; }
  if (password.length < 6) { setAuthError('Password must be at least 6 characters'); return; }
  if (password2 !== undefined && password !== password2) { setAuthError('Passwords do not match'); return; }
  setAuthLoading(registerBtn, true);
  const res = await window.sk.authRegister({ email, password });
  setAuthLoading(registerBtn, false);
  if (!res.ok) { setAuthError(res.error ?? 'Registration failed'); return; }
  if (res.needsConfirmation) {
    setAuthSuccess('Check your email to confirm your account, then sign in.');
    showAuthForm('login');
    return;
  }
  bootApp();
});

// Reset password
const resetBtn = document.getElementById('auth-reset-btn');
resetBtn.dataset.label = 'Send reset link';
resetBtn?.addEventListener('click', async () => {
  const email = document.getElementById('auth-reset-email').value.trim();
  if (!email) { setAuthError('Enter your email'); return; }
  setAuthLoading(resetBtn, true);
  const res = await window.sk.authResetPassword({ email });
  setAuthLoading(resetBtn, false);
  if (!res.ok) { setAuthError(res.error ?? 'Failed'); return; }
  setAuthSuccess('Reset link sent! Check your inbox. (Check spam too)');
});

// Enter key on inputs
['auth-email', 'auth-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click();
  });
});
['auth-reg-email', 'auth-reg-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') registerBtn.click();
  });
});

// Logout → show login screen
window.sk.on('logged-out', () => {
  settingsPage?.classList.remove('open');
  showAuthOverlay();
  showAuthForm('login');
});

// Tray "Settings" → open inline settings page
window.sk.on('open-settings-inline', () => openSettingsPage('profile'));

// Deep-link from browser (e.g. after password reset on the web page)
window.sk.on('deep-link', ({ url }) => {
  if (url?.includes('reset-done')) {
    showToast('Password updated — log in with your new password', 'ok', 4000);
    showAuthOverlay();
    showAuthForm('login');
  }
});

// tier-updated event from main (after Stripe payment)
window.sk.on('tier-updated', ({ tier }) => {
  window.sk.checkLicense().then(lic => setTierDisplay(lic.tier, lic.used, lic.limit));
  if (tier !== 'free') showToast(`Upgraded to ${tier.charAt(0).toUpperCase() + tier.slice(1)}! 🎉`, 'ok');
});

// ─── Smooth overlay transitions ───────────────────────────────────────────────
function hideAuthOverlay() {
  authOverlay.style.transition = 'opacity .35s ease';
  authOverlay.style.opacity    = '0';
  setTimeout(() => { authOverlay.style.display = 'none'; authOverlay.style.opacity = '1'; authOverlay.style.transition = ''; }, 360);
}

function showAuthOverlay() {
  authOverlay.style.opacity    = '0';
  authOverlay.style.display    = 'flex';
  requestAnimationFrame(() => {
    authOverlay.style.transition = 'opacity .25s ease';
    authOverlay.style.opacity    = '1';
    setTimeout(() => authOverlay.style.transition = '', 260);
  });
}

// After successful auth — hide overlay, boot app
async function bootApp() {
  hideAuthOverlay();
  // Show onboarding on first run (no profile name set yet)
  const profile = await window.sk.getProfile();
  const isNewUser = !profile?.name || profile.name === 'You' || profile.name === '';
  if (isNewUser) {
    showOnboarding();
  } else {
    init();
    loadProfile();
  }
}

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  const nameInput = document.getElementById('onb-name');
  const btn = document.getElementById('onb-btn');
  const skip = document.getElementById('onb-skip');
  if (!overlay) { init(); loadProfile(); return; }

  overlay.style.display = 'flex';
  setTimeout(() => nameInput?.focus(), 300);

  const finish = async (name) => {
    overlay.style.display = 'none';
    if (name && name !== 'You') {
      await window.sk.saveProfile({ name });
    }
    init();
    loadProfile();
    // After a short delay, greet the user in chat
    if (name && name !== 'You') {
      setTimeout(() => {
        const m = document.getElementById('msg');
        if (m && !m.value) {
          appendAiGroup(`Hey ${name} — I'm Etaros, your personal security guard. I watch your screen and catch scams, phishing pages, and fraud before they cost you. **Paste any link, email, or message and I'll tell you if it's safe.** Or just keep browsing — I'll tap you on the shoulder if I spot anything dangerous.`);
        }
      }, 600);
    }
  };

  btn?.addEventListener('click', () => {
    const name = nameInput?.value.trim() || 'You';
    finish(name);
  });
  skip?.addEventListener('click', () => finish(''));
  nameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
}

// ─── Startup: check session ────────────────────────────────────────────────────
async function startApp() {
  // Show overlay immediately with loading state (no flash of blank)
  authOverlay.style.display = 'flex';
  authOverlay.style.opacity = '1';
  document.getElementById('auth-form-login').style.display    = 'none';
  document.getElementById('auth-form-register').style.display = 'none';
  document.getElementById('auth-form-forgot').style.display   = 'none';
  authSubtitle.textContent = '';
  document.getElementById('auth-logo-wrap')?.classList.add('loading');

  const session = await window.sk.authSession();
  document.getElementById('auth-logo-wrap')?.classList.remove('loading');

  if (session?.loggedIn) {
    authOverlay.style.display = 'none';
    init();
    loadProfile();
  } else {
    showAuthForm('login');
  }
}

startApp();
