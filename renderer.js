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

// ─── Window mode toggle ────────────────────────────────────────────────────────
expandBtn.addEventListener('click', () => window.sk.setMode('fullscreen'));
shrinkBtn.addEventListener('click', () => window.sk.setMode('sidebar'));
hideBtn.addEventListener('click',   () => window.sk.hideWindow());

// ─── Focus mode bar ───────────────────────────────────────────────────────────
const modeBar     = document.getElementById('mode-bar');
const modeTagline = document.getElementById('mode-tagline');

function renderModeBar(modeData) {
  if (!modeData) return;
  modeBar.innerHTML = '';
  const { active, modes } = modeData;

  modes.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'mode-btn' +
      (m.id === active  ? ' active'  : '') +
      (m.locked         ? ' locked'  : '');
    btn.style.setProperty('--mode-color', m.color);
    btn.title = m.locked ? `${m.name} — Pro/Max only` : m.tagline;
    btn.innerHTML = `
      <span class="mode-icon">${m.icon}</span>
      <span class="mode-name">${m.name}</span>
      ${m.locked ? '<span class="mode-lock">🔒</span>' : ''}
    `;

    if (!m.locked) {
      btn.addEventListener('click', async () => {
        const res = await window.sk.setMode(m.id);
        if (res?.reason === 'upgrade') {
          window.sk.openSettings();
          return;
        }
        if (res?.ok) {
          document.querySelectorAll('.mode-btn').forEach(b => {
            b.classList.toggle('active', b.querySelector('.mode-name').textContent === m.name);
          });
          updateModeTagline(m);
        }
      });
    } else {
      btn.addEventListener('click', () => window.sk.openSettings());
    }

    modeBar.appendChild(btn);
  });

  const activeModeObj = modes.find(m => m.id === active);
  if (activeModeObj) updateModeTagline(activeModeObj);
}

function updateModeTagline(m) {
  modeTagline.innerHTML = `<span>${m.icon} ${m.name}</span> — ${m.tagline}`;
  modeTagline.style.display = 'block';
  // Use mode color as CSS custom prop on root
  document.documentElement.style.setProperty('--mode-color', m.color);
}

// ─── Stats bar ────────────────────────────────────────────────────────────────
const statsBar = document.getElementById('stats-bar');

function renderStats(s) {
  if (!s) return;
  const hasAny = s.threats > 0 || s.saved > 0 || s.scans > 0;
  statsBar.dataset.empty = hasAny ? 'false' : 'true';
  if (!hasAny) return;
  document.getElementById('stat-threats-n').textContent = s.threats;
  document.getElementById('stat-saved-n').textContent   =
    s.saved >= 1000 ? `$${(s.saved/1000).toFixed(1)}k` : `$${s.saved.toFixed(s.saved < 10 ? 2 : 0)}`;
  document.getElementById('stat-scans-n').textContent   = s.scans >= 1000 ? `${(s.scans/1000).toFixed(1)}k` : s.scans;
}

window.sk.on('stats-updated', renderStats);

// Listen for mode changes pushed from main
window.sk.on('mode-changed', ({ mode, icon, name, color }) => {
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.querySelector('.mode-name')?.textContent === name);
  });
  modeTagline.innerHTML = `<span>${icon} ${name}</span> — `;
  document.documentElement.style.setProperty('--mode-color', color);
});

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
  msg.placeholder = 'Ask about this image, or just hit ↑ to analyze…';
}

function clearDropPreview() {
  pendingDropB64  = null;
  dropPreviewBar.style.display = 'none';
  dropPreviewImg.src  = '';
  dropPreviewName.textContent = '';
  msg.placeholder = 'Message Sidekick… or drop a screenshot';
  fileInput.value = '';
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
const _origSendMsg = sendMsg;
async function sendMsg() {
  if (pendingDropB64) {
    await analyzeDropped(pendingDropB64, dropPreviewName.textContent);
  } else {
    await _origSendMsg();
  }
}

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

// 📎 attach button → file picker
attachBtn.addEventListener('click', () => fileInput.click());
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

    // SAVE card → one-click log saving
    if (t === 'save') {
      const amtMatch = `${item.title} ${item.detail||''}`.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
      const amount   = amtMatch ? parseFloat(amtMatch[1]) : null;
      const logBtn   = document.createElement('button');
      logBtn.className   = 'card-log-btn';
      logBtn.textContent = amount ? `💰 Log $${amount} saved` : '💰 Log saving';
      logBtn.addEventListener('click', async () => {
        if (logBtn.disabled) return;
        let finalAmt = amount;
        if (!finalAmt) {
          const v = prompt('Amount saved ($)?');
          finalAmt = parseFloat(v) || 0;
          if (!finalAmt) return;
        }
        await window.sk.logSaving({ item: item.title, amount: finalAmt });
        logBtn.textContent = '✓ Logged!';
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
      logBtn.textContent = kcal ? `🥗 Log ${kcal} kcal` : '🥗 Log meal';
      logBtn.addEventListener('click', async () => {
        if (logBtn.disabled) return;
        await window.sk.logDiet({ item: item.title, kcal });
        logBtn.textContent = '✓ Logged!';
        logBtn.disabled = true;
        logBtn.classList.add('logged');
      });
      c.appendChild(logBtn);
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

// ─── Auto-update banner ───────────────────────────────────────────────────────
const updateBanner = document.getElementById('update-banner');
const updateMsg    = document.getElementById('update-msg');
const updateBtn    = document.getElementById('update-btn');

window.sk.on('update-status', ({ status, version, percent }) => {
  if (!updateBanner) return;
  switch (status) {
    case 'available':
      updateMsg.textContent = `✦ v${version} available — downloading…`;
      updateBanner.style.display = 'flex';
      updateBtn.style.display = 'none';
      break;
    case 'downloading':
      updateMsg.textContent = `⬇ Downloading update… ${percent}%`;
      updateBanner.style.display = 'flex';
      updateBtn.style.display = 'none';
      break;
    case 'ready':
      updateMsg.textContent = `✦ v${version} ready to install`;
      updateBtn.style.display = '';
      updateBanner.style.display = 'flex';
      break;
    default:
      break; // checking / up-to-date: stay hidden
  }
});

if (updateBtn) {
  updateBtn.addEventListener('click', () => {
    updateBtn.textContent = 'Restarting…';
    updateBtn.disabled = true;
    window.sk.installUpdate();
  });
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

// ─── Search engine ───────────────────────────────────────────────────────────
const enc = encodeURIComponent;

const SEARCH_CATS = [
  { id:'food',    icon:'🍜', label:'Food',
    sites:(q,loc)=>[
      `https://www.google.com/maps/search/${enc(loc?q+' near '+loc:q)}`,
      `https://www.yelp.com/search?find_desc=${enc(q)}&find_loc=${enc(loc||'')}`,
      `https://www.ubereats.com/search?q=${enc(q)}`,
    ]},
  { id:'shop',    icon:'🛍', label:'Shop',
    sites:(q)=>[
      `https://www.google.com/search?q=${enc(q)}&tbm=shop`,
      `https://www.amazon.com/s?k=${enc(q)}`,
      `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}`,
    ]},
  { id:'travel',  icon:'✈️', label:'Travel',
    sites:(q)=>[
      `https://www.google.com/travel/flights?q=${enc(q)}`,
      `https://www.skyscanner.com/transport/flights/search/?query=${enc(q)}`,
      `https://www.booking.com/searchresults.html?ss=${enc(q)}`,
    ]},
  { id:'tech',    icon:'💻', label:'Tech',
    sites:(q)=>[
      `https://www.google.com/search?q=${enc(q)}`,
      `https://www.amazon.com/s?k=${enc(q)}`,
      `https://www.rtings.com/search#q=${enc(q)}`,
    ]},
  { id:'finance', icon:'💹', label:'Finance',
    sites:(q)=>[
      `https://finance.yahoo.com/search/?p=${enc(q)}`,
      `https://www.google.com/search?q=${enc(q)}+stock`,
      `https://www.investopedia.com/search/?q=${enc(q)}`,
    ]},
  { id:'health',  icon:'💊', label:'Health',
    sites:(q)=>[
      `https://www.google.com/search?q=${enc(q)}`,
      `https://www.webmd.com/search/search_results/default.aspx?query=${enc(q)}`,
      `https://www.nhs.uk/search/results?q=${enc(q)}`,
    ]},
  { id:'home',    icon:'🏠', label:'Home',
    sites:(q,loc)=>[
      `https://www.airbnb.com/s/${enc(loc?q+' '+loc:q)}/homes`,
      `https://www.rightmove.co.uk/search.html#/for-sale?keywords=${enc(q)}`,
      `https://www.zillow.com/search/homes/${enc(q)}/`,
    ]},
  { id:'fun',     icon:'🎬', label:'Fun',
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

function doSearch(query, catOverride) {
  const q = (query || document.getElementById('search-input')?.value || '').trim();
  if (!q) return;
  const catId = catOverride !== undefined ? catOverride : (selectedCat || detectCat(q));
  const cat   = SEARCH_CATS.find(c => c.id === catId);
  saveSrchRecent(q, catId);
  const urls = cat
    ? cat.sites(q, '')
    : [`https://www.google.com/search?q=${enc(q)}`, `https://duckduckgo.com/?q=${enc(q)}`];
  window.sk.openUrls(urls);
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
        <span class="srch-row-icon">${cat?.icon||'🔍'}</span>
        <span class="srch-row-text">${esc(r.q)}</span>
        <span class="srch-row-cat">${cat?.label||''}</span>
        <button class="srch-row-del" data-idx="${i}">✕</button>
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
  renderSearch();
  setTimeout(() => document.getElementById('search-input')?.focus(), 60);
}

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
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === name + '-panel'));
  if (name === 'notes')  { loadNotes(); setTimeout(() => noteInput?.focus(), 60); }
  if (name === 'life')   { loadLife().then(() => setTimeout(() => document.getElementById('saving-item')?.focus(), 60)); }
  if (name === 'search') { loadSearch(); }
  if (name === 'chat')   { setTimeout(() => msg?.focus(), 60); }
}
tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

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
      <div class="notes-empty-icon">📝</div>
      <span>No notes yet. Write something!</span>
    </div>`;
    return;
  }
  const sorted = [...notes].sort((a,b) => (b.pinned?1:0)-(a.pinned?1:0) || (b.updated||b.created||0)-(a.updated||a.created||0));
  notesList.innerHTML = sorted.map(n => `
    <div class="note-card${n.pinned?' pinned':''}" data-id="${n.id}">
      <div class="note-text">${esc(n.text)}</div>
      <div class="note-meta">
        <span class="note-date">${fmtDate(n.updated || n.created)}</span>
        <button class="note-pin" data-id="${n.id}" title="${n.pinned?'Unpin':'Pin'}">${n.pinned?'📌':'○'}</button>
        <button class="note-del" data-id="${n.id}" title="Delete">✕</button>
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

// ─── Life (Savings + Diet) ────────────────────────────────────────────────────
const lifeList = document.getElementById('life-list');

async function loadLife() {
  const [savings, diet] = await Promise.all([
    window.sk.getSavings(),
    window.sk.getDiet(),
  ]);
  renderLife(savings, diet);
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
          💰 ${esc(s.item)}
        </button>`).join('')}
    </div>` : '';

  const dietChips = recentDiet.length ? `
    <div class="life-recent-chips">
      ${recentDiet.map(d => `
        <button class="life-chip" data-type="diet" data-item="${esc(d.item)}" data-kcal="${d.kcal}">
          🥗 ${esc(d.item)}${d.kcal ? ` · ${d.kcal}` : ''}
        </button>`).join('')}
    </div>` : '';

  // ── stats ──────────────────────────────────────────────────────────────────
  const statsHtml = `
    <div class="stat-card green">
      <div class="stat-icon">💰</div>
      <div class="stat-body">
        <div class="stat-label">Total saved</div>
        <div class="stat-value">$${totalSaved.toFixed(2)}</div>
        <div class="stat-sub">${savings.length} saving${savings.length!==1?'s':''} logged</div>
      </div>
    </div>
    <div class="stat-card orange">
      <div class="stat-icon">🔥</div>
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
        <div class="life-entry-icon">💰</div>
        <div class="life-entry-body">
          <div class="life-entry-name">${esc(s.item)}</div>
          <div class="life-entry-date">${fmtDate(s.date)}</div>
        </div>
        <div class="life-entry-val green">+$${parseFloat(s.amount).toFixed(2)}</div>
        <button class="life-entry-del" data-id="${s.id}" data-type="saving">✕</button>
      </div>`).join('')
    : '<div class="life-empty">No savings yet.<br>Log what you saved — or let a scan card do it for you!</div>';

  const dietRows = diet.length
    ? diet.map(d => `
      <div class="life-entry">
        <div class="life-entry-icon">🥗</div>
        <div class="life-entry-body">
          <div class="life-entry-name">${esc(d.item)}</div>
          <div class="life-entry-date">${fmtDate(d.date)}</div>
        </div>
        <div class="life-entry-val blue">${d.kcal ? d.kcal+' kcal' : '—'}</div>
        <button class="life-entry-del" data-id="${d.id}" data-type="diet">✕</button>
      </div>`).join('')
    : '<div class="life-empty">No meals yet.<br>Type "big mac 550" and it auto-fills for you!</div>';

  lifeList.innerHTML = `
    ${statsHtml}

    <div class="life-section-hdr">💰 Savings</div>
    ${savingChips}
    <div class="life-add-row">
      <input class="life-add-input" id="saving-item" placeholder='e.g. "Amazon Prime 12"'>
      <input class="life-add-input" id="saving-amount" placeholder="$" type="number" min="0" style="max-width:68px">
      <button class="life-add-btn" id="saving-add-btn">+ Add</button>
    </div>
    ${savingsRows}

    <div class="life-section-hdr" style="margin-top:14px">🥗 Food & Diet</div>
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

  const [lic, mode, focusMode, stats] = await Promise.all([
    window.sk.checkLicense(),
    window.sk.getWindowMode(),
    window.sk.getMode(),
    window.sk.getStats(),
  ]);

  applyMode(mode || 'sidebar');
  renderModeBar(focusMode);
  renderStats(stats);
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
