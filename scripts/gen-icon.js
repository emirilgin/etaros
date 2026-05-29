#!/usr/bin/env node
/**
 * Sidekick icon generator
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
// Renders a 1024×1024 Sidekick icon
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

  /* ── Background: deep cool-dark rounded square ── */
  const bgGrad = g.createLinearGradient(0, 0, S, S);
  bgGrad.addColorStop(0, '#16151a');
  bgGrad.addColorStop(1, '#0b0a0d');
  g.beginPath();
  g.roundRect(0, 0, S, S, 220);
  g.fillStyle = bgGrad;
  g.fill();

  /* ── Subtle radial glow behind eye ── */
  const glow = g.createRadialGradient(cx, cy, 60, cx, cy, 500);
  glow.addColorStop(0,   'rgba(208,112,64,0.12)');
  glow.addColorStop(0.5, 'rgba(208,112,64,0.04)');
  glow.addColorStop(1,   'rgba(0,0,0,0)');
  g.beginPath();
  g.roundRect(0, 0, S, S, 220);
  g.fillStyle = glow;
  g.fill();

  /* ── Orange gradient (used for all eye elements) ── */
  const eyeGrad = g.createLinearGradient(100, 200, 924, 824);
  eyeGrad.addColorStop(0, '#f0a070');
  eyeGrad.addColorStop(1, '#c85828');

  /* ── Eye lens — almond/vesica shape ──
     The eye curves from left-tip to right-tip via top-arc and bottom-arc.
     Original SVG viewBox 32×32, scaled 32× and centred in 1024×1024.
     SVG: M3 16 C3 16 8.5 7 16 7 C23.5 7 29 16 29 16
             C29 16 23.5 25 16 25 C8.5 25 3 16 3 16
     Scale=32, offset=(64,64):  every coord: canvas = svg*32 + 64
  */
  const sc = 32, ox = 64, oy = 64;
  // helper: svg → canvas
  const tx = v => v * sc + ox;
  const ty = v => v * sc + oy;

  g.beginPath();
  g.moveTo(tx(3), ty(16));
  g.bezierCurveTo(tx(3),   ty(16), tx(8.5), ty(7),  tx(16), ty(7));
  g.bezierCurveTo(tx(23.5),ty(7),  tx(29),  ty(16), tx(29), ty(16));
  g.bezierCurveTo(tx(29),  ty(16), tx(23.5),ty(25), tx(16), ty(25));
  g.bezierCurveTo(tx(8.5), ty(25), tx(3),   ty(16), tx(3),  ty(16));
  g.closePath();
  g.strokeStyle = eyeGrad;
  g.lineWidth   = 38;
  g.lineJoin    = 'round';
  g.lineCap     = 'round';
  g.shadowColor = 'rgba(200,88,40,0.55)';
  g.shadowBlur  = 60;
  g.stroke();
  g.shadowBlur  = 0;

  /* ── Iris ring ── */
  // SVG: circle cx=16 cy=16 r=5  → canvas: center=(tx(16),ty(16)), r=5*32=160
  const icx = tx(16), icy = ty(16), ir = 5 * sc;
  g.beginPath();
  g.arc(icx, icy, ir, 0, Math.PI * 2);
  g.strokeStyle = eyeGrad;
  g.lineWidth   = 32;
  g.shadowColor = 'rgba(200,88,40,0.4)';
  g.shadowBlur  = 40;
  g.stroke();
  g.shadowBlur  = 0;

  /* ── Pupil — filled circle ── */
  // SVG: circle cx=16 cy=16 r=2.3 → canvas: r=2.3*32=73.6
  const pr = 2.3 * sc;
  g.beginPath();
  g.arc(icx, icy, pr, 0, Math.PI * 2);
  g.fillStyle   = eyeGrad;
  g.shadowColor = 'rgba(200,88,40,0.8)';
  g.shadowBlur  = 50;
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
