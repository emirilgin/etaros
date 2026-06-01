# Changelog

All notable changes to Etaros are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] — 2026-06-01

A stability + honesty release. ~20 bugs fixed, ~840 lines of dead code removed,
and the docs now match what the app actually does.

### Added
- **Personal Gemini key** field in Settings → AI. The daily-quota error told users
  to "paste your own key," but no field actually saved it — now it does, with smart
  prefix routing (`AIza…` → Gemini, `sk-ant…` → Claude) so a key pasted in either
  box lands in the right place.
- **Offline detection** — a banner appears when you lose connection, the send box
  disables, and everything auto-recovers when you're back online.
- **Quota cooldown** — after the shared key hits its daily limit, auto-scans pause
  for 10 minutes instead of hammering the API every interval.
- App **version** shown in the sidebar.
- Password **confirmation** field on the register form (prevents typo lockout).
- Custom in-app confirm dialog (replaces the native browser prompt).
- `CHANGELOG.md`.

### Fixed
- **Tester/beta codes silently expired after 30 minutes** — the redeemed Max tier
  was overwritten by a server read (RLS blocks user-side tier writes). Now a sticky
  local override survives refreshes and is cleared on logout.
- **Auto-scan request storm** — a failed scan scheduled a retry *on top of* the scan
  interval; on quota errors this flooded the API. No more retries on quota/offline.
- **Session expiry** — access tokens are now refreshed via the refresh token before
  API calls instead of failing silently.
- **Free tier** now resets monthly (was a one-time counter that never reset).
- **Tray "Settings"** opened a stale duplicate window; now opens the in-app settings.
- **One "Save" button** in settings now saves profile *and* advanced settings together.
- Manual-scan errors show a friendly message instead of raw JSON.
- Legacy `setup.html` no longer double-onboards over the login overlay.
- Confirm dialog no longer flashed visible on launch (double `display` CSS bug).
- Avatars are compressed to 200×200 JPEG before storage (no more store bloat).
- LICENSE now carries the real holder and year (was a placeholder).

### Changed
- **Settings** flattened into one scrollable in-app page (no more nested windows).
- **AI provider** model handling consolidated to a single source of truth
  (`GEMINI_MODELS` fallback chain + `GEMINI_CHEAP_MODEL`); removed the deprecated
  `gemini-1.5-flash` reference.
- **README** rewritten to be accurate — honest privacy section (screen analysis uses
  Google Gemini by default; account + crash reporting disclosed), correct pricing
  ($0 / $9 / $19), real feature set.

### Removed
- ~840 lines of dead code for hidden features (notes, links, savings, diet, life)
  plus their IPC handlers and preload bridges.
- Legacy `settings.html` and `setup.html` (both unreachable after the redesign).

### Security
- Sentry DSN moved out of the public repo into gitignored `app.config.js`.

## [1.1.0] — 2026-05-31

- Links, plan cards, new logo. (First public DMG release.)
