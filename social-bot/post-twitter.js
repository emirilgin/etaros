#!/usr/bin/env node
'use strict';

/**
 * Sidekick — Twitter/X Auto-Poster
 * Posts tweet + image card to Twitter via API v2.
 * Requires env vars: TW_API_KEY, TW_API_SECRET, TW_ACCESS_TOKEN, TW_ACCESS_SECRET
 *
 * Usage: node social-bot/post-twitter.js --text "..." --image card.png
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// ── OAuth 1.0a (Twitter API v2 needs this for user context) ──────────────────
function oauthSign(method, url, params, secrets) {
  const { apiKey, apiSecret, accessToken, accessSecret } = secrets;

  const oauthParams = {
    oauth_consumer_key:     apiKey,
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const sorted    = Object.keys(allParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const key  = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const sig  = crypto.createHmac('sha1', key).update(base).digest('base64');

  oauthParams.oauth_signature = sig;

  const header = 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return header;
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function uploadMedia(imagePath, secrets) {
  const imageData = fs.readFileSync(imagePath);
  const b64       = imageData.toString('base64');
  const url       = 'https://upload.twitter.com/1.1/media/upload.json';
  const body      = `media_data=${encodeURIComponent(b64)}&media_category=tweet_image`;
  const auth      = oauthSign('POST', url, {}, secrets);

  const res = await httpsRequest({
    hostname: 'upload.twitter.com',
    path:     '/1.1/media/upload.json',
    method:   'POST',
    headers:  {
      'Authorization':  auth,
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  if (res.status !== 200 || !res.body.media_id_string) {
    throw new Error(`Media upload failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.media_id_string;
}

async function postTweet(text, mediaId, secrets) {
  const url  = 'https://api.twitter.com/2/tweets';
  const body = JSON.stringify(mediaId ? { text, media: { media_ids: [mediaId] } } : { text });
  const auth = oauthSign('POST', url, {}, secrets);

  const res = await httpsRequest({
    hostname: 'api.twitter.com',
    path:     '/2/tweets',
    method:   'POST',
    headers:  {
      'Authorization':  auth,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  if (res.status !== 201) {
    throw new Error(`Tweet failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function main() {
  const args    = process.argv.slice(2);
  const get     = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };
  const text    = get('--text',  '');
  const imgPath = get('--image', '');

  if (!text) { console.error('--text required'); process.exit(1); }

  const secrets = {
    apiKey:      process.env.TW_API_KEY,
    apiSecret:   process.env.TW_API_SECRET,
    accessToken: process.env.TW_ACCESS_TOKEN,
    accessSecret:process.env.TW_ACCESS_SECRET,
  };

  if (!secrets.apiKey) { console.error('TW_API_KEY not set'); process.exit(1); }

  console.log('Posting to Twitter…');

  let mediaId = null;
  if (imgPath && fs.existsSync(imgPath)) {
    console.log('Uploading image…');
    mediaId = await uploadMedia(imgPath, secrets);
    console.log('✓ Image uploaded:', mediaId);
  }

  const tweet = await postTweet(text, mediaId, secrets);
  console.log(`✓ Tweet posted: https://twitter.com/i/web/status/${tweet.id}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
