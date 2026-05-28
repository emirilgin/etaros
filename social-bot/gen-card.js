#!/usr/bin/env node
'use strict';

/**
 * Sidekick — Weekly Stat Card Generator
 * Generates a 1200x630 social card with weekly stats.
 * Usage: node social-bot/gen-card.js --threats 47 --saved 312 --scans 203 --out card.png
 */

const { createCanvas } = require('canvas');
const fs               = require('fs');
const path             = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : def;
  };
  return {
    threats: parseInt(get('--threats', '0')),
    saved:   parseFloat(get('--saved',   '0')),
    scans:   parseInt(get('--scans',   '0')),
    out:     get('--out', 'social-bot/card.png'),
    week:    get('--week', thisWeek()),
  };
}

function thisWeek() {
  const d   = new Date();
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return { r, g, b };
}

function rgbStr(hex, a = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function generateCard({ threats, saved, scans, week, out }) {
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── Background ──────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,   '#0c0c0e');
  bg.addColorStop(0.5, '#111118');
  bg.addColorStop(1,   '#0e0e14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ── Glow orb top-left ────────────────────────────────────────────────────
  const orb = ctx.createRadialGradient(200, 150, 0, 200, 150, 400);
  orb.addColorStop(0,   rgbStr('#8b7fd4', 0.12));
  orb.addColorStop(1,   rgbStr('#8b7fd4', 0));
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  // ── Border ────────────────────────────────────────────────────────────────
  drawRoundRect(ctx, 1, 1, W - 2, H - 2, 24);
  ctx.strokeStyle = rgbStr('#8b7fd4', 0.25);
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // ── Logo + brand ──────────────────────────────────────────────────────────
  ctx.font      = 'bold 22px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('✦ Sidekick', 52, 68);

  ctx.font      = '15px sans-serif';
  ctx.fillStyle = rgbStr('#ffffff', 0.35);
  ctx.fillText('Your digital bodyguard', 52, 92);

  // ── Week label ────────────────────────────────────────────────────────────
  ctx.font      = '14px sans-serif';
  ctx.fillStyle = rgbStr('#8b7fd4', 0.9);
  ctx.textAlign = 'right';
  ctx.fillText(`Week of ${week}`, W - 52, 68);
  ctx.textAlign = 'left';

  // ── Divider ───────────────────────────────────────────────────────────────
  ctx.strokeStyle = rgbStr('#ffffff', 0.07);
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(52, 114); ctx.lineTo(W - 52, 114); ctx.stroke();

  // ── Headline ──────────────────────────────────────────────────────────────
  ctx.font      = 'bold 42px sans-serif';
  ctx.fillStyle = '#f0f0f2';
  ctx.fillText('This week, Sidekick had your back.', 52, 186);

  // ── Stat cards ────────────────────────────────────────────────────────────
  const stats = [
    { icon: '🛡', value: String(threats), label: 'threats caught',   color: '#e05c5c', glow: rgbStr('#e05c5c', 0.08) },
    { icon: '💰', value: `€${saved % 1 === 0 ? saved : saved.toFixed(2)}`, label: 'saved',  color: '#5ab47a', glow: rgbStr('#5ab47a', 0.08) },
    { icon: '👁',  value: String(scans),   label: 'silent scans',    color: '#8b7fd4', glow: rgbStr('#8b7fd4', 0.08) },
  ];

  const cardW  = 320;
  const cardH  = 160;
  const startX = 52;
  const cardY  = 240;
  const gap    = 28;

  stats.forEach(({ icon, value, label, color, glow }, i) => {
    const x = startX + i * (cardW + gap);

    // Card bg
    drawRoundRect(ctx, x, cardY, cardW, cardH, 16);
    ctx.fillStyle = '#141418';
    ctx.fill();

    // Card border
    drawRoundRect(ctx, x, cardY, cardW, cardH, 16);
    ctx.strokeStyle = rgbStr(color.replace('#',''), 0) || rgbStr('#ffffff', 0.08);
    ctx.lineWidth   = 1;
    ctx.strokeStyle = `${color}44`;
    ctx.stroke();

    // Glow fill
    drawRoundRect(ctx, x, cardY, cardW, cardH, 16);
    ctx.fillStyle = glow;
    ctx.fill();

    // Icon
    ctx.font      = '32px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(icon, x + 24, cardY + 52);

    // Value
    ctx.font      = `bold 52px sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(value, x + 24, cardY + 118);

    // Label
    ctx.font      = '15px sans-serif';
    ctx.fillStyle = rgbStr('#ffffff', 0.45);
    ctx.fillText(label, x + 24, cardY + 144);
  });

  // ── CTA / tagline ─────────────────────────────────────────────────────────
  ctx.font      = '18px sans-serif';
  ctx.fillStyle = rgbStr('#ffffff', 0.5);
  ctx.fillText('100% on-device. Nothing leaves your machine.', 52, 462);

  // ── Bottom bar ────────────────────────────────────────────────────────────
  ctx.strokeStyle = rgbStr('#ffffff', 0.07);
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(52, 500); ctx.lineTo(W - 52, 500); ctx.stroke();

  // Ghost mode pill
  const pillX = 52, pillY = 522;
  drawRoundRect(ctx, pillX, pillY, 160, 36, 18);
  ctx.fillStyle = rgbStr('#8b7fd4', 0.12);
  ctx.fill();
  drawRoundRect(ctx, pillX, pillY, 160, 36, 18);
  ctx.strokeStyle = rgbStr('#8b7fd4', 0.3);
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.font        = '14px sans-serif';
  ctx.fillStyle   = '#8b7fd4';
  ctx.fillText('👻 Ghost Mode', pillX + 18, pillY + 24);

  // Domain
  ctx.font      = 'bold 15px sans-serif';
  ctx.fillStyle = rgbStr('#ffffff', 0.3);
  ctx.textAlign = 'right';
  ctx.fillText('getsidekick.app', W - 52, 546);
  ctx.textAlign = 'left';

  // ── Write file ────────────────────────────────────────────────────────────
  const outPath = path.resolve(out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`✓ Card written → ${outPath}`);
  return outPath;
}

generateCard(parseArgs());
