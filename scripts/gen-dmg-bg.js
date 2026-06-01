'use strict';
/**
 * Generates build/dmg-bg.png — the drag-to-Applications DMG background.
 * Two icon halos with an arrow between them, dark brand theme.
 * Run: npm run gen-dmg-bg
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');

const ROOT  = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

// ── Canvas dimensions ──────────────────────────────────────────────────────
// Generate at 2× (1080×760) so retina Macs are crisp.
// electron-builder uses this as the 1× background; macOS scales automatically.
const W = 1080, H = 760;
// Icon centres in 2× coords  (electron-builder positions are in 1×: 140,155 / 400,155)
const APP_X = 280, APP_Y = 310;
const APL_X = 800, APL_Y = 310;
const HALO_R = 118;

const HTML = /* html */`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent}
</style>
</head><body>
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
(function(){
const cv = document.getElementById('c');
const g  = cv.getContext('2d');
const W=${W}, H=${H};
const APP_X=${APP_X}, APP_Y=${APP_Y};
const APL_X=${APL_X}, APL_Y=${APL_Y};
const R=${HALO_R};

// ── Background ────────────────────────────────────────────────────────────
const bg = g.createLinearGradient(0, 0, W, H);
bg.addColorStop(0, '#19150f');
bg.addColorStop(1, '#0c0a07');
g.fillStyle = bg;
g.fillRect(0, 0, W, H);

// ── Subtle dot grid ───────────────────────────────────────────────────────
g.fillStyle = 'rgba(255,255,255,0.022)';
for (let x = 28; x < W; x += 38) {
  for (let y = 28; y < H; y += 38) {
    g.beginPath();
    g.arc(x, y, 1.5, 0, Math.PI*2);
    g.fill();
  }
}

// ── Brand line top-center ─────────────────────────────────────────────────
g.fillStyle = 'rgba(200,98,46,0.08)';
g.fillRect(W/2 - 200, 0, 400, 3);

// ── Halo helper ───────────────────────────────────────────────────────────
function halo(cx, cy) {
  // wide ambient glow
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R + 90);
  grd.addColorStop(0,   'rgba(200,98,46,0.11)');
  grd.addColorStop(0.55,'rgba(200,98,46,0.04)');
  grd.addColorStop(1,   'rgba(0,0,0,0)');
  g.beginPath(); g.arc(cx, cy, R+90, 0, Math.PI*2);
  g.fillStyle = grd; g.fill();

  // inner fill
  const inner = g.createRadialGradient(cx, cy-20, 0, cx, cy, R);
  inner.addColorStop(0,   'rgba(200,98,46,0.06)');
  inner.addColorStop(0.7, 'rgba(200,98,46,0.02)');
  inner.addColorStop(1,   'rgba(0,0,0,0)');
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI*2);
  g.fillStyle = inner; g.fill();

  // dashed border ring
  g.save();
  g.setLineDash([8, 8]);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI*2);
  g.strokeStyle = 'rgba(200,98,46,0.3)';
  g.lineWidth = 2;
  g.stroke();
  g.restore();
}

halo(APP_X, APP_Y);
halo(APL_X, APL_Y);

// ── Arrow ─────────────────────────────────────────────────────────────────
const AX1  = APP_X + R + 24;
const AX2  = APL_X - R - 24;
const AY   = APP_Y;
const AHEAD = 22;

// shaft
g.setLineDash([]);
g.strokeStyle = 'rgba(200,98,46,0.5)';
g.lineWidth   = 4;
g.lineCap     = 'round';
g.beginPath();
g.moveTo(AX1, AY);
g.lineTo(AX2 - AHEAD, AY);
g.stroke();

// arrowhead
g.fillStyle = 'rgba(200,98,46,0.6)';
g.beginPath();
g.moveTo(AX2,        AY);
g.lineTo(AX2-AHEAD,  AY - 14);
g.lineTo(AX2-AHEAD,  AY + 14);
g.closePath();
g.fill();

// ── Icon labels ───────────────────────────────────────────────────────────
g.font = '500 26px -apple-system,"SF Pro Text",Helvetica,sans-serif';
g.fillStyle    = 'rgba(255,255,255,0.32)';
g.textAlign    = 'center';
g.textBaseline = 'middle';
g.fillText('Etaros',     APP_X, APP_Y + R + 36);
g.fillText('Applications', APL_X, APL_Y + R + 36);

// ── Bottom hint ───────────────────────────────────────────────────────────
g.font = '300 22px -apple-system,Helvetica,sans-serif';
g.fillStyle = 'rgba(255,255,255,0.16)';
g.fillText('Drag Etaros to Applications to install', W/2, H - 44);

document.title = 'DONE';
})();
<\/script>
</body></html>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  console.log('⟳  Rendering DMG background…');
  const win = new BrowserWindow({
    width: W, height: H,
    show: false, frame: false, transparent: true,
    webPreferences: { contextIsolation: false },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise(r => setTimeout(r, 800));

  const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(path.join(BUILD, 'dmg-bg.png'), img.toPNG());
  console.log(`✓  build/dmg-bg.png  (${W}×${H})`);

  app.quit();
});
