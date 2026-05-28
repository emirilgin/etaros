#!/usr/bin/env node
'use strict';

/**
 * Sidekick — AI Post Copy Generator
 * Uses Gemini to write weekly social posts from stats.
 * Usage: node social-bot/gen-post.js --threats 47 --saved 312 --scans 203
 * Outputs JSON: { twitter, reddit_title, reddit_body, linkedin }
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

let APP_CONFIG = { geminiKey: '' };
try { APP_CONFIG = require('../app.config'); } catch {}

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
  return {
    threats:   parseInt(get('--threats', '0')),
    saved:     parseFloat(get('--saved',  '0')),
    scans:     parseInt(get('--scans',  '0')),
    highlight: get('--highlight', ''),  // optional: "caught a Netflix hidden fee"
    out:       get('--out', 'social-bot/posts.json'),
  };
}

async function generatePosts({ threats, saved, scans, highlight }) {
  const key = process.env.GEMINI_KEY || APP_CONFIG.geminiKey;
  if (!key) { console.error('No Gemini key. Set GEMINI_KEY env var.'); process.exit(1); }

  const genai = new GoogleGenerativeAI(key);
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const highlightLine = highlight ? `\nThis week's highlight: "${highlight}"` : '';

  const prompt = `You are writing social media posts for Sidekick — an AI desktop app that watches your screen silently and catches scams, phishing, subscription traps, and bad deals. Privacy-first, 100% on-device, €9/mo Pro.

This week's stats:
- ${threats} threats caught
- €${saved} saved for users
- ${scans} silent scans run${highlightLine}

Write 4 social posts. Return ONLY valid JSON, no markdown:
{
  "twitter": "tweet under 240 chars, punchy, no hashtags spam (max 2 tags), includes stats naturally",
  "twitter_alt": "alternative tweet, different angle, under 240 chars",
  "reddit_title": "Reddit post title, curiosity-driven, under 90 chars",
  "reddit_body": "Reddit post body, 3-4 sentences, conversational, ends with soft CTA. No salesy language.",
  "linkedin": "LinkedIn post, professional tone, 3-4 sentences, business angle (save time/money), ends with question to drive comments"
}

Rules:
- Twitter: lead with the most impressive stat. Punchy. Ghost emoji optional.
- Reddit: sound like a real person sharing a cool tool, not marketing
- LinkedIn: frame around ROI and productivity, not just security
- Never say "I'm happy to share" or "excited to announce"
- Be specific with numbers`;

  const result = await model.generateContent(prompt);
  const raw    = result.response.text();
  const m      = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in response: ' + raw);
  return JSON.parse(m[0]);
}

async function main() {
  const args = parseArgs();
  console.log('Generating posts with Gemini…');

  const posts = await generatePosts(args);

  // Write to file
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(posts, null, 2));

  console.log('\n✓ Posts generated:\n');
  console.log('── TWITTER ──────────────────────────────');
  console.log(posts.twitter);
  console.log('\n── TWITTER ALT ──────────────────────────');
  console.log(posts.twitter_alt);
  console.log('\n── REDDIT TITLE ─────────────────────────');
  console.log(posts.reddit_title);
  console.log('\n── REDDIT BODY ──────────────────────────');
  console.log(posts.reddit_body);
  console.log('\n── LINKEDIN ─────────────────────────────');
  console.log(posts.linkedin);
  console.log(`\n✓ Saved → ${outPath}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
