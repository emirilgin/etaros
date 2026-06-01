<div align="center">

<img src="build/icon.png" width="90" height="90" alt="Etaros" />

# Etaros
### Your second pair of eyes.

A desktop AI that watches your screen and flags scams, bad deals, phishing,
and subscription traps in real time — before they cost you.

<br/>

## [Download Latest Release](https://github.com/emirilgin/sidekick/releases/latest)

| Mac — Apple Silicon (M1/M2/M3/M4) | Mac — Intel (pre-2020) | Windows 10/11 |
|:---:|:---:|:---:|
| `Etaros-*-arm64.dmg` | `Etaros-*.dmg` | `Etaros.Setup.*.exe` |

[![Version](https://img.shields.io/github/v/release/emirilgin/sidekick?style=flat-square&color=cf6e3c&label=latest)](https://github.com/emirilgin/sidekick/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgray?style=flat-square)](https://github.com/emirilgin/sidekick/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-4db87a?style=flat-square)](LICENSE)

</div>

---

> **Mac install:** Open `.dmg` → drag to Applications → right-click → Open → "Open Anyway"
> **Windows:** Run `.exe` → if SmartScreen appears → "More info" → "Run anyway"
> **Not sure which Mac?** About This Mac → chip says M-series → `arm64.dmg` · Intel → `.dmg`

---

## What it does

Etaros quietly scans your screen on an interval and surfaces short, specific
insights when something matters. One AI, five things it looks for:

| | Looks for |
|---|---|
| 🛡️ **Security** | Phishing pages, fake logins, tech-support scams, credential risks |
| 💸 **Finance** | Hidden fees, subscription traps, the real cost of a recurring charge |
| 🛒 **Shopping** | Cheaper alternatives, better deals, price comparisons |
| 🥗 **Health** | Wellness scams, pseudoscience, overpriced supplements |
| 🎯 **Productivity** | Distractions and rabbit holes worth noticing |

Insights are concrete, never vague — *"This URL misspells PayPal as paypai.com,
a known phishing domain"*, not *"this could be a scam."* You can also chat with
it directly and drag in any image to analyze.

---

## Pricing

| | Free | Pro | Max |
|---|:---:|:---:|:---:|
| Screen scanning | ✓ | ✓ | ✓ |
| Chat messages | 5 / month | Unlimited | Unlimited |
| AI Compare (find alternatives) | — | ✓ | ✓ |
| AI model | Gemini | Gemini | Claude (best) |
| Price | $0 | $9/mo | $19/mo |

Upgrade from inside the app (**Settings → Plan**).

---

## Privacy — honest version

- **Screen analysis uses an AI model.** By default that's Google Gemini, so the
  screenshots being analyzed are sent to Google's API. If you want analysis to
  stay fully on your machine, switch to **Ollama** (local) in Settings → AI.
- **An account is required** (email + password, via Supabase) to sign in and
  track your plan.
- **Crash reporting** is on by default (Sentry) to catch bugs — diagnostics only.
- Your conversations, learned facts, and settings are stored **locally** in an
  encrypted, machine-locked store. Scanning can be paused any time from the tray.
- Bring your own key (Gemini or Claude) in Settings → AI to use your own quota.

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
npm run build:mac   # arm64 + Intel DMG
npm run build:win   # Windows NSIS installer
npm run gen-icon    # Regenerate app icon
```

`app.config.js` holds all secrets (API keys, Supabase, Stripe, license secret)
and is **gitignored** — never commit it. See [DEPLOY.md](DEPLOY.md) for the
Supabase + Stripe backend setup.

### Stack

- **Electron** — desktop shell (macOS + Windows)
- **Google Gemini** — default vision/chat model, with a model fallback chain
- **Ollama** — optional local model · **Claude** — optional, powers Max tier
- **Supabase** — accounts, auth, and plan/tier storage
- **Stripe** — Pro/Max checkout via payment links + webhook

---

<div align="center">

Made in the Netherlands · MIT License © 2026 Emir Ilgin

</div>
