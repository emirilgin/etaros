#!/usr/bin/env node
'use strict';

/**
 * Sidekick — HMAC-signed License Key Generator
 * Keys are cryptographically signed — random guesses fail the checksum.
 *
 * Usage:
 *   node scripts/gen-keys.js --type tester --count 10
 *   node scripts/gen-keys.js --type pro --count 5
 *   node scripts/gen-keys.js --type max --count 3 --name "John Doe"
 *
 * Types:
 *   tester → STEST-XXXX-XXXX-{checksum}  (max tier, for beta testers)
 *   pro    → SIDE-XXXX-XXXX-{checksum}   (pro tier)
 *   max    → SMAX-XXXX-XXXX-{checksum}   (max tier)
 *
 * The last 4-char segment is an HMAC-SHA256 checksum of the first two segments.
 * Keys generated without the correct secret will be rejected by the app.
 */

const { randomBytes, createHmac } = require('crypto');
const path = require('path');

// Load license secret from app.config.js (gitignored)
let licenseSecret = '';
try {
  const cfg = require(path.join(__dirname, '..', 'app.config.js'));
  licenseSecret = cfg.licenseSecret || '';
} catch { /* no config */ }

if (!licenseSecret || licenseSecret === 'YOUR_64_CHAR_HEX_SECRET_HERE') {
  console.error('\n[error] licenseSecret not set in app.config.js\n');
  console.error('Add this to app.config.js:');
  console.error('  licenseSecret: require("crypto").randomBytes(32).toString("hex"),\n');
  process.exit(1);
}

function parseArgs() {
  const args  = process.argv.slice(2);
  const get   = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };
  return {
    type:  get('--type',  'tester'),
    count: parseInt(get('--count', '1')),
    name:  get('--name',  ''),
  };
}

function segment() {
  return randomBytes(2).toString('hex').toUpperCase();
}

function checksum(r1, r2) {
  return createHmac('sha256', licenseSecret)
    .update(r1 + r2)
    .digest('hex')
    .slice(0, 4)
    .toUpperCase();
}

function genKey(type) {
  const r1 = segment();
  const r2 = segment();
  const c3 = checksum(r1, r2);
  switch (type) {
    case 'tester': return `STEST-${r1}-${r2}-${c3}`;
    case 'pro':    return `SIDE-${r1}-${r2}-${c3}`;
    case 'max':    return `SMAX-${r1}-${r2}-${c3}`;
    default: throw new Error(`Unknown type: ${type}. Use: tester, pro, max`);
  }
}

const { type, count, name } = parseArgs();

console.log(`\nGenerating ${count} ${type.toUpperCase()} key(s) [HMAC-signed]:\n`);
for (let i = 0; i < count; i++) {
  const key   = genKey(type);
  const label = name ? ` ← ${name}` : '';
  console.log(`  ${key}${label}`);
}
console.log(`\nDone. Paste into Settings → Your Plan to activate.\n`);
