#!/usr/bin/env node
'use strict';

/**
 * Sidekick — Multi-Platform Auto-Poster
 * Posts to: Reddit, Discord, Telegram, Bluesky, Twitter/X
 *
 * Usage: node social-bot/post-all.js --stats social-bot/posts.json --image social-bot/card.png
 *
 * Env vars needed (set in GitHub Secrets):
 *   Reddit:   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 *   Discord:  DISCORD_WEBHOOK_URL
 *   Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID
 *   Bluesky:  BSKY_HANDLE, BSKY_PASSWORD
 *   Twitter:  TW_API_KEY, TW_API_SECRET, TW_ACCESS_TOKEN, TW_ACCESS_SECRET
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const crypto = require('crypto');

// ── Load posts JSON ───────────────────────────────────────────────────────────
function loadPosts(jsonPath) {
  if (!fs.existsSync(jsonPath)) throw new Error(`posts.json not found: ${jsonPath}`);
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function req(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isJson = typeof body === 'object' && body !== null && !Buffer.isBuffer(body);
    const bodyStr = isJson ? JSON.stringify(body) : (body || '');
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers: {
        'User-Agent': 'SidekickBot/1.0',
        ...(isJson ? { 'Content-Type': 'application/json' } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };
    const r = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: d, headers: res.headers }); }
      });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

// ── REDDIT ────────────────────────────────────────────────────────────────────
async function postReddit(posts) {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
  if (!REDDIT_CLIENT_ID) { console.log('⏭  Reddit: skipped (no credentials)'); return; }

  // Get access token
  const creds  = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const body   = `grant_type=password&username=${encodeURIComponent(REDDIT_USERNAME)}&password=${encodeURIComponent(REDDIT_PASSWORD)}`;
  const token  = await req('POST', 'https://www.reddit.com/api/v1/access_token', body, {
    'Authorization': `Basic ${creds}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  if (!token.body.access_token) throw new Error('Reddit auth failed: ' + JSON.stringify(token.body));
  const at = token.body.access_token;

  // Post to r/privacy
  const subreddits = ['privacy', 'sidekickapp'];
  for (const sub of subreddits) {
    try {
      const post = await req('POST', 'https://oauth.reddit.com/api/submit', {
        sr:      sub,
        kind:    'self',
        title:   posts.reddit_title,
        text:    posts.reddit_body,
        resubmit: true,
        nsfw:    false,
        spoiler: false,
      }, {
        'Authorization': `Bearer ${at}`,
        'Content-Type':  'application/json',
      });
      if (post.body?.json?.errors?.length) {
        console.log(`⚠  Reddit r/${sub}: ${JSON.stringify(post.body.json.errors)}`);
      } else {
        console.log(`✓  Reddit r/${sub}: posted`);
      }
    } catch (e) {
      console.log(`⚠  Reddit r/${sub}: ${e.message}`);
    }
    await sleep(2000); // rate limit
  }
}

// ── DISCORD ───────────────────────────────────────────────────────────────────
async function postDiscord(posts, imagePath) {
  const { DISCORD_WEBHOOK_URL } = process.env;
  if (!DISCORD_WEBHOOK_URL) { console.log('⏭  Discord: skipped (no webhook)'); return; }

  // Read image as base64 for embed
  const hasImage = imagePath && fs.existsSync(imagePath);

  const payload = {
    username:   'Sidekick',
    avatar_url: 'https://raw.githubusercontent.com/emirilgin/sidekick/main/build/icon.png',
    embeds: [{
      title:       '👻 Weekly Report',
      description: posts.twitter,
      color:       0x8b7fd4,
      footer:      { text: 'getsidekick.app • Your digital bodyguard' },
      timestamp:   new Date().toISOString(),
    }],
  };

  const res = await req('POST', DISCORD_WEBHOOK_URL, payload);
  if (res.status === 204 || res.status === 200) {
    console.log('✓  Discord: posted');
  } else {
    console.log('⚠  Discord:', res.status, JSON.stringify(res.body));
  }

  // If image exists, send as follow-up
  if (hasImage) {
    await sleep(1000);
    const imgData  = fs.readFileSync(imagePath);
    const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="card.png"\r\nContent-Type: image/png\r\n\r\n`,
      imgData,
      `\r\n--${boundary}--\r\n`,
    ];
    const formBody = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));

    await new Promise((resolve, reject) => {
      const u = new URL(DISCORD_WEBHOOK_URL);
      const r = https.request({
        hostname: u.hostname, path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type':   `multipart/form-data; boundary=${boundary}`,
          'Content-Length': formBody.length,
          'User-Agent':     'SidekickBot/1.0',
        },
      }, res => { res.on('data', () => {}); res.on('end', resolve); });
      r.on('error', reject);
      r.write(formBody);
      r.end();
    });
    console.log('✓  Discord: image sent');
  }
}

// ── TELEGRAM ──────────────────────────────────────────────────────────────────
async function postTelegram(posts, imagePath) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN) { console.log('⏭  Telegram: skipped (no token)'); return; }

  const base = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  // Send text message
  const text = `👻 *Sidekick Weekly*\n\n${posts.twitter}\n\n_Your digital bodyguard — getsidekick.app_`;
  const textRes = await req('POST', `${base}/sendMessage`, {
    chat_id:    TELEGRAM_CHANNEL_ID,
    text,
    parse_mode: 'Markdown',
  });
  if (textRes.body.ok) { console.log('✓  Telegram: message sent'); }
  else { console.log('⚠  Telegram:', JSON.stringify(textRes.body)); return; }

  // Send image if available
  if (imagePath && fs.existsSync(imagePath)) {
    await sleep(1000);
    const imgData  = fs.readFileSync(imagePath);
    const boundary = '----TGBoundary' + crypto.randomBytes(8).toString('hex');
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHANNEL_ID}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="card.png"\r\nContent-Type: image/png\r\n\r\n`,
      imgData,
      `\r\n--${boundary}--\r\n`,
    ];
    const formBody = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));

    await new Promise((resolve, reject) => {
      const u = new URL(`${base}/sendPhoto`);
      const r = https.request({
        hostname: u.hostname, path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type':   `multipart/form-data; boundary=${boundary}`,
          'Content-Length': formBody.length,
        },
      }, res => { res.on('data', () => {}); res.on('end', resolve); });
      r.on('error', reject);
      r.write(formBody);
      r.end();
    });
    console.log('✓  Telegram: image sent');
  }
}

// ── BLUESKY ───────────────────────────────────────────────────────────────────
async function postBluesky(posts, imagePath) {
  const { BSKY_HANDLE, BSKY_PASSWORD } = process.env;
  if (!BSKY_HANDLE) { console.log('⏭  Bluesky: skipped (no credentials)'); return; }

  // Auth
  const session = await req('POST', 'https://bsky.social/xrpc/com.atproto.server.createSession', {
    identifier: BSKY_HANDLE,
    password:   BSKY_PASSWORD,
  });
  if (!session.body.accessJwt) throw new Error('Bluesky auth failed: ' + JSON.stringify(session.body));
  const jwt = session.body.accessJwt;
  const did = session.body.did;

  let imageEmbed = null;

  // Upload image if available
  if (imagePath && fs.existsSync(imagePath)) {
    const imgData = fs.readFileSync(imagePath);
    const upload  = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'bsky.social',
        path:     '/xrpc/com.atproto.repo.uploadBlob',
        method:   'POST',
        headers:  {
          'Authorization':  `Bearer ${jwt}`,
          'Content-Type':   'image/png',
          'Content-Length': imgData.length,
        },
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
      });
      r.on('error', reject); r.write(imgData); r.end();
    });

    if (upload.blob) {
      imageEmbed = {
        $type:  'app.bsky.embed.images',
        images: [{ alt: 'Sidekick weekly stats', image: upload.blob }],
      };
    }
  }

  // Post
  const record = {
    $type:     'app.bsky.feed.post',
    text:      posts.twitter.slice(0, 300),
    createdAt: new Date().toISOString(),
    ...(imageEmbed ? { embed: imageEmbed } : {}),
  };

  const postRes = await req('POST', 'https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    repo:       did,
    collection: 'app.bsky.feed.post',
    record,
  }, { 'Authorization': `Bearer ${jwt}` });

  if (postRes.body.uri) { console.log('✓  Bluesky: posted', postRes.body.uri); }
  else { console.log('⚠  Bluesky:', JSON.stringify(postRes.body)); }
}

// ── TWITTER ───────────────────────────────────────────────────────────────────
async function postTwitter(posts, imagePath) {
  const { TW_API_KEY } = process.env;
  if (!TW_API_KEY) { console.log('⏭  Twitter: skipped (no API key)'); return; }

  // Reuse post-twitter.js logic inline
  const { execSync } = require('child_process');
  try {
    const tweet = posts.twitter.replace(/"/g, '\\"');
    const cmd   = imagePath && fs.existsSync(imagePath)
      ? `node social-bot/post-twitter.js --text "${tweet}" --image "${imagePath}"`
      : `node social-bot/post-twitter.js --text "${tweet}"`;
    execSync(cmd, { stdio: 'inherit', env: process.env });
  } catch (e) {
    console.log('⚠  Twitter:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args      = process.argv.slice(2);
  const get       = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };
  const postsPath = get('--stats', 'social-bot/posts.json');
  const imagePath = get('--image', 'social-bot/card.png');

  const posts = loadPosts(postsPath);

  console.log('═══════════════════════════════════════');
  console.log('  Sidekick Multi-Platform Auto-Poster');
  console.log('═══════════════════════════════════════\n');

  const results = await Promise.allSettled([
    postReddit(posts),
    postDiscord(posts, imagePath),
    postTelegram(posts, imagePath),
    postBluesky(posts, imagePath),
    postTwitter(posts, imagePath),
  ]);

  console.log('\n═══════════════════════════════════════');
  const ok  = results.filter(r => r.status === 'fulfilled').length;
  const err = results.filter(r => r.status === 'rejected');
  console.log(`Done: ${ok}/5 platforms succeeded`);
  if (err.length) err.forEach(e => console.log('Error:', e.reason?.message));
}

main().catch(e => { console.error(e.message); process.exit(1); });
