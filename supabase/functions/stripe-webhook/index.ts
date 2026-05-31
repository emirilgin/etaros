/**
 * Sidekick — stripe-webhook Edge Function
 * Handles: checkout.session.completed → create license key → optionally email user
 *
 * Stripe webhook secret: set STRIPE_WEBHOOK_SECRET in Supabase secrets
 * Deploy: supabase functions deploy stripe-webhook
 *
 * In Stripe dashboard → Webhooks → add endpoint:
 *   https://<project>.supabase.co/functions/v1/stripe-webhook
 *   Events: checkout.session.completed
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-04-10',
  httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req: Request) => {
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const body = await req.text();

  // Verify Stripe signature
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret!);
  } catch (e) {
    console.error('[stripe-webhook] signature failed:', e.message);
    return new Response('Unauthorized', { status: 401 });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('ok', { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Determine tier from metadata or price ID
  // Set metadata in your Stripe payment link: tier = 'pro' or 'max'
  const tier = (session.metadata?.tier as string) ?? 'pro';
  const email = session.customer_details?.email ?? session.metadata?.email ?? null;
  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;
  const stripePaymentId = session.payment_intent as string ?? session.id;

  // Generate unique license key
  const key = generateKey(tier);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error } = await supabase.from('license_keys').insert({
    key,
    tier,
    email,
    stripe_payment_id:   stripePaymentId,
    stripe_customer_id:  stripeCustomerId,
    max_machines: 2,
  });

  if (error) {
    console.error('[stripe-webhook] DB insert failed:', error);
    return new Response('DB error', { status: 500 });
  }

  console.log(`[stripe-webhook] Created ${tier} key ${key} for ${email}`);

  // Optional: send email with license key
  // If you use Resend (resend.com — 3000 emails/month free):
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (resendApiKey && email) {
    await sendLicenseEmail({ apiKey: resendApiKey, email, key, tier });
  }

  return new Response(JSON.stringify({ ok: true, key }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ─── Key generator ────────────────────────────────────────────────────────────

function randomHex(len: number): string {
  const chars = '0123456789ABCDEF';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

function generateKey(tier: string): string {
  const prefix = tier === 'max' ? 'SMAX' : tier === 'tester' ? 'STEST' : 'SIDE';
  return `${prefix}-${randomHex(4)}-${randomHex(4)}`;
}

// ─── Email via Resend ─────────────────────────────────────────────────────────

async function sendLicenseEmail({
  apiKey, email, key, tier,
}: { apiKey: string; email: string; key: string; tier: string }) {
  const tierLabel = tier === 'max' ? 'Max' : 'Pro';

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Sidekick <noreply@yourdomain.com>', // ← change to your domain
      to: email,
      subject: `Your Sidekick ${tierLabel} license key`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="margin:0 0 8px">Thanks for getting Sidekick ${tierLabel}! 🎉</h2>
          <p style="color:#666;margin:0 0 24px">Here's your license key:</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:16px 20px;font-family:monospace;font-size:18px;letter-spacing:2px;text-align:center">
            ${key}
          </div>
          <p style="color:#666;margin:24px 0 8px;font-size:14px">
            Open Sidekick → click your name → Advanced → paste the key under <strong>License Key</strong>.
          </p>
          <p style="color:#999;font-size:12px;margin-top:32px">
            This key activates on up to 2 devices. Keep it safe!
          </p>
        </div>
      `,
    }),
  });
}
