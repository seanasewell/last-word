// apple-auth: keeps Sign in with Apple tidy for account deletion (App Store rule 5.1.1(v)).
//   POST { action: "store", code }  → swaps Apple's one-time authorization code for a
//                                      refresh token and keeps it for this player.
//   POST { action: "revoke" }        → revokes that token with Apple and forgets it.
// Needs these secrets (Edge Functions → Secrets). Until they're set it does nothing:
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 file's contents), APPLE_CLIENT_ID (bundle ID).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'npm:jose@5';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TEAM = Deno.env.get('APPLE_TEAM_ID') ?? '';
const KEY_ID = Deno.env.get('APPLE_KEY_ID') ?? '';
const PRIVATE_KEY = (Deno.env.get('APPLE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');
const CLIENT_ID = Deno.env.get('APPLE_CLIENT_ID') ?? 'com.studiosewell.lastword';
const configured = !!(TEAM && KEY_ID && PRIVATE_KEY);

/** Apple's "client secret": a short-lived ES256 JWT signed with the Sign in with Apple key. */
async function clientSecret(): Promise<string> {
  const key = await importPKCS8(PRIVATE_KEY, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
    .setIssuer(TEAM)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setAudience('https://appleid.apple.com')
    .setSubject(CLIENT_ID)
    .sign(key);
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Who is asking (the platform has already checked the JWT; this gets the user id).
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(jwt);
  const user = who?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body: { action?: string; code?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!configured) return json({ ok: false, reason: 'not-configured' });

  try {
    if (body.action === 'store') {
      if (!body.code) return json({ error: 'code' }, 400);
      const res = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: CLIENT_ID, client_secret: await clientSecret(), code: body.code, grant_type: 'authorization_code' }),
      });
      const tok = await res.json().catch(() => ({}));
      if (!res.ok || !tok.refresh_token) return json({ ok: false, reason: 'exchange-failed', status: res.status });
      const { error } = await admin.from('apple_tokens').upsert({ user_id: user.id, refresh_token: tok.refresh_token, updated_at: new Date().toISOString() });
      return json({ ok: !error });
    }

    if (body.action === 'revoke') {
      const { data: row } = await admin.from('apple_tokens').select('refresh_token').eq('user_id', user.id).maybeSingle();
      if (!row) return json({ ok: true, revoked: false });
      const res = await fetch('https://appleid.apple.com/auth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: CLIENT_ID, client_secret: await clientSecret(), token: row.refresh_token, token_type_hint: 'refresh_token' }),
      });
      await admin.from('apple_tokens').delete().eq('user_id', user.id);
      return json({ ok: res.ok, revoked: res.ok });
    }
  } catch (e) {
    return json({ ok: false, reason: 'error', message: String(e).slice(0, 200) });
  }
  return json({ error: 'action' }, 400);
});
