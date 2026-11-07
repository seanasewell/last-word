// report-alerts: emails new player reports so they get a timely review.
// Called every 5 minutes by pg_cron (job "last-word-report-alerts"). It takes no
// input: it only looks for reports not yet alerted, emails them in one message,
// and stamps them, so calling it by hand is harmless.
// Needs the RESEND_API_KEY secret (resend.com). Until it's set, reports simply
// wait and are all sent in the first email after the key is added.
// Optional: ALERT_TO (default sean@studiosewell.com), ALERT_FROM (default Resend's test sender).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const REASON: Record<string, string> = { name: 'Offensive name', photo: 'Offensive photo', cheating: 'Cheating', other: 'Other' };

Deno.serve(async () => {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ ok: false, reason: 'not-configured' });
  const to = Deno.env.get('ALERT_TO') ?? 'sean@studiosewell.com';
  const from = Deno.env.get('ALERT_FROM') ?? 'Last Word <onboarding@resend.dev>';

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''), { auth: { persistSession: false } });
  const { data: reports, error } = await admin.from('reports')
    .select('id, reported, reason, details, reported_name, reported_photo, created_at, reported_deleted_at')
    .is('alerted_at', null).order('created_at').limit(50);
  if (error) return json({ ok: false, reason: 'query' }, 500);
  if (!reports?.length) return json({ ok: true, sent: 0 });

  const rows = reports.map((r) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd">${esc(new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' }))}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd"><b>${esc(REASON[r.reason] ?? r.reason)}</b>${r.details ? `<br>${esc(r.details)}` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${esc(r.reported_name || '(no name)')}${r.reported_deleted_at ? ' (deleted)' : ''}<br><span style="color:#888;font-size:12px">${esc(r.reported)}</span>${r.reported_photo ? `<br><a href="${esc(r.reported_photo)}">Photo</a>` : ''}</td>
    </tr>`).join('');
  const html = `<p>${reports.length} new ${reports.length === 1 ? 'report' : 'reports'} in Last Word.</p>
    <table style="border-collapse:collapse;font:14px system-ui,sans-serif">
      <tr><th align="left" style="padding:8px">When</th><th align="left" style="padding:8px">Reason</th><th align="left" style="padding:8px">Reported player</th></tr>${rows}
    </table>
    <p style="color:#666">Review them in Supabase → Table Editor → reports. To remove a name or photo, edit that player's row in profiles.</p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `Last Word: ${reports.length} new ${reports.length === 1 ? 'report' : 'reports'}`, html }),
  });
  if (!res.ok) return json({ ok: false, reason: 'email', status: res.status });

  await admin.from('reports').update({ alerted_at: new Date().toISOString() }).in('id', reports.map((r) => r.id));
  return json({ ok: true, sent: reports.length });
});
