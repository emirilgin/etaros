# Etaros — Master Plan
*Alles op één plek. Bijgewerkt elke sessie.*

---

## Wat is Etaros?

AI desktop-app (Mac + Windows) die je scherm in real-time bewaakt en je waarschuwt voor:
- 🛡️ Phishing, scams, fake logins
- 💸 Verborgen abonnementen, hidden fees
- 🛒 Betere deals, goedkopere alternatieven
- 🥗 Wellness scams
- 🎯 Afleidingen

**Naam:** Etaros (van oud-Grieks *hetairos* — companion van de koning, beschermer)
**KVK:** Sidekick AI
**Doel:** Geen indie hobby — een groot bedrijf bouwen. B2B + enterprise + funding + exit.

---

## STATUS NU

### ✅ Klaar
- App gebouwd (Electron, Supabase auth, Gemini/Claude AI)
- Rebrand naar Etaros (overal)
- Nieuw logo (oceaan blauw, cirkel + explosie)
- Landing page LIVE: emirilgin.github.io/etaros
- Waitlist (Tally form) embedded
- Repo public + hernoemd naar etaros
- Onboarding intro (vraagt naam)
- Memory question game (110 vragen)
- Security: server-authoritative tier check
- Password reset flow + deep-link
- CI/CD: GitHub Actions bouwt DMG/EXE automatisch
- ~20 bugs gefixt, ~840 regels dode code verwijderd

### 🔲 Te doen voor launch
1. **Stripe payment links** (Pro €9, Max €19) → in GitHub secrets
2. **Beta.6 testen** — login + AI werkt?
3. **Supabase email confirmation OFF** (signups werken zonder email)
4. **v1.2.0 officieel taggen** → release

### 🔲 Post-launch
- SMTP (Resend) — wacht op domein/email
- Apple Developer account (€99) → auto-update werkt
- Stripe webhook deployen → tier update na betaling
- React migratie (TypeScript, Tailwind, shadcn, Lucide)

---

## TECH STACK

| Laag | Tech | Status |
|---|---|---|
| Desktop | Electron | ✅ |
| Frontend | Vanilla JS → React (later) | ✅ / 🔲 |
| Auth + DB | Supabase | ✅ |
| AI | Gemini (gratis) + Claude (Max) + Ollama | ✅ |
| Payments | Stripe | 🔲 links |
| Errors | Sentry | ✅ |
| Landing | HTML op GitHub Pages | ✅ |
| CI/CD | GitHub Actions | ✅ |
| Email | Supabase default → Resend (later) | ✅ / 🔲 |

---

## PRIJZEN & MARGES

| Plan | Prijs | Kosten | Winst | Marge |
|---|---|---|---|---|
| Free | €0 | ~€0.20 | — | — |
| Pro | €9/mo | ~€0.57 | €8.43 | 94% |
| Max | €19/mo | ~€1.17 | €17.83 | 94% |

**Bij 100 Pro users:** €843/mo winst
**Bij 1000 Pro users:** €8.430/mo winst

---

## GELD / GRANTS

| Grant | Bedrag | Kans | Status |
|---|---|---|---|
| WBSO | €8-16k/jaar | 85% | wacht op eHerkenning |
| SIDN Fonds | €10k | 40% | aanvraag klaar, FundPro account |
| MIT subsidie | €20-40k | 50% | na WBSO |
| EIC Accelerator | tot €2.5M | 5% | maand 5-6 |

Details: `grants-plan.md` + `sidn-application.md`

---

## GROEI ROADMAP

Zie `financial-roadmap.md` — maand 1-36, van €0 tot mogelijk €48-90M.

**Kernmilestones:**
- 10 betalende users → proof
- €3-5k MRR → pre-seed fundable
- €20k MRR → VCs bellen jou
- B2B pivot (maand 3-4) → grote contracten

---

## HET GROTE BEDRIJF VERHAAL

Niet pitchen als "scam catcher app".
Pitchen als: **"Real-time AI compliance & fraud monitor voor elk scherm."**

**B2B markten (€500-5000/mo per seat):**
- Financiële adviseurs — compliance monitoring
- Klantenservice teams — policy breach detectie
- Call centers — real-time coaching
- Verzekeraars — fraude detectie
- Juridische firma's — risico flagging

Markt: €10B+. Dat is een groot-bedrijf verhaal, geen lifestyle business.

---

## DEZE WEEK

1. Stripe links aanmaken → mij geven
2. Beta.8 developen
3. v1.2.0 launchen
4. Reddit + Show HN posten (ik schrijf de posts)
5. Demo video opnemen (scam live gevangen)
6. Waitlist promoten

---

## ALLE DOCS IN DEZE FOLDER

- `MASTER-PLAN.md` ← dit bestand (overzicht)
- `financial-roadmap.md` — maand 1-36 + funding + exit
- `roadmap.md` — korte versie
- `grants-plan.md` — WBSO/SIDN/MIT/EIC + aanvraag tekst
- `sidn-application.md` — SIDN aanvraag + video script
- `beta-posts.md` — social posts
- `promotion-targets.md` — waar promoten

---

*Laatste update: juni 2026*
