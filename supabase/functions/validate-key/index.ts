/**
 * Sidekick — validate-key Edge Function
 * POST { key: string, machineId: string }
 * Returns { ok: boolean, tier?: string, email?: string, error?: string }
 *
 * Deploy: supabase functions deploy validate-key
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { key, machineId } = await req.json();

    if (!key || typeof key !== 'string') {
      return json({ ok: false, error: 'missing_key' }, 400);
    }

    const normalizedKey = key.trim().toUpperCase();

    // Validate key format
    const validFormat =
      /^SMAX-[A-F0-9]{4}-[A-F0-9]{4}$/.test(normalizedKey)  ||
      /^SIDE-[A-F0-9]{4}-[A-F0-9]{4}$/.test(normalizedKey)  ||
      /^STEST-[A-F0-9]{4}-[A-F0-9]{4}$/.test(normalizedKey);

    if (!validFormat) {
      return json({ ok: false, error: 'invalid_format' }, 400);
    }

    // Connect to DB using service role (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: row, error } = await supabase
      .from('license_keys')
      .select('*')
      .eq('key', normalizedKey)
      .single();

    if (error || !row) {
      return json({ ok: false, error: 'not_found' });
    }

    if (row.revoked) {
      return json({ ok: false, error: 'revoked' });
    }

    // Machine tracking — register this machine if not already registered
    if (machineId && typeof machineId === 'string') {
      const machines: string[] = row.machines ?? [];

      if (!machines.includes(machineId)) {
        if (machines.length >= row.max_machines) {
          return json({ ok: false, error: 'machine_limit', limit: row.max_machines });
        }

        // Add machine
        await supabase
          .from('license_keys')
          .update({ machines: [...machines, machineId] })
          .eq('id', row.id);
      }
    }

    return json({
      ok: true,
      tier:  row.tier,
      email: row.email ?? null,
    });

  } catch (e) {
    console.error('[validate-key] error:', e);
    return json({ ok: false, error: 'server_error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
