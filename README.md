<p align="center">
  <img src="build/icon.png" width="100" height="100" alt="Sidekick" />
</p>

<h1 align="center">Sidekick</h1>

<p align="center">
  <strong>AI that watches your screen and speaks up.</strong><br/>
  Real-time insights for shopping, food, finance, and everything on your screen.
</p>

<p align="center">
  <a href="https://github.com/emirilgin/sidekick/releases/latest">
    <img src="https://img.shields.io/badge/Download-macOS-black?style=for-the-badge&logo=apple" />
  </a>
  &nbsp;
  <a href="https://github.com/emirilgin/sidekick/releases/latest">
    <img src="https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge&logo=windows" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/AI-Gemini%202.5%20Flash-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgray?style=flat-square" />
  <img src="https://img.shields.io/github/v/release/emirilgin/sidekick?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
</p>

---

## What it does

Sidekick docks to the side of your screen and watches what you're doing. When it spots something worth acting on, it tells you — instantly.

| | |
|---|---|
| 🛍 **Shopping** | Spots overpriced items, opens price comparison tabs on Amazon, eBay, Google Shopping, CamelCamelCamel simultaneously |
| 🍜 **Food** | Recommends what to order, healthier options, local restaurants near you |
| 💳 **Finance** | Flags unusual charges, finds better rates, catches surprise subscriptions |
| ⚠️ **Security** | Detects scam pages, fake payment forms, phishing attempts in real time |
| 💬 **Chat** | Full-screen conversation mode — ask about anything on screen |

No setup. No API key. Download, open, done.

---

## Download

Go to **[Releases](https://github.com/emirilgin/sidekick/releases/latest)** and pick your file:

| # | Platform | File |
|---|----------|------|
| 1 | 🍎 **Mac — Apple Silicon** (M1 / M2 / M3 / M4) | `Sidekick-x.x.x-arm64.dmg` |
| 2 | 🍎 **Mac — Intel** (pre-2020, Core i5/i7/i9) | `Sidekick-x.x.x-x64.dmg` |
| 3 | 🪟 **Windows** 10 / 11 | `Sidekick-x.x.x-Setup.exe` |

> **Not sure which Mac?** Click  → About This Mac. Chip = M1/M2/M3/M4 → use `arm64.dmg`. Processor = Intel → use `x64.dmg`.

**macOS install:** Open DMG → drag to Applications → right-click → Open on first launch.  
**Windows install:** Run the `.exe` → More info → Run anyway if SmartScreen appears.

---

## Pricing

| | Free | Pro | Max |
|---|:---:|:---:|:---:|
| Messages | 5 lifetime | 50 / day | Unlimited |
| Screen scanning | ✓ | ✓ | ✓ |
| Shopping comparison | ✓ | ✓ | ✓ |
| Notifications | ✓ | ✓ | ✓ |
| Price | Free | $9 / mo | $19 / mo |

Activate with a license key in Settings → Your Plan.

---

## Tech stack

- **[Electron](https://electronjs.org)** — cross-platform desktop
- **[Google Gemini 2.5 Flash](https://deepmind.google/gemini)** — built-in AI, works on download
- **[Anthropic Claude](https://anthropic.com)** — optional, Pro/Max tier
- **[electron-store](https://github.com/sindresorhus/electron-store)** — local state, no server
- **[electron-builder](https://www.electron.build)** — packaging + releases

---

## Development

```bash
git clone https://github.com/emirilgin/sidekick
cd sidekick
npm install
cp app.config.example.js app.config.js
# Paste your Gemini key into app.config.js
# Get a free key at aistudio.google.com
npm start
```

### Building

```bash
npm run gen-icon   # generate app icon
npm run build:mac  # → dist/*.dmg (arm64 + x64)
npm run build:win  # → dist/*.exe (Windows runner only)
```

### Releasing

```bash
# Bump version in package.json, then:
git tag v1.0.1
git push origin v1.0.1
# GitHub Actions builds all 3 files and publishes the release automatically
```

---

## Privacy

Screen frames are sent only to Google Gemini during analysis. Nothing is stored, logged, or shared. Scanning can be paused or turned off in Settings at any time.

---

## License

MIT
