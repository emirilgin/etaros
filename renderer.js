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
offlineBanner.textContent = '⚠ You\'re offline, AI features need an internet connection.';
document.body.appendChild(offlineBanner);

function setOnlineState(online) {
  offlineBanner.style.display = online ? 'none' : 'block';
  if (send) send.disabled = !online;
  if (msg)  msg.placeholder = online
    ? (msg.dataset.basePlaceholder || msg.placeholder)
    : 'Offline, reconnect to chat';
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

// Region selector button, CMD+SHIFT+4 style
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
  msg.placeholder = 'Ask about anything on your screen…';
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
// Drag events, whole window
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

// ─── Danger alert, unmissable warning on an active threat ────────────────────
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
    msg.value = `Explain this threat in detail and tell me exactly what to do: ${item.title}, ${item.detail || ''}`;
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
    _updateUrl = url || 'https://github.com/emirilgin/etaros/releases/latest';
    updateMsg.textContent = `◆ Etaros v${version} is available`;
    if (updateBtn) updateBtn.textContent = 'Download →';
    updateBanner.style.display = 'flex';
  }
});

if (updateBtn) {
  updateBtn.addEventListener('click', () => window.sk.openUrl(_updateUrl));
}

window.sk.on('error',          ({ message })       => appendError(message));

// Screen access is an upgrade, not a gate: everything else already works, so
// this explains the trade rather than reading like a failure.
window.sk.on('screen-permission-needed', () => {
  showFeed();
  const el = document.createElement('div');
  el.className = 'perm-note';
  el.innerHTML = `
    <div class="perm-title">Etaros can't see your screen yet</div>
    <div class="perm-body">You can still paste links, emails and messages and I'll check them.
      To have me watch your screen and catch things on my own, turn on Screen Recording.</div>
    <div class="perm-steps">System Settings &rsaquo; Privacy &amp; Security &rsaquo; Screen Recording &rsaquo; enable Etaros, then restart the app.</div>
    <button class="perm-btn" id="perm-open">Open System Settings</button>`;
  feed.insertBefore(el, thinking);
  el.querySelector('#perm-open')?.addEventListener('click', () => window.sk.openScreenSettings());
  scrollBottom(true);
});
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
    <button class="limit-msg-btn" id="limit-upgrade-btn">Upgrade to Pro, €9/mo</button>`;
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

// ─── Tab system ───────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === name + '-panel'));
  if (name === 'chat') setTimeout(() => msg?.focus(), 60);
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

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
// Dark is the product's own look and lives in :root, so it is the absence of an
// override. Only light needs a data-theme attribute.
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  if (t === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
  localStorage.setItem('etaros_theme', t);
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t));
}
// Apply saved theme immediately on load
applyTheme(localStorage.getItem('etaros_theme'));
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
  // Settings is now a single scrollable page, scroll to section
  const target = document.getElementById(`sp-tab-${tabId}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── What leaves this device ─────────────────────────────────────────────────
// Renders from live state. If a future change starts sending something new,
// this panel is wrong until someone updates it, which is the point: the claim
// and the behaviour are kept in the same place.
async function renderPrivacyPanel() {
  const list = document.getElementById('pv-list');
  const note = document.getElementById('pv-note');
  if (!list) return;

  const [s, convs] = await Promise.all([
    window.sk.getSettings(),
    window.sk.getConversations().catch(() => ({ conversations: [] })),
  ]);
  const local   = (s.provider || 'builtin') === 'ollama';
  const ownKey  = Boolean((s.geminiKey || '').trim() || (s.apiKey || '').trim());
  const chats   = (convs?.conversations || []).length;

  const rows = [
    ['Screen captures', local
        ? 'Analysed on this machine. Never transmitted.'
        : 'Sent for analysis, then discarded. Never stored by us.',
      local],
    ['Where analysis happens', local
        ? 'Your machine (Ollama). No network request is made.'
        : ownKey ? 'Your own API key, direct to your chosen provider.'
                 : 'Etaros backend, European infrastructure. Not Google.',
      local],
    ['Conversations', `${chats} stored on this device only. Never uploaded.`, true],
    ['Profile of you', 'None. No learned facts, no habits, no activity journal.', true],
    ['Account email', s.hasAccount === false ? 'Not signed in.' : 'Stored to manage sign-in and your plan.', false],
    ['Crash reports', 'Anonymous. Emails, keys and image data are stripped before sending.', false],
    ['Advertising & data sales', 'None. There is no third party to sell to.', true],
  ];

  list.innerHTML = rows.map(([k, v, stays]) => `
    <div class="pv-row">
      <span class="pv-dot ${stays ? 'stay' : 'out'}"></span>
      <div style="flex:1;min-width:0">
        <div class="pv-k">${esc(k)}</div>
        <div class="pv-v">${esc(v)}</div>
      </div>
      <span class="pv-tag ${stays ? 'stay' : 'out'}">${stays ? 'stays' : 'leaves'}</span>
    </div>`).join('');

  note.innerHTML = local
    ? 'Local mode is on. Nothing about your screen leaves this machine, so you do not have to take our word for any of the above.'
    : 'Our processor holds API traffic for 30 days for abuse prevention, then deletes it. We hold nothing at any point. If that is still too much trust, switch to local mode and verify it yourself.';

  const btn = document.getElementById('pv-local-btn');
  if (btn) {
    btn.textContent = local ? 'Local mode is on' : 'Switch to local mode';
    btn.disabled = local;
    btn.style.opacity = local ? '.5' : '';
  }
}

document.getElementById('privacy-btn')?.addEventListener('click', () => openSettingsPage('privacy'));

document.getElementById('pv-local-btn')?.addEventListener('click', async () => {
  await window.sk.saveSettings({ provider: 'ollama' });
  showToast('Local mode on. Requires Ollama running.', 'ok', 4000);
  renderPrivacyPanel();
});

document.getElementById('pv-wipe-btn')?.addEventListener('click', () => {
  showConfirm('Erase every conversation and stored setting on this device? This cannot be undone.', async () => {
    await window.sk.purgeLegacyData().catch(() => {});
    window.sk.clearHistory();
    const el = document.getElementById('pv-wiped');
    if (el) { el.style.display = 'block'; el.textContent = 'Erased ' + new Date().toLocaleTimeString(); }
    renderPrivacyPanel();
    showToast('Local data erased', 'ok');
  });
});

function openSettingsPage(section = 'profile') {
  if (!settingsPage) return;
  settingsPage.classList.add('open');
  switchSettingsTab(section);
  spAvatarDataUrl = null;

  // Load advanced/settings fields (now inline)
  renderPrivacyPanel().catch(() => {});
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
        ? '✓ Using your personal key, higher daily quota.'
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
  // Compress to max 200x200 before storing, prevents huge base64 in electron-store
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
  // a Claude key (sk-ant…) goes to apiKey, prevents the "pasted in wrong box" trap.
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
// Tester status helper, called when settings page opens
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

// adv-save-btn removed, sp-save-btn now saves everything (profile + settings)

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
    showToast('Password updated, log in with your new password', 'ok', 4000);
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

// After successful auth, hide overlay, boot app
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
          appendAiGroup(`Hey ${name}, I'm Etaros, your personal security guard. I watch your screen and catch scams, phishing pages, and fraud before they cost you. **Paste any link, email, or message and I'll tell you if it's safe.** Or just keep browsing, I'll tap you on the shoulder if I spot anything dangerous.`);
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
