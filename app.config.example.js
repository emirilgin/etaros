// ─── Etaros built-in API config ─────────────────────────────────────────────
// Copy this file to app.config.js and fill in your key.
// app.config.js is gitignored — it never gets committed to GitHub.
// electron-builder bundles it into the app so users never need to
// supply any API key — the AI just works when they download.
//
// Get a FREE Gemini key (no credit card) at:
//   https://aistudio.google.com  →  Get API key  →  Create API key
//
// Optional: add an Anthropic key to use Claude for Pro/Max users (better quality)
//   https://console.anthropic.com

module.exports = {
  // Required — get free at aistudio.google.com
  geminiKey: 'AIza_PASTE_YOUR_GEMINI_KEY_HERE',

  // Optional — Claude for paid tiers (better quality)
  // Leave blank to use Gemini for all tiers
  anthropicKey: '',

  // HMAC secret for license key validation — never commit the real value
  // Generate your own: node -e "require('crypto').randomBytes(32).toString('hex')"
  licenseSecret: 'YOUR_64_CHAR_HEX_SECRET_HERE',

  // Optional — your deployed server URL
  // serverUrl: 'https://your-app.railway.app',
};
