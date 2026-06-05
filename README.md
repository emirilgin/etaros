<div align="center">

<img src="build/icon.png" width="90" height="90" alt="Etaros" />

# Etaros
### Your second pair of eyes.

A desktop AI that watches your screen and flags scams, bad deals, phishing,
and subscription traps in real time — before they cost you.

<br/>

# [⬇️  Download Etaros — Free](https://github.com/emirilgin/etaros/releases/latest)

### [🌐 etaros website &amp; install guide](https://emirilgin.github.io/etaros)

| Mac — Apple Silicon (M1/M2/M3/M4) | Mac — Intel | Windows 10/11 |
|:---:|:---:|:---:|
| [`Etaros-arm64.dmg`](https://github.com/emirilgin/etaros/releases/latest) | [`Etaros.dmg`](https://github.com/emirilgin/etaros/releases/latest) | [`Etaros.Setup.exe`](https://github.com/emirilgin/etaros/releases/latest) |

[![Version](https://img.shields.io/github/v/release/emirilgin/etaros?style=flat-square&color=3a8ab4&label=latest)](https://github.com/emirilgin/etaros/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgray?style=flat-square)](https://github.com/emirilgin/etaros/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-4db87a?style=flat-square)](LICENSE)

</div>

---

> **Mac install:** Open `.dmg` → drag to Applications → try to open → then **System Settings → Privacy & Security → "Open Anyway"** → confirm with Touch ID
> **Windows:** Run `.exe` → if SmartScreen appears → "More info" → "Run anyway"
> **Not sure which Mac?** About This Mac → chip says M-series → `arm64.dmg` · Intel → `.dmg`
> Full visual guide: [emirilgin.github.io/etaros](https://emirilgin.github.io/etaros)

---

## What it does

Etaros is a focused **cybersecurity AI**. It watches your screen and catches
online threats the moment they appear — then tells you exactly what's wrong and
what to do.

| | It catches |
|---|---|
| 🎣 **Phishing** | Fake logins, lookalike domains (`paypa1.com`), homograph tricks |
| 🪪 **Impersonation** | Fake bank, government (Belastingdienst/DigiD), delivery (PostNL/DHL) |
| 💸 **Fraud** | Investment/crypto scams, romance scams, fake invoices, gift-card fraud |
| 🔐 **Account risk** | Passwords on unsafe pages, malware downloads, risky permissions |

Verdicts are concrete, never vague — *"The sender domain is `paypa1-support.com`
— that's a digit 1, not the letter l. This is phishing."*

---

## How to use it

**1. Just browse.** Etaros runs in the background and taps you on the shoulder —
with a full-screen alert — the moment it spots an active threat.

**2. Quick check — anywhere (⌘⇧E).** Press the hotkey to open the Spotlight-style
panel from any app:
- **📸 Screenshot & analyze** — drag to select part of your screen → instant verdict
- Type a question (*"is this email phishing?"*) — it sees your screen and answers
- Get a clear verdict: ✅ Safe · ⚠️ Suspicious · 🚨 Dangerous

**3. Chat.** Open the app to ask anything security-related: *"I got hacked, what
now?"*, *"is this link safe?"*, *"how do I set up 2FA?"* — and drag in any
screenshot to have it analysed.

**4. Region capture.** Grab a precise area of your screen and have Etaros analyse
only that.

> 🔓 **Beta / tester code:** enter `SIDEKICK-BETA-2026` in Settings → for free Max access.

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
git clone https://github.com/emirilgin/etaros.git
cd etaros
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
