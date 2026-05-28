#!/usr/bin/env node
'use strict';

/**
 * Sidekick — License Key Generator
 * Usage:
 *   node scripts/gen-keys.js --type tester --count 10
 *   node scripts/gen-keys.js --type pro --count 5
 *   node scripts/gen-keys.js --type max --count 3
 *
 * Types:
 *   tester → STEST-XXXX-XXXX-XXXX  (max tier, for beta testers / friends)
 *   pro    → SIDE-XXXX-XXXX-XXXX   (pro tier)
 *   max    → SMAX-XXXX-XXXX-XXXX   (max tier)
 */

const { randomBytes } = require('crypto');

function parseArgs() {
  const args  = process.argv.slice(2);
  const get   = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };
  return {
    type:  get('--type',  'tester'),
    count: parseInt(get('--count', '1')),
    name:  get('--name',  ''),   // optional: tag a key with a name
  };
}

function segment() {
  return randomBytes(2).toString('hex').toUpperCase();
}

function genKey(type) {
  const seg = `${segment()}-${segment()}-${segment()}`;
  switch (type) {
    case 'tester': return `STEST-${seg}`;
    case 'pro':    return `SIDE-${seg}`;
    case 'max':    return `SMAX-${seg}`;
    default: throw new Error(`Unknown type: ${type}. Use: tester, pro, max`);
  }
}

const { type, count, name } = parseArgs();
const keys = [];

console.log(`\nGenerating ${count} ${type.toUpperCase()} key(s):\n`);
for (let i = 0; i < count; i++) {
  const key = genKey(type);
  keys.push(key);
  const label = name ? ` ← ${name}` : '';
  console.log(`  ${key}${label}`);
}

console.log(`\n✓ Done. Paste into Settings → Your Plan to activate.\n`);
