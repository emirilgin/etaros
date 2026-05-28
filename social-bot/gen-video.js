#!/usr/bin/env node
'use strict';

/**
 * Sidekick — AI Video Generator
 * Uses Runway ML Gen-3 API to generate short promo clips.
 * Alternatively supports Luma Dream Machine API.
 *
 * Usage: node social-bot/gen-video.js --type weekly --threats 47 --saved 312
 *
 * Requires: RUNWAY_API_KEY or LUMA_API_KEY env var
 *
 * Video types:
 *   weekly   — animated weekly stats reveal
 *   demo     — Ghost mode catching a threat (cinematic)
 *   promo    — dark app UI reveal with glow effects
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const VIDEO_PROMPTS = {
  weekly: (threats, saved) =>
    `Cinematic dark tech UI reveal. A sleek dark sidebar app called "Sidekick" glows purple on a macOS desktop. ` +
    `Text appears: "${threats} threats caught this week". Then "€${saved} saved". Particle effects, clean motion graphics. ` +
    `Premium feel, like Apple keynote. 4K, dark mode aesthetic.`,

  demo:
    `POV: browsing the web at night. A suspicious phishing website appears. ` +
    `Suddenly a dark sidebar app glows — "⚠ RISK DETECTED: Fake login page". ` +
    `User closes the tab. App shows "Threat blocked". Cinematic, dramatic lighting, ` +
    `purple glow effects. Tech thriller aesthetic. No text overlays needed.`,

  promo:
    `Premium dark-mode desktop app reveal. Sleek sidebar interface with AI analysis results. ` +
    `Purple and green accent colors. Floating UI cards showing "47 threats caught", "€312 saved". ` +
    `Clean minimal animation, Apple-level polish. Dark background with subtle glow. ` +
    `Professional product demo aesthetic. 4K quality.`,
};

// ── Runway ML Gen-3 Alpha ─────────────────────────────────────────────────────
async function generateRunway(prompt, outPath) {
  const key = process.env.RUNWAY_API_KEY;
  if (!key) throw new Error('RUNWAY_API_KEY not set. Get one at runwayml.com');

  console.log('Submitting to Runway ML Gen-3…');

  // Step 1: Create task
  const createBody = JSON.stringify({
    model:         'gen3a_turbo',
    prompt_text:   prompt,
    duration:      5,
    ratio:         '1280:768',
    watermark:     false,
  });

  const createRes = await httpsPost('https://api.dev.runwayml.com/v1/image_to_video', createBody, {
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
    'X-Runway-Version': '2024-11-06',
  });

  if (!createRes.body.id) throw new Error('Runway task creation failed: ' + JSON.stringify(createRes.body));
  const taskId = createRes.body.id;
  console.log('Task created:', taskId);

  // Step 2: Poll until done
  let attempts = 0;
  while (attempts < 60) {
    await sleep(5000);
    attempts++;
    process.stdout.write(`\rPolling… ${attempts * 5}s`);

    const pollRes = await httpsGet(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      'Authorization': `Bearer ${key}`,
      'X-Runway-Version': '2024-11-06',
    });

    const { status, output, failure } = pollRes.body;
    if (status === 'SUCCEEDED' && output?.[0]) {
      console.log('\n✓ Video ready:', output[0]);
      await downloadFile(output[0], outPath);
      return outPath;
    }
    if (status === 'FAILED') throw new Error('Runway generation failed: ' + failure);
  }
  throw new Error('Runway timed out after 5 minutes');
}

// ── Luma Dream Machine ────────────────────────────────────────────────────────
async function generateLuma(prompt, outPath) {
  const key = process.env.LUMA_API_KEY;
  if (!key) throw new Error('LUMA_API_KEY not set. Get one at lumalabs.ai/dream-machine/api');

  console.log('Submitting to Luma Dream Machine…');

  const createBody = JSON.stringify({
    prompt,
    aspect_ratio: '16:9',
    loop:         false,
  });

  const createRes = await httpsPost('https://api.lumalabs.ai/dream-machine/v1/generations', createBody, {
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
  });

  const genId = createRes.body.id;
  if (!genId) throw new Error('Luma generation failed: ' + JSON.stringify(createRes.body));
  console.log('Generation started:', genId);

  let attempts = 0;
  while (attempts < 60) {
    await sleep(5000);
    attempts++;
    process.stdout.write(`\rPolling… ${attempts * 5}s`);

    const pollRes = await httpsGet(`https://api.lumalabs.ai/dream-machine/v1/generations/${genId}`, {
      'Authorization': `Bearer ${key}`,
    });

    const { state, assets, failure_reason } = pollRes.body;
    if (state === 'completed' && assets?.video) {
      console.log('\n✓ Video ready:', assets.video);
      await downloadFile(assets.video, outPath);
      return outPath;
    }
    if (state === 'failed') throw new Error('Luma failed: ' + failure_reason);
  }
  throw new Error('Luma timed out after 5 minutes');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args    = process.argv.slice(2);
  const get     = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };

  const type    = get('--type',    'promo');
  const threats = parseInt(get('--threats', '0'));
  const saved   = parseFloat(get('--saved',  '0'));
  const out     = get('--out', `social-bot/video-${type}.mp4`);
  const provider = process.env.RUNWAY_API_KEY ? 'runway' : 'luma';

  const promptFn = VIDEO_PROMPTS[type];
  if (!promptFn) { console.error(`Unknown type: ${type}. Use: weekly, demo, promo`); process.exit(1); }

  const prompt = typeof promptFn === 'function' ? promptFn(threats, saved) : promptFn;

  console.log(`Provider: ${provider}`);
  console.log(`Type:     ${type}`);
  console.log(`Prompt:   ${prompt.slice(0, 100)}…\n`);

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const result = provider === 'runway'
    ? await generateRunway(prompt, out)
    : await generateLuma(prompt, out);

  console.log(`\n✓ Video saved → ${result}`);
  console.log('Ready to post on Twitter/Instagram/TikTok.');
}

main().catch(e => { console.error('\nError:', e.message); process.exit(1); });
