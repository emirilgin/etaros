#!/usr/bin/env node
/**
 * Etaros icon generator
 * Renders the app icon using Electron's offscreen canvas,
 * then creates .icns (macOS) from it using sips + iconutil.
 * Run once: npm run gen-icon
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT  = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

// ─── Icon HTML/Canvas ─────────────────────────────────────────────────────────
// Renders a 1024×1024 Etaros icon
// Concept: geometric eye — "your second pair of eyes"
// Structure: lens outline + iris ring + pupil, orange gradient on dark bg
// Same design philosophy as Claude's logo: abstract, geometric, minimal
const ICON_HTML = /* html */`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1024px;height:1024px;overflow:hidden;background:transparent}</style>
</head><body>
<canvas id="c" width="1024" height="1024"></canvas>
<script>
(function () {
  const cv = document.getElementById('c');
  const g  = cv.getContext('2d');
  const S  = 1024, cx = 512, cy = 512;

  // ── Clip to rounded square ──────────────────────────────────────────────────
  g.beginPath();
  g.roundRect(0, 0, S, S, 220);
  g.clip();

  // ── Background: light cream-white ──────────────────────────────────────────
  const bg = g.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#f0f8ff');
  bg.addColorStop(1, '#e4f0ff');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);

  // ── Subtle radial glow behind symbol ───────────────────────────────────────
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 420);
  glow.addColorStop(0,   'rgba(58, 138, 180, 0.08)');
  glow.addColorStop(1,   'rgba(58, 138, 180, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);

  // ── Color gradient: oceaan blauw ────────────────────────────────────────────
  const gr = g.createLinearGradient(cx - 250, cy - 250, cx + 250, cy + 250);
  gr.addColorStop(0, '#3a8ab4');
  gr.addColorStop(1, '#1a5a7a');

  const LW = 28; // line width — ultra thin relative to 1024px canvas

  g.strokeStyle = gr;
  g.lineWidth   = LW;
  g.lineCap     = 'round';
  g.shadowColor = 'rgba(26, 90, 122, 0.35)';
  g.shadowBlur  = 24;

  // ── Outer circle ────────────────────────────────────────────────────────────
  const R = 310;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();

  // ── Wavy explosion rays inside circle ──────────────────────────────────────
  const RAYS   = 12;
  const INNER  = 80;

  for (let i = 0; i < RAYS; i++) {
    const a     = i * Math.PI * 2 / RAYS;
    const outer = i % 2 === 0 ? 220 : 150;
    const aMid  = a + 0.28;
    const rMid  = 130;

    g.beginPath();
    g.moveTo(cx + Math.cos(a) * INNER,  cy + Math.sin(a) * INNER);
    g.quadraticCurveTo(
      cx + Math.cos(aMid) * rMid, cy + Math.sin(aMid) * rMid,
      cx + Math.cos(a)    * outer, cy + Math.sin(a)    * outer
    );
    g.stroke();
  }

  // ── Center dot ──────────────────────────────────────────────────────────────
  g.beginPath();
  g.arc(cx, cy, 44, 0, Math.PI * 2);
  g.fillStyle   = gr;
  g.shadowBlur  = 40;
  g.fill();
  g.shadowBlur  = 0;

  document.title = 'ICON_DONE';
})();
</script>
</body></html>`;

// ─── Main ─────────────────────────────────────────────────────────────────────
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  console.log('⟳  Rendering icon…');

  const win = new BrowserWindow({
    width: 1024, height: 1024,
    show: false, frame: false, transparent: true,
    webPreferences: { contextIsolation: false },
  });

  await win.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(ICON_HTML)
  );

  // Wait for canvas render
  await new Promise(r => setTimeout(r, 900));

  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.mkdirSync(BUILD, { recursive: true });

  const pngPath = path.join(BUILD, 'icon.png');
  fs.writeFileSync(pngPath, img.toPNG());
  console.log('✓  build/icon.png  (1024×1024)');

  // ── Create .icns (macOS only) ─────────────────────────────────────────────
  if (process.platform === 'darwin') {
    try {
      const iconset = path.join(BUILD, 'icon.iconset');
      fs.mkdirSync(iconset, { recursive: true });

      const sizes = [
        [16,   'icon_16x16'],
        [32,   'icon_16x16@2x'],
        [32,   'icon_32x32'],
        [64,   'icon_32x32@2x'],
        [128,  'icon_128x128'],
        [256,  'icon_128x128@2x'],
        [256,  'icon_256x256'],
        [512,  'icon_256x256@2x'],
        [512,  'icon_512x512'],
        [1024, 'icon_512x512@2x'],
      ];

      for (const [size, name] of sizes) {
        execSync(
          `sips -z ${size} ${size} "${pngPath}" --out "${path.join(iconset, name + '.png')}"`,
          { stdio: 'pipe' }
        );
      }

      execSync(
        `iconutil -c icns "${iconset}" -o "${path.join(BUILD, 'icon.icns')}"`,
        { stdio: 'pipe' }
      );
      console.log('✓  build/icon.icns (macOS)');

      // Clean up iconset folder
      fs.rmSync(iconset, { recursive: true, force: true });
    } catch (e) {
      console.warn('⚠  Could not create .icns:', e.message);
    }
  }

  app.quit();
});
