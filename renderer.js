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
settingsFsBtn.addEventListener('click',  () => window.sk.openSettings());
upBtn.addEventListener('click',          () => window.sk.openSettings());
clearBtn.addEventListener('click', () => window.sk.clearHistory());

// No-key banner
const noKeyBanner = document.getElementById('no-key-banner');
const noKeyBtn    = document.getElementById('no-key-settings-btn');
if (noKeyBtn) noKeyBtn.addEventListener('click', () => window.sk.openSettings());
window.sk.on('no-key', () => { if (noKeyBanner) noKeyBanner.style.display = 'flex'; });
window.sk.on('key-ok',  () => { if (noKeyBanner) noKeyBanner.style.display = 'none'; });

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

function makeGroup(label) {
  const el = document.createElement('div');
  el.className = 'group';
  el.innerHTML = `<div class="g-label">
    <div class="g-icon">${AI_ICON_SVG}</div>
    ${esc(label)}<span class="g-time">${now()}</span>
  </div>`;
  return el;
}

// Render a complete AI message (for history restore)
function appendAiGroup(text) {
  showFeed();
  const el = makeGroup('Sidekick');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.innerHTML = md(text);
  el.appendChild(msgDiv);
  feed.insertBefore(el, thinking);
}

// ─── Render: streaming ────────────────────────────────────────────────────────
function createStreamEl() {
  showFeed();
  const el = makeGroup('Sidekick');
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
  const group = makeGroup('Sidekick noticed');
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

    // SAVE card → one-click log saving
    if (t === 'save') {
      const amtMatch = `${item.title} ${item.detail||''}`.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
      const amount   = amtMatch ? parseFloat(amtMatch[1]) : null;
      const logBtn   = document.createElement('button');
      logBtn.className   = 'card-log-btn';
      logBtn.textContent = amount ? `Log $${amount} saved` : 'Log saving';
      logBtn.addEventListener('click', async () => {
        if (logBtn.disabled) return;
        let finalAmt = amount;
        if (!finalAmt) {
          const v = prompt('Amount saved ($)?');
          finalAmt = parseFloat(v) || 0;
          if (!finalAmt) return;
        }
        await window.sk.logSaving({ item: item.title, amount: finalAmt });
        logBtn.textContent = '✓ Logged';
        logBtn.disabled = true;
        logBtn.classList.add('logged');
      });
      c.appendChild(logBtn);
    }

    // REC card (food context) → one-click log meal
    if (t === 'rec') {
      const kcalMatch = `${item.detail||''} ${item.title||''}`.match(/(\d+)\s*k?cal/i);
      const kcal      = kcalMatch ? parseInt(kcalMatch[1]) : 0;
      const logBtn    = document.createElement('button');
      logBtn.className   = 'card-log-btn food';
      logBtn.textContent = kcal ? `Log ${kcal} kcal` : 'Log meal';
      logBtn.addEventListener('click', async () => {
        if (logBtn.disabled) return;
        await window.sk.logDiet({ item: item.title, kcal });
        logBtn.textContent = '✓ Logged';
        logBtn.disabled = true;
        logBtn.classList.add('logged');
      });
      c.appendChild(logBtn);
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
  thinking.style.display = 'none';
  thinkTime.textContent  = '';
});

window.sk.on('stream-chunk', ({ content }) => appendChunk(content));

window.sk.on('stream-done', (data) => {
  hdrDot.classList.remove('on');
  finalizeStream(data);
});

window.sk.on('stream-error', ({ message }) => {
  hdrDot.classList.remove('on');
  if (streamEl) { streamEl.remove(); streamEl = null; streamBuffer = ''; }
  appendError(message);
  showToast('Something went wrong', 'err', 3500);
});

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
    updateMsg.textContent = `◆ Sidekick v${version} is available`;
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

memClearBtn?.addEventListener('click', async () => {
  if (!confirm('Clear all memory? Sidekick will forget everything it knows about you.')) return;
  await window.sk.clearMemory();
  openMemory();
  showToast('Memory cleared', 'ok');
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
  // Pro/Max only feature
  const lic = await window.sk.checkLicense();
  if (lic.tier === 'free') {
    showToast('AI Compare is Pro & Max only — upgrade in Settings', 'info');
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
      <span style="font-size:11.5px">Pick a category or just type — Sidekick routes<br>your query to the best sites automatically.</span>
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

// ─── Links tab ────────────────────────────────────────────────────────────────
function esc2(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderLinks(links) {
  const list = document.getElementById('links-list');
  if (!list) return;
  if (!links || !links.length) {
    list.innerHTML = '<div class="links-empty">Paste any product, subscription, or service URL.<br>Sidekick finds cheaper or better alternatives.</div>';
    return;
  }
  list.innerHTML = links.map(l => {
    const domain = (() => { try { return new URL(l.url).hostname.replace('www.',''); } catch { return l.url; } })();
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    const alts = (l.alternatives || []).map(a => `
      <a class="link-alt" href="#" data-url="${esc2(a.url)}" title="${esc2(a.url)}">
        <div class="link-alt-body">
          <div class="link-alt-name">${esc2(a.name)}</div>
          <div class="link-alt-why">${esc2(a.why)}</div>
          ${a.saving ? `<div class="link-alt-saving">${esc2(a.saving)}</div>` : ''}
        </div>
        <span class="link-alt-arrow">↗</span>
      </a>`).join('');
    return `
      <div class="link-card" data-id="${l.id}">
        <div class="link-card-header">
          <img class="link-card-favicon" src="${favicon}" alt="" onerror="this.style.display='none'"/>
          <div class="link-card-meta">
            <div class="link-card-title">${esc2(l.title || domain)}</div>
            <div class="link-card-what">${esc2(l.what || '')}</div>
            <div class="link-card-url">${esc2(l.url)}</div>
          </div>
          <button class="link-card-del" title="Remove">×</button>
        </div>
        ${alts ? `<div class="link-alts-hdr">Better alternatives</div>${alts}` : ''}
      </div>`;
  }).join('');

  list.querySelectorAll('.link-card-del').forEach(btn =>
    btn.addEventListener('click', async () => {
      const id = btn.closest('.link-card').dataset.id;
      await window.sk.deleteLink(id);
      loadLinks();
    }));
  list.querySelectorAll('.link-alt').forEach(a =>
    a.addEventListener('click', e => {
      e.preventDefault();
      window.sk.openUrl(a.dataset.url);
    }));
}

async function loadLinks() {
  const links = await window.sk.getLinks();
  renderLinks(links);
}

// Link analyze button
document.getElementById('link-analyze-btn')?.addEventListener('click', async () => {
  const urlInput  = document.getElementById('link-url-input');
  const noteInput = document.getElementById('link-note-input');
  const btn       = document.getElementById('link-analyze-btn');
  const list      = document.getElementById('links-list');
  const url = urlInput?.value.trim();
  if (!url) return;
  const note = noteInput?.value.trim() || '';

  // Check Pro/Max
  const lic = await window.sk.checkLicense();
  if (lic.tier === 'free') {
    showToast('Links analysis is Pro & Max only — upgrade in Settings', 'info');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  // Show loading state at top of list
  const loadDiv = document.createElement('div');
  loadDiv.className = 'link-analyzing';
  loadDiv.innerHTML = '<span class="t-dots"><span></span><span></span><span></span></span> Finding alternatives…';
  list?.prepend(loadDiv);

  try {
    await window.sk.analyzeLink({ url, note });
    if (urlInput) urlInput.value = '';
    if (noteInput) noteInput.value = '';
    await loadLinks();
  } catch (e) {
    showToast('Analysis failed: ' + e.message, 'err');
    loadDiv?.remove();
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" style="width:12px;height:12px"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 9.5l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Find alternatives';
  }
});

// Enter key in URL input triggers analyze
document.getElementById('link-url-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('link-analyze-btn')?.click(); }
});

// ─── Smart split: "big mac 550" → { name:"big mac", num:550 } ─────────────────
function smartSplit(val) {
  val = val.trim();
  // trailing number with optional $, kcal, cal suffix
  const m = val.match(/^(.+?)\s+\$?([0-9]+(?:\.[0-9]{1,2})?)(?:\s*k?cal)?$/i);
  if (m && m[1].trim()) return { name: m[1].trim(), num: parseFloat(m[2]) };
  // leading $X then description
  const m2 = val.match(/^\$([0-9]+(?:\.[0-9]{1,2})?)\s+(.+)$/);
  if (m2) return { name: m2[2].trim(), num: parseFloat(m2[1]) };
  return { name: val, num: 0 };
}

// ─── Date helper ──────────────────────────────────────────────────────────────
function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return new Intl.DateTimeFormat([], { hour:'numeric', minute:'2-digit' }).format(d);
  return new Intl.DateTimeFormat([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(d);
}

// ─── Tab system ───────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');

function switchTab(name) {
  if (name !== 'search' && _searchViewOpen) hideSearchWebview();
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === name + '-panel'));
  if (name === 'notes')   { loadNotes();   setTimeout(() => noteInput?.focus(), 60); }
  if (name === 'savings') { loadSavings(); setTimeout(() => document.getElementById('saving-item')?.focus(), 60); }
  if (name === 'diet')    { loadDiet();    setTimeout(() => document.getElementById('diet-item')?.focus(), 60); }
  if (name === 'life')    { loadLife(); }
  if (name === 'search')  { loadSearch(); }
  if (name === 'links')   { loadLinks(); setTimeout(() => document.getElementById('link-url-input')?.focus(), 60); }
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

// ─── Notes ────────────────────────────────────────────────────────────────────
const noteInput   = document.getElementById('note-input');
const noteSaveBtn = document.getElementById('note-save-btn');
const notesList   = document.getElementById('notes-list');

async function loadNotes() {
  const notes = await window.sk.getNotes();
  renderNotes(notes);
}

function renderNotes(notes) {
  if (!notes || !notes.length) {
    notesList.innerHTML = `<div class="notes-empty">
      <span>No notes yet. Write something.</span>
    </div>`;
    return;
  }
  const sorted = [...notes].sort((a,b) => (b.pinned?1:0)-(a.pinned?1:0) || (b.updated||b.created||0)-(a.updated||a.created||0));
  notesList.innerHTML = sorted.map(n => `
    <div class="note-card${n.pinned?' pinned':''}" data-id="${n.id}">
      <div class="note-text">${esc(n.text)}</div>
      <div class="note-meta">
        <span class="note-date">${fmtDate(n.updated || n.created)}</span>
        <button class="note-pin" data-id="${n.id}" title="${n.pinned?'Unpin':'Pin'}">${n.pinned?'·':'·'}</button>
        <button class="note-del" data-id="${n.id}" title="Delete">×</button>
      </div>
    </div>`).join('');

  notesList.querySelectorAll('.note-pin').forEach(btn =>
    btn.addEventListener('click', async () => {
      await window.sk.pinNote(btn.dataset.id);
      loadNotes();
    }));
  notesList.querySelectorAll('.note-del').forEach(btn =>
    btn.addEventListener('click', async () => {
      await window.sk.deleteNote(btn.dataset.id);
      loadNotes();
    }));
}

async function doSaveNote() {
  const text = noteInput.value.trim();
  if (!text) return;
  noteInput.value = '';
  noteInput.style.height = 'auto';
  await window.sk.saveNote({ text });
  loadNotes();
}

noteSaveBtn?.addEventListener('click', doSaveNote);
noteInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSaveNote(); }
});
noteInput?.addEventListener('input', () => {
  noteInput.style.height = 'auto';
  noteInput.style.height = Math.min(noteInput.scrollHeight, 100) + 'px';
});

// ─── Canvas charts ────────────────────────────────────────────────────────────
function drawAreaChart(canvasId, labels, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  // If canvas has no size yet (panel not visible), retry after frame
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) { requestAnimationFrame(() => drawAreaChart(canvasId, labels, values, color)); return; }
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const PAD = { top: 8, right: 12, bottom: 28, left: 46 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;
  const max = Math.max(...values, 1);
  const step = cW / Math.max(labels.length - 1, 1);

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.font = `10px system-ui`;
    ctx.textAlign = 'right';
    const val = max * (1 - i / 4);
    ctx.fillText(val >= 1000 ? `${(val/1000).toFixed(1)}k` : Math.round(val), PAD.left - 6, y + 3.5);
  }

  // Points
  const pts = values.map((v, i) => ({
    x: PAD.left + i * step,
    y: PAD.top + cH * (1 - v / max),
  }));

  // Fill
  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
  grad.addColorStop(0, color.replace(')', ', .35)').replace('rgb', 'rgba'));
  grad.addColorStop(1, color.replace(')', ', .0)').replace('rgb', 'rgba'));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, PAD.top + cH);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length-1].x, PAD.top + cH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

  // Dots
  pts.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#1a1714'; ctx.lineWidth = 1.5; ctx.stroke();
  });

  // X labels
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.font = '10px system-ui'; ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    ctx.fillText(l, PAD.left + i * step, H - 8);
  });
}

function drawBarChart(canvasId, labels, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) { requestAnimationFrame(() => drawBarChart(canvasId, labels, values, color)); return; }
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const PAD = { top: 8, right: 12, bottom: 28, left: 46 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;
  const max = Math.max(...values, 1);
  const barW = cW / labels.length;
  const gap  = Math.min(barW * .18, 6);

  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    const val = max * (1 - i / 4);
    ctx.fillText(val >= 1000 ? `${(val/1000).toFixed(1)}k` : Math.round(val), PAD.left - 6, y + 3.5);
  }

  // Bars
  values.forEach((v, i) => {
    const bH = (v / max) * cH;
    const x  = PAD.left + i * barW + gap;
    const y  = PAD.top  + cH - bH;
    const bw = barW - gap * 2;
    const r  = Math.min(4, bw / 2, bH / 2);

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + bw, y, x + bw, y + bH, r);
    ctx.arcTo(x + bw, y + bH, x, y + bH, 0);
    ctx.arcTo(x, y + bH, x, y, 0);
    ctx.arcTo(x, y, x + bw, y, r);
    ctx.closePath();

    const g = ctx.createLinearGradient(0, y, 0, y + bH);
    g.addColorStop(0, color.replace(')', ', .9)').replace('rgb', 'rgba'));
    g.addColorStop(1, color.replace(')', ', .4)').replace('rgb', 'rgba'));
    ctx.fillStyle = v > 0 ? g : 'rgba(255,255,255,.04)';
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], PAD.left + i * barW + barW / 2, H - 8);
  });
}

// ─── Savings ──────────────────────────────────────────────────────────────────
async function loadSavings() {
  const savings = await window.sk.getSavings();
  renderSavings(savings);
}

function renderSavings(savings) {
  const totalSaved  = savings.reduce((s,e) => s + (parseFloat(e.amount)||0), 0);
  const thisMonth   = savings
    .filter(e => new Date(e.date) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1))
    .reduce((s,e) => s + (parseFloat(e.amount)||0), 0);

  // Stats
  const statsRow = document.getElementById('savings-stats-row');
  if (statsRow) statsRow.innerHTML = `
    <div class="stat-card green">
      <div class="stat-body">
        <div class="stat-label">Total saved</div>
        <div class="stat-value">$${totalSaved.toFixed(2)}</div>
        <div class="stat-sub">${savings.length} saving${savings.length!==1?'s':''} logged</div>
      </div>
    </div>
    <div class="stat-card blue">
      <div class="stat-body">
        <div class="stat-label">This month</div>
        <div class="stat-value">$${thisMonth.toFixed(2)}</div>
        <div class="stat-sub">${new Date().toLocaleDateString([],{month:'long'})}</div>
      </div>
    </div>`;

  // Chart — cumulative savings over last 14 days
  const days = 14;
  const labels = []; const vals = [];
  let cumulative = 0;
  const all14 = savings.filter(s => {
    const d = new Date(s.date);
    return d >= new Date(Date.now() - (days-1)*864e5);
  });
  for (let i = days-1; i >= 0; i--) {
    const d = new Date(Date.now() - i*864e5);
    const label = d.toLocaleDateString([],{month:'short',day:'numeric'});
    const dayStr = d.toDateString();
    const daySum = all14
      .filter(s => new Date(s.date).toDateString() === dayStr)
      .reduce((sum,s) => sum + (parseFloat(s.amount)||0), 0);
    cumulative += daySum;
    labels.push(i === 0 ? 'Today' : d.toLocaleDateString([],{month:'short',day:'numeric'}));
    vals.push(cumulative);
  }
  // Offset to start at base
  const base = vals[0];
  const relVals = vals.map(v => v - base + (base > 0 ? base * .05 : 0));
  setTimeout(() => drawAreaChart('savings-chart', labels.filter((_,i) => i % 2 === 0 || i === labels.length-1).map((_,i) => labels[i*2] || labels[labels.length-1]), relVals.filter((_,i) => i % 2 === 0 || i === relVals.length-1), 'rgb(82,168,110)'), 50);

  // Chips
  const recentSavings = [...new Map(savings.map(s => [s.item, s])).values()].slice(0, 5);
  const chipsEl = document.getElementById('savings-chips');
  if (chipsEl) chipsEl.innerHTML = recentSavings.length ? `
    <div class="life-recent-chips">
      ${recentSavings.map(s => `
        <button class="life-chip" data-type="saving" data-item="${esc(s.item)}" data-amount="${s.amount}">
          ${esc(s.item)}
        </button>`).join('')}
    </div>` : '';

  // Entries
  const entriesEl = document.getElementById('savings-entries');
  if (entriesEl) {
    if (!savings.length) {
      entriesEl.innerHTML = '<div class="life-empty">No savings yet.<br>Log what you saved on — or let a scan catch it for you!</div>';
    } else {
      entriesEl.innerHTML = savings.map(s => `
        <div class="life-entry">
          <div class="life-entry-body">
            <div class="life-entry-name">${esc(s.item)}</div>
            <div class="life-entry-date">${fmtDate(s.date)}</div>
          </div>
          <div class="life-entry-val green">+$${parseFloat(s.amount).toFixed(2)}</div>
          <button class="life-entry-del" data-id="${s.id}" data-type="saving">×</button>
        </div>`).join('');
    }
  }

  wireSavingsHandlers();
}

function wireSavingsHandlers() {
  function smartParseEl(itemId, numId) {
    const it = document.getElementById(itemId), nu = document.getElementById(numId);
    if (!it || !nu) return;
    it.addEventListener('blur', () => {
      if (it.value.trim() && !nu.value) {
        const { name, num } = smartSplit(it.value);
        if (num) { it.value = name; nu.value = num; }
      }
    });
  }
  smartParseEl('saving-item', 'saving-amount');

  async function doAddSaving() {
    let item   = document.getElementById('saving-item')?.value.trim();
    let amount = parseFloat(document.getElementById('saving-amount')?.value) || 0;
    if (item && !amount) { const p = smartSplit(item); if (p.num) { item = p.name; amount = p.num; } }
    if (!item || !amount) return;
    await window.sk.logSaving({ item, amount });
    document.getElementById('saving-item').value   = '';
    document.getElementById('saving-amount').value = '';
    loadSavings();
  }

  document.getElementById('saving-add-btn')?.addEventListener('click', doAddSaving);
  ['saving-item','saving-amount'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') doAddSaving(); }));

  document.getElementById('savings-chips')?.querySelectorAll('.life-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      chip.textContent = '✓'; chip.style.pointerEvents = 'none';
      await window.sk.logSaving({ item: chip.dataset.item, amount: parseFloat(chip.dataset.amount)||0 });
      loadSavings();
    });
  });

  document.getElementById('savings-entries')?.querySelectorAll('.life-entry-del').forEach(btn =>
    btn.addEventListener('click', async () => {
      await window.sk.deleteSaving(btn.dataset.id);
      loadSavings();
    }));
}

// ─── Diet ─────────────────────────────────────────────────────────────────────
async function loadDiet() {
  const diet = await window.sk.getDiet();
  renderDiet(diet);
}

function renderDiet(diet) {
  const todayStr  = new Date().toDateString();
  const todayKcal = diet
    .filter(d => new Date(d.date).toDateString() === todayStr)
    .reduce((s,d) => s + (parseInt(d.kcal)||0), 0);
  const totalKcal = diet.reduce((s,d) => s + (parseInt(d.kcal)||0), 0);

  // Stats
  const statsRow = document.getElementById('diet-stats-row');
  if (statsRow) statsRow.innerHTML = `
    <div class="stat-card orange">
      <div class="stat-body">
        <div class="stat-label">Today</div>
        <div class="stat-value">${todayKcal > 0 ? todayKcal.toLocaleString() : '—'}</div>
        <div class="stat-sub">kcal today</div>
      </div>
    </div>
    <div class="stat-card green">
      <div class="stat-body">
        <div class="stat-label">Total tracked</div>
        <div class="stat-value">${totalKcal > 0 ? (totalKcal >= 1000 ? (totalKcal/1000).toFixed(1)+'k' : totalKcal) : '—'}</div>
        <div class="stat-sub">${diet.length} meal${diet.length!==1?'s':''} logged</div>
      </div>
    </div>`;

  // Chart — daily calories last 7 days
  const labels7 = []; const vals7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i*864e5);
    const dayStr = d.toDateString();
    const label  = i === 0 ? 'Today' : d.toLocaleDateString([],{weekday:'short'});
    const daySum = diet
      .filter(e => new Date(e.date).toDateString() === dayStr)
      .reduce((sum,e) => sum + (parseInt(e.kcal)||0), 0);
    labels7.push(label);
    vals7.push(daySum);
  }
  // Show placeholder bars (value=1) when no data so chart is visible
  const displayVals = vals7.map(v => v > 0 ? v : 0);
  setTimeout(() => drawBarChart('diet-chart', labels7, displayVals.some(v=>v>0) ? displayVals : labels7.map(()=>0), 'rgb(200,98,46)'), 100);

  // Chips
  const recentDiet = [...new Map(diet.map(d => [d.item, d])).values()].slice(0, 5);
  const chipsEl = document.getElementById('diet-chips');
  if (chipsEl) chipsEl.innerHTML = recentDiet.length ? `
    <div class="life-recent-chips">
      ${recentDiet.map(d => `
        <button class="life-chip" data-type="diet" data-item="${esc(d.item)}" data-kcal="${d.kcal||0}">
          ${esc(d.item)}${d.kcal ? ` · ${d.kcal}` : ''}
        </button>`).join('')}
    </div>` : '';

  // Entries
  const entriesEl = document.getElementById('diet-entries');
  if (entriesEl) {
    if (!diet.length) {
      entriesEl.innerHTML = '<div class="life-empty">No meals yet.<br>Just type the food name — AI estimates the calories automatically.</div>';
    } else {
      entriesEl.innerHTML = diet.map(d => `
        <div class="life-entry">
          <div class="life-entry-body">
            <div class="life-entry-name">${esc(d.item)}</div>
            <div class="life-entry-date">${fmtDate(d.date)}</div>
          </div>
          <div class="life-entry-val blue">${d.kcal ? d.kcal+' kcal' : '—'}</div>
          <button class="life-entry-del" data-id="${d.id}" data-type="diet">×</button>
        </div>`).join('');
    }
  }

  wireDietHandlers();
}

function wireDietHandlers() {
  async function doAddDiet() {
    const itemInput = document.getElementById('diet-item');
    const btn       = document.getElementById('diet-add-btn');
    let item = itemInput?.value.trim();
    if (!item) return;

    // Check if user typed "food name 550" style — use inline number if present
    const parsed = smartSplit(item);
    let kcal = 0;
    if (parsed.num && parsed.name) {
      item = parsed.name;
      kcal = parsed.num;
    } else {
      // AI estimate
      if (btn) { btn.textContent = 'Estimating…'; btn.disabled = true; }
      try { kcal = (await window.sk.estimateKcal(item)) || 0; } catch { kcal = 0; }
      if (btn) { btn.textContent = 'Log Meal →'; btn.disabled = false; }
    }

    await window.sk.logDiet({ item, kcal });
    if (itemInput) itemInput.value = '';
    loadDiet();
  }

  document.getElementById('diet-add-btn')?.addEventListener('click', doAddDiet);
  document.getElementById('diet-item')?.addEventListener('keydown', e => { if (e.key==='Enter') doAddDiet(); });

  document.getElementById('diet-chips')?.querySelectorAll('.life-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      chip.textContent = '✓'; chip.style.pointerEvents = 'none';
      await window.sk.logDiet({ item: chip.dataset.item, kcal: parseInt(chip.dataset.kcal)||0 });
      loadDiet();
    });
  });

  document.getElementById('diet-entries')?.querySelectorAll('.life-entry-del').forEach(btn =>
    btn.addEventListener('click', async () => {
      await window.sk.deleteDiet(btn.dataset.id);
      loadDiet();
    }));
}

// ─── Life (legacy stub — kept for backward compat) ───────────────────────────
async function loadLife() {
  await Promise.all([loadSavings(), loadDiet()]);
}

function renderLife(savings, diet) {
  const totalSaved = savings.reduce((s,e) => s + (parseFloat(e.amount)||0), 0);
  const totalKcal  = diet.reduce((s,e) => s + (parseInt(e.kcal)||0), 0);

  // ── recent unique items for quick-add chips ────────────────────────────────
  const recentSavings = [...new Map(savings.map(s => [s.item, s])).values()].slice(0, 4);
  const recentDiet    = [...new Map(diet.map(d => [d.item, d])).values()].slice(0, 4);

  const savingChips = recentSavings.length ? `
    <div class="life-recent-chips">
      ${recentSavings.map(s => `
        <button class="life-chip" data-type="saving" data-item="${esc(s.item)}" data-amount="${s.amount}">
          ${esc(s.item)}
        </button>`).join('')}
    </div>` : '';

  const dietChips = recentDiet.length ? `
    <div class="life-recent-chips">
      ${recentDiet.map(d => `
        <button class="life-chip" data-type="diet" data-item="${esc(d.item)}" data-kcal="${d.kcal}">
          ${esc(d.item)}${d.kcal ? ` · ${d.kcal}` : ''}
        </button>`).join('')}
    </div>` : '';

  // ── stats ──────────────────────────────────────────────────────────────────
  const statsHtml = `
    <div class="stat-card green">
      <div class="stat-body">
        <div class="stat-label">Total saved</div>
        <div class="stat-value">$${totalSaved.toFixed(2)}</div>
        <div class="stat-sub">${savings.length} saving${savings.length!==1?'s':''} logged</div>
      </div>
    </div>
    <div class="stat-card orange">
      <div class="stat-body">
        <div class="stat-label">Kcal tracked</div>
        <div class="stat-value">${totalKcal > 0 ? totalKcal.toLocaleString() : '—'}</div>
        <div class="stat-sub">${diet.length} meal${diet.length!==1?'s':''} logged</div>
      </div>
    </div>`;

  // ── entries ────────────────────────────────────────────────────────────────
  const savingsRows = savings.length
    ? savings.map(s => `
      <div class="life-entry">
        <div class="life-entry-body">
          <div class="life-entry-name">${esc(s.item)}</div>
          <div class="life-entry-date">${fmtDate(s.date)}</div>
        </div>
        <div class="life-entry-val green">+$${parseFloat(s.amount).toFixed(2)}</div>
        <button class="life-entry-del" data-id="${s.id}" data-type="saving">×</button>
      </div>`).join('')
    : '<div class="life-empty">No savings yet. Log what you saved — or let a scan card do it for you.</div>';

  const dietRows = diet.length
    ? diet.map(d => `
      <div class="life-entry">
        <div class="life-entry-body">
          <div class="life-entry-name">${esc(d.item)}</div>
          <div class="life-entry-date">${fmtDate(d.date)}</div>
        </div>
        <div class="life-entry-val blue">${d.kcal ? d.kcal+' kcal' : '—'}</div>
        <button class="life-entry-del" data-id="${d.id}" data-type="diet">×</button>
      </div>`).join('')
    : '<div class="life-empty">No meals yet. Just type the food name — AI estimates the calories automatically.</div>';

  lifeList.innerHTML = `
    ${statsHtml}

    <div class="life-section-hdr">Savings</div>
    ${savingChips}
    <div class="life-add-row">
      <input class="life-add-input" id="saving-item" placeholder='e.g. "Amazon Prime 12"'>
      <input class="life-add-input" id="saving-amount" placeholder="$" type="number" min="0" style="max-width:68px">
      <button class="life-add-btn" id="saving-add-btn">+ Add</button>
    </div>
    ${savingsRows}

    <div class="life-section-hdr" style="margin-top:14px">Food & Diet</div>
    ${dietChips}
    <div class="life-add-row">
      <input class="life-add-input" id="diet-item" placeholder='e.g. "big mac 550"'>
      <input class="life-add-input" id="diet-kcal" placeholder="kcal" type="number" min="0" style="max-width:68px">
      <button class="life-add-btn" id="diet-add-btn">+ Add</button>
    </div>
    ${dietRows}
  `;

  // ── smart parse: "item name 42" auto-fills number field ────────────────────
  function wireSmartParse(itemId, numId) {
    const itemEl = document.getElementById(itemId);
    const numEl  = document.getElementById(numId);
    if (!itemEl || !numEl) return;
    itemEl.addEventListener('blur', () => {
      if (itemEl.value.trim() && !numEl.value) {
        const { name, num } = smartSplit(itemEl.value);
        if (num) { itemEl.value = name; numEl.value = num; }
      }
    });
  }
  wireSmartParse('saving-item', 'saving-amount');
  wireSmartParse('diet-item', 'diet-kcal');

  // ── add handlers ──────────────────────────────────────────────────────────
  async function doAddSaving() {
    let item   = document.getElementById('saving-item').value.trim();
    let amount = parseFloat(document.getElementById('saving-amount').value) || 0;
    if (item && !amount) { const p = smartSplit(item); if (p.num) { item = p.name; amount = p.num; } }
    if (!item || !amount) return;
    await window.sk.logSaving({ item, amount });
    document.getElementById('saving-item').value   = '';
    document.getElementById('saving-amount').value = '';
    loadLife();
  }

  async function doAddDiet() {
    let item = document.getElementById('diet-item').value.trim();
    let kcal = parseInt(document.getElementById('diet-kcal').value) || 0;
    if (item && !kcal) { const p = smartSplit(item); if (p.num) { item = p.name; kcal = p.num; } }
    if (!item) return;
    await window.sk.logDiet({ item, kcal });
    document.getElementById('diet-item').value = '';
    document.getElementById('diet-kcal').value = '';
    loadLife();
  }

  document.getElementById('saving-add-btn')?.addEventListener('click', doAddSaving);
  document.getElementById('diet-add-btn')?.addEventListener('click', doAddDiet);

  // ── enter key on inputs ───────────────────────────────────────────────────
  ['saving-item','saving-amount'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') doAddSaving(); }));
  ['diet-item','diet-kcal'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') doAddDiet(); }));

  // ── recent chip click → instant re-log ───────────────────────────────────
  lifeList.querySelectorAll('.life-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      chip.textContent = '✓';
      chip.style.pointerEvents = 'none';
      if (chip.dataset.type === 'saving') {
        await window.sk.logSaving({ item: chip.dataset.item, amount: parseFloat(chip.dataset.amount)||0 });
      } else {
        await window.sk.logDiet({ item: chip.dataset.item, kcal: parseInt(chip.dataset.kcal)||0 });
      }
      loadLife();
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────
  lifeList.querySelectorAll('.life-entry-del').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (btn.dataset.type === 'saving') await window.sk.deleteSaving(btn.dataset.id);
      else                               await window.sk.deleteDiet(btn.dataset.id);
      loadLife();
    }));
}

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
  window.sk.openUrl('mailto:support@emirilgin.com');
});
document.getElementById('pm-logout-btn')?.addEventListener('click', async () => {
  document.getElementById('profile-menu').classList.remove('open');
  if (!confirm('Log out? This will clear your profile and license key.')) return;
  showToast('Logged out', 'info');
  await window.sk.logout();
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
      tile.classList.toggle('highlighted', tier === 'pro' && lic.tier === 'free');
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
  const reader = new FileReader();
  reader.onload = e => {
    spAvatarDataUrl = e.target.result;
    const av = document.getElementById('sp-big-avatar');
    if (av) av.innerHTML = `<img src="${spAvatarDataUrl}" alt=""/>`;
  };
  reader.readAsDataURL(file);
  spPfpInput.value = '';
});

document.getElementById('sp-save-btn')?.addEventListener('click', async () => {
  const name     = document.getElementById('sp-name')?.value.trim() || 'You';
  const email    = document.getElementById('sp-email')?.value.trim() || '';
  const language = document.getElementById('sp-lang')?.value || 'en';
  const avatar   = spAvatarDataUrl || undefined;
  await window.sk.saveProfile({ name, email, language, ...(avatar ? { avatar } : {}) });
  spAvatarDataUrl = null;
  settingsPage?.classList.remove('open');
  showToast('Profile saved', 'ok');
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
document.getElementById('sp-advanced-btn')?.addEventListener('click', () => openAdvancedPage());
document.getElementById('sp-help-btn2')?.addEventListener('click',    () => window.sk.openUrl('mailto:support@emirilgin.com'));
document.getElementById('sp-logout-btn')?.addEventListener('click', async () => {
  if (!confirm('Log out? This will clear your profile and license key.')) return;
  showToast('Logged out', 'info');
  await window.sk.logout();
  settingsPage?.classList.remove('open');
});

// ─── Advanced Settings page ───────────────────────────────────────────────────
const advancedPage = document.getElementById('advanced-page');

function openAdvancedPage() {
  if (!advancedPage) return;
  // Close settings page if open so advanced slides over it
  settingsPage?.classList.remove('open');
  advancedPage.classList.add('open');
  // Load current settings
  window.sk.getSettings().then(s => {
    const city      = document.getElementById('adv-city');
    const autoScan  = document.getElementById('adv-auto-scan');
    const loginItem = document.getElementById('adv-login');
    if (city)      city.value       = s.city        || '';
    if (autoScan)  autoScan.checked = Boolean(s.autoScan);
    if (loginItem) loginItem.checked = Boolean(s.startOnLogin);
    // Scan interval pills
    const interval = Number(s.scanInterval ?? 30);
    document.querySelectorAll('.adv-pill').forEach(p =>
      p.classList.toggle('active', Number(p.dataset.val) === interval));
    // Provider cards
    const prov = s.provider || 'builtin';
    document.querySelectorAll('.adv-pcard').forEach(c =>
      c.classList.toggle('active', c.dataset.prov === prov));
    // Own key field
    const ownKeyField = document.getElementById('adv-own-key-field');
    const ownKey      = document.getElementById('adv-own-key');
    if (ownKeyField) ownKeyField.style.display = (prov === 'claude') ? '' : 'none';
    if (ownKey) ownKey.value = s.apiKey || '';
  });
  // Update tester status
  window.sk.checkLicense().then(lic => {
    const el = document.getElementById('adv-tester-status');
    if (!el) return;
    if (lic.tier === 'max') el.textContent = '✓ Max access active';
    else if (lic.tier === 'pro') el.textContent = '✓ Pro access active';
    else el.textContent = '';
  });
}

document.getElementById('adv-back')?.addEventListener('click', () => {
  advancedPage?.classList.remove('open');
  // Re-open settings page on Advanced tab
  openSettingsPage('advanced');
});

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

// Save advanced settings
document.getElementById('adv-save-btn')?.addEventListener('click', async () => {
  const activePill = document.querySelector('.adv-pill.active');
  const activeProv = document.querySelector('.adv-pcard.active');
  await window.sk.saveSettings({
    city:         document.getElementById('adv-city')?.value.trim()     || '',
    scanInterval: activePill ? Number(activePill.dataset.val)           : 30,
    autoScan:     document.getElementById('adv-auto-scan')?.checked     ?? false,
    startOnLogin: document.getElementById('adv-login')?.checked         ?? false,
    provider:     activeProv ? activeProv.dataset.prov                  : 'builtin',
    apiKey:       document.getElementById('adv-own-key')?.value.trim()  || '',
  });
  showToast('Settings saved', 'ok');
  advancedPage?.classList.remove('open');
});

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
  const email    = document.getElementById('auth-reg-email').value.trim();
  const password = document.getElementById('auth-reg-password').value;
  if (!email || !password) { setAuthError('Fill in email and password'); return; }
  if (password.length < 6) { setAuthError('Password must be at least 6 characters'); return; }
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
  setAuthSuccess('Reset link sent! Check your inbox.');
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
function bootApp() {
  hideAuthOverlay();
  init();
  loadProfile();
}

// ─── Startup: check session ────────────────────────────────────────────────────
async function startApp() {
  const session = await window.sk.authSession();
  if (session?.loggedIn) {
    authOverlay.style.display = 'none';
    init();
    loadProfile();
  } else {
    showAuthOverlay();
    showAuthForm('login');
  }
}

startApp();
