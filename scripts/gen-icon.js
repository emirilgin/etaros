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
// Renders a 1024×1024 Sidekick icon — dark rounded-square bg, orange hexagon, white S
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

  /* ── Background: dark warm rounded square ── */
  const bgGrad = g.createLinearGradient(0, 0, S, S);
  bgGrad.addColorStop(0, '#201c18');
  bgGrad.addColorStop(1, '#121009');
  g.beginPath();
  g.roundRect(0, 0, S, S, 220);
  g.fillStyle = bgGrad;
  g.fill();

  /* ── Subtle inner glow ring ── */
  const ringGrad = g.createRadialGradient(cx, cy-60, 40, cx, cy, 560);
  ringGrad.addColorStop(0,   'rgba(230,120,55,0.09)');
  ringGrad.addColorStop(0.6, 'rgba(230,120,55,0.04)');
  ringGrad.addColorStop(1,   'rgba(0,0,0,0)');
  g.beginPath();
  g.roundRect(0, 0, S, S, 220);
  g.fillStyle = ringGrad;
  g.fill();

  /* ── Orange hexagon ── */
  const hr = 330;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 6;
    const x = cx + hr * Math.cos(a);
    const y = cy + hr * Math.sin(a);
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.closePath();

  /* Hex fill gradient */
  const hexGrad = g.createLinearGradient(cx - hr, cy - hr * 0.8, cx + hr * 0.5, cy + hr);
  hexGrad.addColorStop(0,   '#f09050');
  hexGrad.addColorStop(0.45,'#d4703e');
  hexGrad.addColorStop(1,   '#a84820');
  g.fillStyle = hexGrad;

  /* Hex shadow/glow */
  g.shadowColor = 'rgba(210, 90, 30, 0.55)';
  g.shadowBlur  = 72;
  g.fill();
  g.shadowBlur  = 0;

  /* Hex highlight edge */
  g.strokeStyle = 'rgba(255,200,150,0.18)';
  g.lineWidth   = 5;
  g.stroke();

  /* ── White "S" lettermark ── */
  g.font         = 'bold 510px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
  g.fillStyle    = 'rgba(255,255,255,0.97)';
  g.textAlign    = 'center';
  g.textBaseline = 'middle';
  g.shadowColor  = 'rgba(0,0,0,0.35)';
  g.shadowBlur   = 18;
  g.shadowOffsetY= 6;
  g.fillText('S', cx, cy + 16);
  g.shadowBlur   = 0;
  g.shadowOffsetY= 0;

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
