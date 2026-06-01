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

  // ── Helper: draw eye path ────────────────────────────────────────────────────
  // Elegant almond eye, slightly taller than before, well-centered
  function eyePath(scale, offY) {
    const w = scale;        // half-width
    const h = scale * 0.52; // half-height
    const ey = cy + (offY || 0);
    g.beginPath();
    // left tip → top arc → right tip
    g.moveTo(cx - w, ey);
    g.bezierCurveTo(cx - w * 0.5, ey - h * 1.4,  cx + w * 0.5, ey - h * 1.4,  cx + w, ey);
    // right tip → bottom arc → left tip
    g.bezierCurveTo(cx + w * 0.5, ey + h * 1.4,  cx - w * 0.5, ey + h * 1.4,  cx - w, ey);
    g.closePath();
  }

  // ── Eye outline stroke — crisp with soft halo ───────────────────────────────
  const eyeGrad = g.createLinearGradient(cx - 300, cy - 180, cx + 300, cy + 180);
  eyeGrad.addColorStop(0,   '#f4a875');
  eyeGrad.addColorStop(0.45,'#e07840');
  eyeGrad.addColorStop(1,   '#c05020');

  // Outer soft halo pass
  eyePath(295, 0);
  g.strokeStyle = 'rgba(220, 100, 40, 0.18)';
  g.lineWidth   = 72;
  g.lineJoin    = 'round';
  g.lineCap     = 'round';
  g.stroke();

  // Main stroke
  eyePath(295, 0);
  g.strokeStyle = eyeGrad;
  g.lineWidth   = 34;
  g.lineJoin    = 'round';
  g.lineCap     = 'round';
  g.shadowColor = 'rgba(220, 110, 50, 0.6)';
  g.shadowBlur  = 28;
  g.stroke();
  g.shadowBlur  = 0;

  // ── Iris ring ────────────────────────────────────────────────────────────────
  const irisR = 112;

  const irisGrad = g.createLinearGradient(cx - irisR, cy - irisR, cx + irisR, cy + irisR);
  irisGrad.addColorStop(0,   '#f2a868');
  irisGrad.addColorStop(1,   '#c04818');
  g.beginPath();
  g.arc(cx, cy, irisR, 0, Math.PI * 2);
  g.strokeStyle = irisGrad;
  g.lineWidth   = 22;
  g.shadowColor = 'rgba(210, 90, 30, 0.45)';
  g.shadowBlur  = 18;
  g.stroke();
  g.shadowBlur  = 0;

  // ── Pupil — solid filled circle ──────────────────────────────────────────────
  const pupilR = 46;
  const pupilGrad = g.createRadialGradient(cx - 12, cy - 14, 0, cx, cy, pupilR);
  pupilGrad.addColorStop(0,   '#fcc090');
  pupilGrad.addColorStop(0.6, '#d86830');
  pupilGrad.addColorStop(1,   '#a83208');

  g.beginPath();
  g.arc(cx, cy, pupilR, 0, Math.PI * 2);
  g.fillStyle   = pupilGrad;
  g.shadowColor = 'rgba(220, 100, 40, 0.8)';
  g.shadowBlur  = 22;
  g.fill();
  g.shadowBlur  = 0;

  // ── Specular highlight ───────────────────────────────────────────────────────
  const spec = g.createRadialGradient(cx - 14, cy - 16, 0, cx - 14, cy - 16, 22);
  spec.addColorStop(0,   'rgba(255,235,210,0.6)');
  spec.addColorStop(1,   'rgba(255,235,210,0)');
  g.beginPath();
  g.arc(cx - 14, cy - 16, 22, 0, Math.PI * 2);
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
