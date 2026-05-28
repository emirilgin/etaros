#!/usr/bin/env node
'use strict';

/**
 * Sidekick — Discord Bot
 * Auto-welcome, invite tracking, !key command, !download command
 *
 * Setup:
 * 1. discord.com/developers → New Application → Bot → copy token
 * 2. Enable: Server Members Intent + Message Content Intent
 * 3. Add to server: OAuth2 → URL Generator → bot + applications.commands
 *    Permissions: Send Messages, Embed Links, Read Message History
 * 4. Set env vars: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
 * 5. node social-bot/discord-bot.js
 */

const https  = require('https');
const crypto = require('crypto');

const TOKEN    = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN) { console.error('DISCORD_BOT_TOKEN not set'); process.exit(1); }

// ── Discord REST helper ───────────────────────────────────────────────────────
function discordAPI(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: 'discord.com',
      path:     `/api/v10${path}`,
      method,
      headers: {
        'Authorization': `Bot ${TOKEN}`,
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Generate a tester key ─────────────────────────────────────────────────────
function genTesterKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `STEST-${seg()}-${seg()}-${seg()}`;
}

// ── Embeds ────────────────────────────────────────────────────────────────────
const WELCOME_EMBED = (username) => ({
  embeds: [{
    title: `👻 Welcome to Sidekick, ${username}!`,
    description: [
      'Thanks for joining the beta. Here\'s everything you need:',
      '',
      '**📥 Download**',
      '→ [Get the app](https://emirilgin.github.io/sidekick-downloads)',
      '',
      '**🔑 Your license key**',
      'Type `!key` here and I\'ll generate one for you instantly.',
      '',
      '**💬 Feedback**',
      'Post bugs, ideas, or screenshots in <#general>.',
      'Emir reads everything.',
      '',
      '**5 modes to try:**',
      '👻 Ghost · 🔐 Vault · 🌿 Bloom · ⚡ Flow · 🦅 Hawk',
    ].join('\n'),
    color:  0x8b7fd4,
    footer: { text: 'getsidekick.app • Your digital bodyguard' },
  }],
});

const DOWNLOAD_EMBED = {
  embeds: [{
    title: '⬇️ Download Sidekick',
    description: [
      '**🍎 Mac — Apple Silicon (M1/M2/M3/M4)**',
      '[Sidekick-arm64.dmg](https://github.com/emirilgin/sidekick-downloads/releases/latest/download/Sidekick-arm64.dmg)',
      '',
      '**🍎 Mac — Intel (pre-2020)**',
      '[Sidekick-x64.dmg](https://github.com/emirilgin/sidekick-downloads/releases/latest/download/Sidekick-x64.dmg)',
      '',
      '**🪟 Windows 10/11**',
      '[Sidekick-Setup.exe](https://github.com/emirilgin/sidekick-downloads/releases/latest/download/Sidekick-Setup.exe)',
      '',
      '**Install:**',
      'Mac: Open dmg → drag to Applications → right-click → Open → "Open Anyway"',
      'Windows: Run exe → "More info" → "Run anyway"',
    ].join('\n'),
    color: 0x5ab47a,
  }],
};

const KEY_EMBED = (key) => ({
  embeds: [{
    title: '🔑 Your Tester Key',
    description: [
      `\`\`\`${key}\`\`\``,
      '',
      '**How to activate:**',
      '1. Open Sidekick',
      '2. Click ⚙ Settings → Your Plan',
      '3. Paste the key → Activate',
      '4. All 5 Pro modes unlock instantly ✓',
    ].join('\n'),
    color:  0x8b7fd4,
    footer: { text: 'This key is yours. Don\'t share it.' },
  }],
});

const HELP_EMBED = {
  embeds: [{
    title: '👻 Sidekick Bot Commands',
    description: [
      '`!key` — Get your personal tester license key',
      '`!download` — Get download links for all platforms',
      '`!modes` — See all 5 focus modes explained',
      '`!help` — Show this message',
    ].join('\n'),
    color: 0x8b7fd4,
  }],
};

const MODES_EMBED = {
  embeds: [{
    title: '🎯 Sidekick Focus Modes',
    description: [
      '**👻 Ghost** *(Free)*',
      'Privacy & security. Catches phishing, fake logins, dark patterns.',
      '',
      '**🔐 Vault** *(Pro)*',
      'Wealth guard. Spots subscription traps, hidden fees, price manipulation.',
      '',
      '**🌿 Bloom** *(Pro)*',
      'Health coach. Flags misinformation, wellness scams, bad food choices.',
      '',
      '**⚡ Flow** *(Pro)*',
      'Focus guard. Detects distractions, rabbit holes, time wasters.',
      '',
      '**🦅 Hawk** *(Pro)*',
      'Deal hunter. Finds better prices, coupon codes, cashback.',
    ].join('\n'),
    color: 0x8b7fd4,
    footer: { text: 'Switch modes anytime from the sidebar' },
  }],
};

// ── Gateway (WebSocket) ───────────────────────────────────────────────────────
const WS_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

function connect() {
  // Node built-in doesn't have WebSocket — use a minimal implementation
  const net = require('net');
  const tls = require('tls');

  const wsKey = crypto.randomBytes(16).toString('base64');

  const socket = tls.connect(443, 'gateway.discord.gg', { servername: 'gateway.discord.gg' }, () => {
    const handshake = [
      'GET /?v=10&encoding=json HTTP/1.1',
      'Host: gateway.discord.gg',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${wsKey}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');
    socket.write(handshake);
  });

  let buffer   = Buffer.alloc(0);
  let upgraded = false;
  let heartbeatInterval = null;
  let sequence = null;

  function send(obj) {
    const data    = JSON.stringify(obj);
    const payload = Buffer.from(data);
    const len     = payload.length;
    let frame;
    if (len < 126) {
      frame = Buffer.allocUnsafe(6 + len);
      frame[0] = 0x81; frame[1] = 0x80 | len;
    } else {
      frame = Buffer.allocUnsafe(8 + len);
      frame[0] = 0x81; frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
      frame = Buffer.concat([frame.slice(0, 4), Buffer.allocUnsafe(4), payload]);
    }
    // Simple mask
    const mask = crypto.randomBytes(4);
    const start = len < 126 ? 2 : 4;
    mask.copy(frame, start);
    for (let i = 0; i < len; i++) frame[start + 4 + i] = payload[i] ^ mask[i % 4];
    socket.write(frame);
  }

  function identify() {
    send({
      op: 2,
      d: {
        token: TOKEN,
        intents: (1 << 9) | (1 << 15), // GUILD_MESSAGES + MESSAGE_CONTENT
        properties: { os: 'linux', browser: 'sidekick-bot', device: 'sidekick-bot' },
      },
    });
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    if (!upgraded) {
      const str = buffer.toString();
      if (str.includes('\r\n\r\n')) {
        upgraded = true;
        const headerEnd = buffer.indexOf('\r\n\r\n') + 4;
        buffer = buffer.slice(headerEnd);
        console.log('✓ Discord WebSocket connected');
      } else return;
    }

    while (buffer.length > 2) {
      const fin    = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len      = buffer[1] & 0x7f;
      let offset   = 2;

      if (len === 126) { if (buffer.length < 4) break; len = buffer.readUInt16BE(2); offset = 4; }
      if (buffer.length < offset + len) break;

      const payload = buffer.slice(offset, offset + len);
      buffer = buffer.slice(offset + len);

      if (opcode === 8) { console.log('Discord closed connection. Reconnecting...'); setTimeout(connect, 5000); return; }
      if (opcode === 9) { send(Buffer.concat([Buffer.from([0x8a, 0x80]), crypto.randomBytes(4)])); continue; }
      if (opcode !== 1) continue;

      try {
        const msg = JSON.parse(payload.toString());
        handleGateway(msg, send, { heartbeatInterval, sequence, identify });
        if (msg.s) sequence = msg.s;
      } catch {}
    }
  });

  socket.on('error', (e) => { console.error('WS error:', e.message); setTimeout(connect, 5000); });
  socket.on('close', ()  => { console.log('WS closed. Reconnecting...'); clearInterval(heartbeatInterval); setTimeout(connect, 5000); });
}

// ── Gateway event handler ─────────────────────────────────────────────────────
let heartbeatTimer = null;

async function handleGateway(msg, send, state) {
  // Hello — start heartbeat
  if (msg.op === 10) {
    const interval = msg.d.heartbeat_interval;
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => send({ op: 1, d: state.sequence }), interval);
    // Identify
    send({
      op: 2,
      d: {
        token:   TOKEN,
        intents: (1 << 9) | (1 << 15),
        properties: { os: 'linux', browser: 'sidekick', device: 'sidekick' },
      },
    });
    return;
  }

  if (msg.op !== 0) return;
  const { t, d } = msg;

  // Member join → DM welcome
  if (t === 'GUILD_MEMBER_ADD' && d.guild_id === GUILD_ID) {
    console.log(`New member: ${d.user.username}`);
    try {
      // Open DM channel
      const dm = await discordAPI('POST', '/users/@me/channels', { recipient_id: d.user.id });
      if (dm.body.id) {
        await discordAPI('POST', `/channels/${dm.body.id}/messages`, WELCOME_EMBED(d.user.username));
        console.log(`✓ Welcome DM sent to ${d.user.username}`);
      }
    } catch (e) { console.warn('DM failed:', e.message); }
    return;
  }

  // Message commands
  if (t === 'MESSAGE_CREATE') {
    const { content, channel_id, author } = d;
    if (!content || author.bot) return;

    const cmd = content.trim().toLowerCase();

    if (cmd === '!key') {
      const key = genTesterKey();
      console.log(`Key generated for ${author.username}: ${key}`);
      await discordAPI('POST', `/channels/${channel_id}/messages`, KEY_EMBED(key));
      return;
    }
    if (cmd === '!download') {
      await discordAPI('POST', `/channels/${channel_id}/messages`, DOWNLOAD_EMBED);
      return;
    }
    if (cmd === '!modes') {
      await discordAPI('POST', `/channels/${channel_id}/messages`, MODES_EMBED);
      return;
    }
    if (cmd === '!help') {
      await discordAPI('POST', `/channels/${channel_id}/messages`, HELP_EMBED);
      return;
    }
  }
}

console.log('Starting Sidekick Discord bot...');
connect();
