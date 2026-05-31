<div align="center">

<img src="build/icon.png" width="90" height="90" alt="Sidekick" />

# Sidekick
### Your second pair of eyes.

Always watching. Catches scams, bad deals, and subscription traps
before they cost you — in real time.

<br/>

## [Download Latest Release](https://github.com/emirilgin/sidekick/releases/latest)

| Mac — Apple Silicon (M1/M2/M3/M4) | Mac — Intel (pre-2020) | Windows 10/11 |
|:---:|:---:|:---:|
| `Sidekick-*-arm64.dmg` | `Sidekick-*-x64.dmg` | `Sidekick Setup *.exe` |

[![Version](https://img.shields.io/github/v/release/emirilgin/sidekick?style=flat-square&color=cf6e3c&label=latest)](https://github.com/emirilgin/sidekick/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgray?style=flat-square)](https://github.com/emirilgin/sidekick/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-4db87a?style=flat-square)](LICENSE)

</div>

---

> **Mac install:** Open `.dmg` → drag to Applications → right-click → Open → "Open Anyway"  
> **Windows:** Run `.exe` → if SmartScreen appears → "More info" → "Run anyway"  
> **Not sure which Mac?** About This Mac → chip says M-series → `arm64.dmg` · Intel → `x64.dmg`

---

## What it does

Sidekick watches your screen in real time and flags what matters:

- **Security** — phishing domains, fake logins, dark patterns, credential risks
- **Finance** — hidden fees, subscription traps, overcharging, price history
- **Shopping** — cheaper alternatives, coupon codes, cashback opportunities
- **Health** — wellness scams, food choices, misinformation
- **Focus** — distractions and rabbit holes during work

**100% private.** Screenshots never leave your device. No account required to start.

---

## Pricing

| | Free | Pro | Max |
|---|:---:|:---:|:---:|
| Real-time screen analysis | ✓ | ✓ | ✓ |
| Messages | 5 total | Unlimited | Unlimited |
| AI model | Gemini | Gemini | Claude Sonnet |
| Price | $0 | $9/mo | $39/mo |

[Get Pro](https://buy.stripe.com/fZu5kEgrI7766ct9cE14405) · [Get Max](https://buy.stripe.com/eVqaEY1wOajicAR88A14402)

---

## Dev setup

```bash
git clone https://github.com/emirilgin/sidekick.git
cd sidekick
npm install
cp app.config.example.js app.config.js
# Edit app.config.js — add your Gemini key from aistudio.google.com
npm start
```

```bash
npm run build:mac   # arm64 + x64 DMG
npm run build:win   # Windows NSIS installer
npm run gen-icon    # Regenerate app icon from scripts/gen-icon.js
```

See [DEPLOY.md](DEPLOY.md) for server + Stripe setup.

---

## Privacy

- All analysis runs on-device or via your own API key
- No analytics, no accounts required
- Crash reporting via Sentry (errors only, no usage data)
- Local data stored in encrypted machine-locked store
- Scanning can be paused any time in Settings

---

<div align="center">

Made in the Netherlands · MIT License

</div>
