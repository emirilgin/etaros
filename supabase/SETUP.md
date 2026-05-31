# Sidekick — Supabase Backend Setup

## 1. Create Supabase project
1. Go to https://supabase.com → New project
2. Region: Frankfurt (eu-central-1) — dichtst bij NL
3. Note your **Project URL** and **anon/service_role keys** (Settings → API)

## 2. Run database schema
1. Supabase dashboard → SQL Editor → New query
2. Paste contents of `schema.sql` → Run

## 3. Deploy Edge Functions
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Set secrets
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set RESEND_API_KEY=re_...   # optional, for emails

# Deploy functions
supabase functions deploy validate-key
supabase functions deploy stripe-webhook
```

## 4. Add Stripe webhook
1. Stripe dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
3. Events: `checkout.session.completed`
4. In your Stripe payment links → Metadata → add `tier: pro` or `tier: max`

## 5. Configure Electron app
In `app.config.js`:
```javascript
module.exports = {
  // ... existing keys
  serverUrl: 'https://<project-ref>.supabase.co',
};
```

## 6. Test
```bash
# Validate a key manually
curl -X POST https://<project-ref>.supabase.co/functions/v1/validate-key \
  -H "Content-Type: application/json" \
  -d '{"key":"SIDE-ABCD-1234","machineId":"test-machine"}'
```

## Manual key creation (admin)
In Supabase SQL Editor:
```sql
INSERT INTO license_keys (key, tier, email) VALUES
  ('SIDE-ABCD-1234', 'pro', 'user@example.com');

-- Or use the helper function:
SELECT generate_license_key('pro');   -- generates random key
SELECT generate_license_key('max');
```

## Revoke a key
```sql
UPDATE license_keys SET revoked = true WHERE key = 'SIDE-ABCD-1234';
```

## Free tier limits
- Supabase free: 500MB DB, 500k Edge Function invocations/month
- Resend free: 3,000 emails/month
- → **€0/month** for typical indie app usage
