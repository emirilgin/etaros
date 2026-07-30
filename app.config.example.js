// Copy to app.config.js and fill in. app.config.js is gitignored.
// NOTE: no model API key belongs in here. The app talks to the Etaros Worker,
// which holds the provider key server-side. Shipping a key inside the app is
// the same as publishing it: an .asar is an archive, not a safe.
module.exports = {
  // Cloudflare Worker (see _private/etaros-api-worker.js for the deploy steps)
  apiBase: 'https://your-worker.workers.dev',

  // Optional escape hatches for power users who bring their own key.
  geminiKey: '',
  anthropicKey: '',

  ownerMode: false,   // must be false in anything you ship

  sentryDsn: '',

  // Supabase: the anon key is meant to be public, RLS protects the data.
  supabaseUrl:     'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'PASTE_ANON_KEY',

  stripePlanLinks: { pro: '', max: '' },
};
