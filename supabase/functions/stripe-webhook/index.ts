/**
 * Sidekick — stripe-webhook Edge Function
 *
 * Flow:
 * 1. User clicks "Upgrade" in app → opens Stripe link with ?client_reference_id=USER_SUPABASE_ID
 * 2. User pays → Stripe fires checkout.session.completed
 * 3. This function reads client_reference_id → updates user's tier in profiles table
 *
 * Deploy: supabase functions deploy stripe-webhook
 * Stripe dashboard → Webhooks → add: https://<project>.supabase.co/functions/v1/stripe-webhook
 * Events: checkout.session.completed
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

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret!);
  } catch (e) {
    console.error('[stripe-webhook] bad signature:', e.message);
    return new Response('Unauthorized', { status: 401 });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('ok');
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // client_reference_id = Supabase user ID (set in payment link URL by the app)
  const userId = session.client_reference_id;
  const tier   = (session.metadata?.tier as string) ?? 'pro';
  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;

  if (!userId) {
    console.error('[stripe-webhook] no client_reference_id on session', session.id);
    return new Response('missing user id', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error } = await supabase
    .from('profiles')
    .update({
      tier,
      stripe_customer_id: stripeCustomerId,
    })
    .eq('id', userId);

  if (error) {
    console.error('[stripe-webhook] DB update failed:', error);
    return new Response('DB error', { status: 500 });
  }

  console.log(`[stripe-webhook] user ${userId} upgraded to ${tier}`);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
