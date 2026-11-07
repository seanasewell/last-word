-- Apple sign-in: refresh tokens kept server-side so deleting an account can revoke it with Apple.
-- Only the apple-auth edge function (service role) reads or writes this table.
create table if not exists public.apple_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.apple_tokens enable row level security;
revoke all on public.apple_tokens from anon, authenticated;

-- Report alerts: the report-alerts edge function emails new reports and stamps them.
alter table public.reports add column if not exists alerted_at timestamptz;
create index if not exists reports_unalerted_idx on public.reports (created_at) where alerted_at is null;

create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'last-word-report-alerts';
select cron.schedule('last-word-report-alerts', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://xgvkrlzpdghrqjrfgjin.supabase.co/functions/v1/report-alerts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
