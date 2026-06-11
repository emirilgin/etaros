# Etaros — Social Posts (copy-paste ready)

Two sets:
- **A. Maker channels** (Twitter/X, Bluesky, r/SideProject, Indie Hackers, Product Hunt) → lead with the *15-year-old building in public* hook.
- **B. Security/tech channels** (r/cybersecurity, Show HN, r/macapps) → lead with the *product*, age is not the headline.

Two phases:
- **Phase 1 — NOW (app not live yet):** build-in-public. Build audience + waitlist. No "download now".
- **Phase 2 — when demo + app work:** the real launch (use launch-posts.md too).

---

# SET A — MAKER CHANNELS (15-hook OK)

## Twitter/X + Bluesky — Phase 1

**A1 · Pinned intro**
> someone in my family almost got scammed out of €3000 by a fake bank site. looked 100% real. nobody caught it in time
>
> i'm 15 and i got kinda mad about it so i'm building an app that watches your screen and catches that stuff for you
>
> gonna build it in public. follow if you wanna see it go

**A2 · Screenshot day**
> spent today on this lol
>
> you paste a link or email, it tells you if it's safe or a scam and why. that's it. doesn't try to do 50 other things
>
> free, mac + windows, coming soon
> [attach: verdict / danger-alert screenshot]

**A3 · Behind the scenes (thread)**
> every "AI app" rn tries to do everything and does all of it mid
>
> mine does one thing: catch scams + phishing. here's the actual checklist i baked into it 🧵
>
> - is the domain fake? (paypa1 vs paypal)
> - where do the links actually go
> - is it rushing you ("act in 24h or else")
> - what's it asking for (password? card? crypto?)
> - then it just tells you straight up + what to do

**A4 · Waitlist push**
> getting close now
>
> if you want early access + a ping when it launches, dropped a waitlist here 👇
> [landing link]

## r/SideProject / Indie Hackers — Phase 1

**Title:** 15, building an AI that catches scams on your screen in real time

**Body:**
A family member almost lost €3000 to a fake bank site. Looked completely real, nobody caught it in time. That bugged me enough to start building the thing that would've caught it.

It's a desktop app that watches your screen and flags phishing pages, fake logins and scams as they show up, and tells you what's actually wrong + what to do. It only does security, on purpose. I didn't want another app that does everything badly.

Still pre-launch. Building it in the open. Would love feedback on the positioning and the landing page: [link]

Honest q: what would make you trust (or not trust) something like this?

---

# SET B — SECURITY / TECH CHANNELS (product-first, no age headline)

## r/macapps / r/cybersecurity — Phase 2 (when it works)

**Title:** I built a free AI that watches your screen and catches phishing & scams in real time

**Body:**
A while ago someone close to me almost lost €3000 to a fake bank website. It looked completely real and nobody warned them in time. So I built the warning.

Etaros watches your screen and catches phishing pages, fake logins and scams the moment they show up, then tells you what's wrong and what to do. When it's confident something is an active threat it throws a full-screen alert you can't miss.

What it catches:
- Typosquatted domains like paypa1.com, fake login pages, impersonation, crypto/romance scams
- Paste any link, email or message and it gives a verdict: safe, suspicious, or dangerous
- It only does security. I didn't want another chatbot that does everything badly.
- Free, Mac and Windows

Download: https://github.com/emirilgin/etaros/releases/latest
Site: [landing link]

Tear it apart, especially false positives. That's what I most want to hear about.

## Show HN — Phase 2

**Title:** Show HN: Etaros – AI that catches phishing and scams on your screen in real time

**URL:** [landing link]

**First comment:**
Etaros is an Electron app that captures your screen on an interval, runs it through a vision model (Gemini by default, Claude on the top tier), and detects active threats: phishing pages, fake logins, impersonation, financial scams. On a high-confidence detection it fires a blocking alert.

I kept it narrow on purpose, pure security, not a do-everything assistant. The system prompt makes it work like an actual analyst (check the domain, then the links, then the urgency, then what it's asking for) and return a safe/suspicious/dangerous verdict. Nothing is stored server-side, analysis is per-frame.

Happy to go deep on the detection prompt, how I handle false positives, and the privacy model.

---

# POSTING RULES
- Phase 1 posts now. Hold Phase 2 + launch-posts.md until demo + app are verified working.
- Maker channels: age = asset. Security channels: lead with product.
- Best windows: Tue–Thu, ~15:00–17:00 NL (US morning).
- Reddit: build comment karma first or new-account posts get auto-removed.
- Discord: be active in servers (promotion-targets.md) before dropping a link.
- Always attach a screenshot/GIF — posts with visuals get 3–5× engagement.
