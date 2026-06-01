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
  const S  = 1024, cx = 512, cy = 512, R = 224;

  // ── Clip to rounded square ──────────────────────────────────────────────────
  g.beginPath();
  g.roundRect(0, 0, S, S, 220);
  g.clip();

  // ── Background: deep warm-dark gradient (top-left lighter, bottom-right darker) ──
  const bg = g.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0,   '#1c1410');
  bg.addColorStop(0.5, '#120d09');
  bg.addColorStop(1,   '#0a0705');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);

  // ── Soft radial warmth behind the symbol ────────────────────────────────────
  const warmGlow = g.createRadialGradient(cx, cy + 20, 0, cx, cy + 20, 480);
  warmGlow.addColorStop(0,   'rgba(210, 100, 45, 0.18)');
  warmGlow.addColorStop(0.4, 'rgba(170,  70, 25, 0.07)');
  warmGlow.addColorStop(1,   'rgba(0,     0,  0, 0)');
  g.fillStyle = warmGlow;
  g.fillRect(0, 0, S, S);

  // ── Symbol: small elegant eye, lots of breathing room ──────────────────────
  // Claude/Anthropic style: symbol occupies ~40% of icon, centered, clean
  const EW = 185; // half-width of eye (eye spans 370px of 1024)
  const EH = EW * 0.48;

  function eyePath() {
    g.beginPath();
    g.moveTo(cx - EW, cy);
    g.bezierCurveTo(cx - EW * 0.5, cy - EH * 1.5,  cx + EW * 0.5, cy - EH * 1.5,  cx + EW, cy);
    g.bezierCurveTo(cx + EW * 0.5, cy + EH * 1.5,  cx - EW * 0.5, cy + EH * 1.5,  cx - EW, cy);
    g.closePath();
  }

  // Color: clean warm gradient, single direction
  const eyeGrad = g.createLinearGradient(cx - EW, cy - EH, cx + EW, cy + EH);
  eyeGrad.addColorStop(0,   '#f5ae80');
  eyeGrad.addColorStop(1,   '#c85020');

  // Soft outer glow
  eyePath();
  g.strokeStyle = 'rgba(210, 95, 38, 0.14)';
  g.lineWidth   = 54;
  g.lineJoin    = 'round';
  g.lineCap     = 'round';
  g.stroke();

  // Crisp main outline
  eyePath();
  g.strokeStyle = eyeGrad;
  g.lineWidth   = 26;
  g.lineJoin    = 'round';
  g.lineCap     = 'round';
  g.shadowColor = 'rgba(210, 90, 35, 0.5)';
  g.shadowBlur  = 20;
  g.stroke();
  g.shadowBlur  = 0;

  // ── Iris ring — proportional and airy ────────────────────────────────────────
  const irisR = 68;
  g.beginPath();
  g.arc(cx, cy, irisR, 0, Math.PI * 2);
  g.strokeStyle = eyeGrad;
  g.lineWidth   = 18;
  g.shadowColor = 'rgba(210, 90, 35, 0.4)';
  g.shadowBlur  = 14;
  g.stroke();
  g.shadowBlur  = 0;

  // ── Pupil — small, clean, glowing ────────────────────────────────────────────
  const pupilR = 26;
  const pupilGrad = g.createRadialGradient(cx - 7, cy - 8, 0, cx, cy, pupilR);
  pupilGrad.addColorStop(0,   '#ffc898');
  pupilGrad.addColorStop(0.5, '#de7030');
  pupilGrad.addColorStop(1,   '#a83010');
  g.beginPath();
  g.arc(cx, cy, pupilR, 0, Math.PI * 2);
  g.fillStyle   = pupilGrad;
  g.shadowColor = 'rgba(220, 100, 40, 0.9)';
  g.shadowBlur  = 18;
  g.fill();
  g.shadowBlur  = 0;

  // ── Specular dot ─────────────────────────────────────────────────────────────
  const spec = g.createRadialGradient(cx - 8, cy - 10, 0, cx - 8, cy - 10, 12);
  spec.addColorStop(0,   'rgba(255,240,220,0.65)');
  spec.addColorStop(1,   'rgba(255,240,220,0)');
  g.beginPath();
  g.arc(cx - 8, cy - 10, 12, 0, Math.PI * 2);
  g.fillStyle = spec;
  g.fill();

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
