<div align="center">

<img src="build/icon.png" width="90" height="90" alt="Sidekick" />

# ✦ Sidekick
### Your digital bodyguard.

Sidekick watches your screen silently and catches scams, subscription traps,
and bad deals — before they cost you money.

<br/>

## ⬇️ [Download Latest Release](https://github.com/emirilgin/sidekick/releases/latest)

| 🍎 Mac — Apple Silicon (M1/M2/M3/M4) | 🍎 Mac — Intel (pre-2020) | 🪟 Windows 10/11 |
|:---:|:---:|:---:|
| `Sidekick-*-arm64.dmg` | `Sidekick-*-x64.dmg` | `Sidekick-*-Setup.exe` |

[![Version](https://img.shields.io/github/v/release/emirilgin/sidekick?style=flat-square&color=8b7fd4&label=latest)](https://github.com/emirilgin/sidekick/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgray?style=flat-square)](https://github.com/emirilgin/sidekick/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-5ab47a?style=flat-square)](LICENSE)

</div>

---

> **Not sure which Mac?** 🍎 → About This Mac → chip says M1/M2/M3/M4 → `arm64.dmg` · Says Intel → `x64.dmg`

**Mac install:** Open `.dmg` → drag to Applications → right-click → Open → "Open Anyway"
**Windows install:** Run `.exe` → if SmartScreen appears → "More info" → "Run anyway"

---

## What it does

Sidekick docks to the side of your screen. Every 30 seconds it silently scans what's visible and alerts you when something's wrong.

```
👻 Ghost  — Phishing, fake logins, dark patterns, trackers          [Free]
🔐 Vault  — Hidden fees, subscription traps, price manipulation     [Pro]
🌿 Bloom  — Health misinformation, wellness scams, bad food choices [Pro]
⚡ Flow   — Distractions, rabbit holes, focus killers               [Pro]
🦅 Hawk   — Better prices, coupon codes, cashback opportunities     [Pro]
```

**100% private.** Screenshots never leave your device. No account required.

---

## Pricing

| | Free | Pro | Max |
|---|:---:|:---:|:---:|
| Ghost mode | ✓ | ✓ | ✓ |
| All 5 modes | — | ✓ | ✓ |
| Scans/day | 15 | Unlimited | Unlimited |
| AI model | Gemini | Gemini | Claude Sonnet |
| Price | €0 | €9/mo | €39/mo |

[Get Pro →](https://buy.stripe.com/fZu5kEgrI7766ct9cE14405) · [Get Max →](https://buy.stripe.com/eVqaEY1wOajicAR88A14402)

---

## Dev setup

```bash
git clone https://github.com/emirilgin/sidekick.git
cd sidekick
npm install
cp app.config.example.js app.config.js
# Add your Gemini key → aistudio.google.com (free)
npm start
```

```bash
npm run build:mac   # arm64 + x64 DMG
npm run build:win   # Windows NSIS installer
```

---

## Privacy

- All analysis runs on-device or via your own API key
- No telemetry, no analytics, no accounts
- Local data stored in encrypted machine-locked store
- Scanning can be paused any time from tray

---

<div align="center">

Made in the Netherlands 🇳🇱 · MIT License

</div>
