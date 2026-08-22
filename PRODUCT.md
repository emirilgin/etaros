# Etaros — product truth

Derived from `.agents/product-marketing.md` (v4) and the shipped code, not a fresh interview.

## What it is
A macOS and Windows desktop app that reads the user's screen with AI and names threats as they
appear: phishing pages, impersonated banks and government services, hidden subscription traps.
It says what is wrong and what to do, then discards the screenshot.

## Unique mechanism
It reasons about the rendered screen instead of matching files or blocklists, so a domain
registered this morning is caught this morning. Antivirus scans files; a phishing page is valid
HTML. Blocklists are structurally late.

## The user's real scene
One person, alone, at their desk or at 11pm on the sofa, looking at something that feels
slightly wrong and wanting a straight answer without becoming technical. Secondary: staff at a
small firm handling client money, where one click is an existential event.

Ambient light: a normal room, often evening. The app sits open beside real work for hours and
must never demand attention while nothing is wrong.

## Primary tasks (Operate)
1. Ask about something on screen and get a verdict with a reason.
2. Be told, unprompted, when something dangerous appears.
3. Confirm at a glance where analysis runs and that nothing is kept.

## Brand commitments (binding on design)
- **Quiet by default.** Silence on a safe screen is a feature. False alarms destroy trust faster
  than misses.
- **No theatre.** No skull icons, no fake terminal spam, no INTRUSION DETECTED. The threat is
  real; dressing it as a movie makes it look fake.
- **Never condescending.** People who get scammed were targeted by professionals.
- **Verifiable, not reassuring.** Where analysis runs and what is retained are stated in the
  interface, not in a policy page.

## Pinned direction (user, 2026-08-17)
The canon, played straight: an Apple-native desktop application, with Claude's calm. The craft
bar is macOS system apps and Claude's interface. Executed at full fidelity, no irony.

## Constraints
- Electron 33, vanilla JS, one 2298-line `index.html`. No framework, no build step.
- Custom 44px titlebar, 252px sidebar, frameless window.
- Existing token set is the incumbent palette: near-black grounds, `#4CC2FF` accent,
  semantic green/amber/red reserved for verdict states.
- Light theme exists (`[data-theme="light"]`) and must keep working.
