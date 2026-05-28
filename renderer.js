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
function applyMode(mode) {
  currentMode = mode;
  document.documentElement.dataset.mode = mode;
  if (mode === 'fullscreen') {
    shell.classList.remove('collapsed');
    collapsed = false;
  }
}

// ─── Collapse ─────────────────────────────────────────────────────────────────
collapseBtn.addEventListener('click', () => setCollapsed(true));
strip.addEventListener('click',       () => setCollapsed(false));
function setCollapsed(v) {
  collapsed = v;
  shell.classList.toggle('collapsed', v);
  window.sk.setCollapsed(v);
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
expandBtn.addEventListener('click', () => window.sk.setMode('fullscreen'));
shrinkBtn.addEventListener('click', () => window.sk.setMode('sidebar'));
hideBtn.addEventListener('click',   () => window.sk.hideWindow());

// ─── Traffic lights (fullscreen macOS titlebar) ───────────────────────────────
document.getElementById('tl-close')?.addEventListener('click', () => window.sk.hideWindow());
document.getElementById('tl-min')  ?.addEventListener('click', () => window.sk.minimizeWindow());
document.getElementById('tl-max')  ?.addEventListener('click', () => window.sk.setMode('sidebar'));

// ─── Buttons ──────────────────────────────────────────────────────────────────
settingsBtn.addEventListener('click',    () => window.sk.openSettings());
settingsFsBtn.addEventListener('click',  () => window.sk.openSettings());
upBtn.addEventListener('click',          () => window.sk.openSettings());
clearBtn.addEventListener('click',       () => window.sk.clearHistory());
newChatBtn.addEventListener('click',     () => window.sk.clearHistory());

// Scan
async function doScan(btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '…';
  await window.sk.manualScan();
  btn.disabled = false; btn.textContent = orig;
}
scanBtn.addEventListener('click',    () => doScan(scanBtn));
scanFsBtn.addEventListener('click',  () => doScan(scanFsBtn));

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

// ─── Input auto-grow ──────────────────────────────────────────────────────────
msg.addEventListener('input', () => {
  msg.style.height = 'auto';
  msg.style.height = Math.min(msg.scrollHeight, 160) + 'px';
});

// ─── Send ─────────────────────────────────────────────────────────────────────
async function sendMsg() {
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

// ─── Render: user bubble ──────────────────────────────────────────────────────
function appendUser(text) {
  showFeed();
  maybeTimeDivider();
  const el = document.createElement('div');
  el.className = 'user-bubble';
  let inner = '';
  if (pendingPreview) {
    inner += `<div class="screen-thumb-wrap">
      <img class="screen-thumb" src="data:image/jpeg;base64,${pendingPreview}" alt="screen">
      <span class="screen-thumb-label">SCREEN</span>
    </div>`;
    pendingPreview = null;
  }
  inner += `${esc(text)}<span class="bubble-time">${now()}</span>`;
  el.innerHTML = inner;
  feed.insertBefore(el, thinking);
  scrollBottom(true);
}

// ─── Render: AI group ─────────────────────────────────────────────────────────
function makeGroup(metaLabel) {
  const el = document.createElement('div');
  el.className = 'group';
  el.innerHTML = `
    <div class="avatar">S</div>
    <div class="group-r">
      <div class="g-meta">${esc(metaLabel)} <span class="g-time">${now()}</span></div>
    </div>`;
  return el;
}

// ─── Render: streaming ────────────────────────────────────────────────────────
function createStreamEl() {
  showFeed();
  const el = makeGroup('Sidekick');
  const right = el.querySelector('.group-r');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.innerHTML = '<div class="chat-body"></div><span class="stream-cursor">▋</span>';
  right.appendChild(msgDiv);
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
  const right = group.querySelector('.group-r');
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
      btn.textContent = '🔍 Compare prices';
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

  right.appendChild(wrap);
  if (data.summary) {
    const s = document.createElement('div');
    s.className = 'g-summary';
    s.textContent = data.summary;
    right.appendChild(s);
  }

  if (data?._tier) setTierDisplay(data._tier, data._used, data._limit);
  feed.insertBefore(group, thinking);
  scrollBottom();
}

// ─── Render: error ────────────────────────────────────────────────────────────
function appendError(message) {
  showFeed();
  if (streamEl) { finalizeStream({}); }
  const el = document.createElement('div');
  el.className = 'err';
  el.innerHTML = `<span style="font-size:15px;flex-shrink:0">⚠</span><div>${esc(message)}<span>Retrying in 15 s…</span></div>`;
  feed.insertBefore(el, thinking);
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
});

window.sk.on('analysis', renderAnalysis);
window.sk.on('screen-preview', ({ b64 }) => { pendingPreview = b64; });

window.sk.on('scan-status', ({ scanning }) => {
  hdrDot.classList.toggle('on', scanning);
  if (scanning && !streamEl) {
    thinkTime.textContent  = now();
    thinking.style.display = 'flex';
  } else {
    thinking.style.display = 'none';
  }
});

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
const TYPE_LABELS = { location:'📍', preference:'⚙', goal:'🎯', habit:'🔄', personal:'👤', interest:'✦', finance:'💳', health:'💪' };

function renderMemory(facts, journal) {
  if (!facts.length) {
    memBody.innerHTML = '<div class="mem-empty">Nothing remembered yet.<br>Start chatting and I\'ll learn about you automatically.</div>';
    memCount.textContent = '0 facts';
    return;
  }
  memCount.textContent = `${facts.length} fact${facts.length !== 1 ? 's' : ''}`;
  memBody.innerHTML = facts.map(f => `
    <div class="fact-row">
      <span class="fact-type">${TYPE_LABELS[f.type] || '·'} ${f.type || ''}</span>
      <span class="fact-key">${f.key.replace(/_/g,' ')}</span>
      <span class="fact-val">${esc(f.value)}</span>
      <button class="fact-del" data-key="${esc(f.key)}" title="Forget this">✕</button>
    </div>`).join('');
  memBody.querySelectorAll('.fact-del').forEach(btn =>
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
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  counter.style.display   = 'none';
  upgrade.style.display   = 'none';
  tierBadge.style.display = 'none';

  const [lic, mode] = await Promise.all([
    window.sk.checkLicense(),
    window.sk.getWindowMode(),
  ]);

  applyMode(mode || 'sidebar');
  setTierDisplay(lic.tier, lic.used, lic.limit);

  if (lic.tier === 'free' && lic.used < lic.limit) {
    trialInfo.style.display = 'block';
    const rem = lic.limit - lic.used;
    trialInfo.textContent = `Free trial · ${rem} message${rem !== 1 ? 's' : ''} remaining`;
  } else {
    trialInfo.style.display = 'none';
  }
}

init();
