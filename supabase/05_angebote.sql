-- 05: Angebote der Läden. Befüllt von der Server-Funktion "angebote" (täglich per Zeitplan).
create table if not exists public.offers (
  id          bigint generated always as identity primary key,
  store       text not null,
  title       text not null,
  subtitle    text,
  price       numeric,
  old_price   numeric,
  discount    text,
  card_price  numeric,
  unit        text,
  base_price  text,
  image       text,
  url         text,
  valid_text  text,
  valid_to    date,
  kind        text not null default 'angebot',
  fetched_at  timestamptz not null default now()
);
create index if not exists offers_store_idx on public.offers (store);
alter table public.offers enable row level security;
drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers for select to authenticated using (true);

create table if not exists public.offer_runs (
  id      bigint generated always as identity primary key,
  ran_at  timestamptz not null default now(),
  report  jsonb
);
alter table public.offer_runs enable row level security;
drop policy if exists offer_runs_read on public.offer_runs;
create policy offer_runs_read on public.offer_runs for select to authenticated using (true);

-- Zeitplan: jeden Morgen 05:30 UTC (6:30 Uhr deutsche Winterzeit) Angebote holen
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('angebote-taeglich') where exists (select 1 from cron.job where jobname = 'angebote-taeglich');
select cron.schedule(
  'angebote-taeglich',
  '30 5 * * *',
  $$ select net.http_post(
       url := 'https://lcyllumkmsevocsviirv.supabase.co/functions/v1/angebote',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"mode":"refresh"}'::jsonb,
       timeout_milliseconds := 60000) $$
);
