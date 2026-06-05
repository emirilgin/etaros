# Etaros — Launch Posts (copy-paste ready)
*Fire the day v1.2.1 is live + tested. Tue–Thu, ~15:00–17:00 NL (morning US).*
*Positioning: a real-time AI security guard that catches scams & phishing on your screen.*

---

## 1. Reddit — r/macapps

**Title:**
I'm 15 and I built a free AI that watches your screen and catches scams in real time

**Body:**
A while ago someone in my family almost lost €3,000 to a fake bank website. It looked completely real. Nobody warned them in time.

So I built the warning.

Etaros is a desktop app that quietly watches your screen and catches phishing pages, fake logins, and scams the moment they appear — then tells you exactly what's wrong and what to do. When it spots a real threat it throws up a full alert so you can't miss it.

- Catches typosquatted domains (paypa1.com), fake login pages, impersonation, crypto/romance scams
- Paste any link, email or message and it gives you a verdict: ✅ safe / ⚠️ suspicious / 🚨 dangerous
- 100% focused on security — it's not a chatbot that does everything badly, it does one thing extremely well
- Free. Mac + Windows.

Download: https://github.com/emirilgin/etaros/releases/latest
Site: https://emirilgin.github.io/etaros

Brutal feedback welcome — especially on false positives.

---

## 2. Show HN (news.ycombinator.com/submit)

**Title:** Show HN: Etaros – AI that catches phishing and scams on your screen in real time

**URL:** https://emirilgin.github.io/etaros

**First comment:**
I'm a 15-year-old dev from the Netherlands. Etaros is an Electron app that screenshots your screen on an interval, runs it through a vision model (Gemini default, Claude on the top tier), and detects active threats — phishing pages, fake logins, impersonation, financial scams. On a high-confidence detection it fires a blocking danger alert.

It's deliberately narrow: pure cybersecurity, not a do-everything assistant. The system prompt enforces a real analyst workflow (check domain → links → urgency → the ask → payment method) and a SAFE/SUSPICIOUS/DANGEROUS verdict.

Screenshots are analysed then discarded (not stored). Region capture uses a freeze-frame so the overlay is never in the shot and the crop is instant. Tier/auth is server-authoritative (Supabase).

Honest feedback welcome — especially false-positive rate and the privacy model (default path does send the analysed frame to the model provider; local-only via Ollama is an option).

---

## 3. Twitter / X (thread)

**1/** Someone in my family almost lost €3,000 to a fake bank site. It looked perfectly real. Nobody warned them in time.

I'm 15. So I built the warning. 🧵

**2/** Etaros watches your screen and catches scams the second they appear:

🎣 phishing & fake logins
🪪 impersonation (bank, PostNL, gov)
💸 crypto / investment fraud
🚨 and throws up an alert you can't miss

**3/** Paste any link, email or message → instant verdict:
✅ safe · ⚠️ suspicious · 🚨 dangerous
+ exactly why, and what to do.

It does ONE thing — security — better than the all-in-one assistants do anything.

**4/** Free. Mac + Windows. Built solo, from the Netherlands.

https://emirilgin.github.io/etaros

Try it, then tell me what it catches 👀

---

## 4. TikTok / Reels / Shorts (script, 30-40s)

**Hook (0-3s):** "This website almost stole €3,000 from my family."
**(3-10s):** Screen-record opening a realistic fake bank/PayPal login.
**(10-22s):** Etaros fires a red alert: "🚨 DANGEROUS — paypa1.com is a fake. Don't enter your password."
**(22-32s):** "It watches your screen and catches this in real time. I'm 15 and I built it. Free."
**(32-40s):** Logo + "Link in bio."

**Caption:** I built an AI bodyguard for your screen 👀🚨 catches scams before they cost you · built by a 15 y/o · link in bio #scam #phishing #cybersecurity #ai #buildinpublic

---

## 5. Other places
- r/SideProject, r/artificial — same story, builder angle
- r/cybersecurity, r/Scams — lead with threat detection (strict mods, be genuine, no hard sell)
- Indie Hackers — build-in-public post
- Newsletters: TLDR (tldr.tech/submit), Ben's Bites
- Product Hunt — DON'T rush. Prep 2 weeks, line up upvotes, launch a Tuesday.

---

## RULES
1. Post the SAME day v1.2.1 is live (not before).
2. Reply to EVERY comment in the first 2 hours — drives ranking hard.
3. Lead with the STORY (the €3,000 near-miss), never a feature list.
4. One visual of a real catch (GIF/video) beats 10 paragraphs.
5. Get 3-5 friends to upvote in the first 30 min.
6. Never oversell. Invite criticism — it reads as honest and converts better.

---

*Last updated: June 2026*
