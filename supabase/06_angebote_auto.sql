-- 06: dm-Preischeck für eigene Artikel + Prospekte per Gratis-KI (Funktion "angebote-auto")

-- Herkunft eines Angebots: web (Angebotsseite), pdf (Prospekt per KI), preischeck (dm-Artikelsuche)
alter table public.offers add column if not exists source text not null default 'web';
alter table public.offers add column if not exists article_id bigint;

-- Prospekte, die seitenweise von der KI gelesen werden
create table if not exists public.offer_pdf_jobs (
  id          bigint generated always as identity primary key,
  store       text not null,
  source_key  text not null unique,      -- z. B. PDF-Adresse; jeder Prospekt nur einmal
  title       text,
  url         text,
  valid_from  date,
  valid_to    date,
  pdf_url     text,
  pages       jsonb not null default '[]', -- Text je Seite
  next_page   int not null default 0,
  found       int not null default 0,
  status      text not null default 'open', -- open | done | error
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.offer_pdf_jobs enable row level security;
drop policy if exists offer_pdf_jobs_read on public.offer_pdf_jobs;
create policy offer_pdf_jobs_read on public.offer_pdf_jobs for select to authenticated using (true);
grant select, insert, update, delete on public.offer_pdf_jobs to service_role;
grant select on public.offer_pdf_jobs to authenticated;

-- Zeitpläne: dm-Preischeck täglich 05:45 UTC, Prospekte alle 5 Minuten (tut nur etwas, wenn Arbeit da ist)
select cron.unschedule('angebote-dm') where exists (select 1 from cron.job where jobname = 'angebote-dm');
select cron.schedule('angebote-dm', '45 5 * * *',
  $$ select net.http_post(url := 'https://lcyllumkmsevocsviirv.supabase.co/functions/v1/angebote-auto',
       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"mode":"dm"}'::jsonb, timeout_milliseconds := 150000) $$);
select cron.unschedule('angebote-pdf') where exists (select 1 from cron.job where jobname = 'angebote-pdf');
select cron.schedule('angebote-pdf', '*/5 * * * *',
  $$ select net.http_post(url := 'https://lcyllumkmsevocsviirv.supabase.co/functions/v1/angebote-auto',
       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"mode":"pdf"}'::jsonb, timeout_milliseconds := 150000) $$);

-- Server-Funktion darf die Artikelliste lesen (nur lesen)
grant select on public.articles to service_role;

-- dm-Preischeck portionsweise: wann welcher Artikel zuletzt geprüft wurde
create table if not exists public.dm_checks (
  article_id bigint primary key,
  checked_at timestamptz not null default now(),
  hits int not null default 0
);
alter table public.dm_checks enable row level security;
grant select, insert, update, delete on public.dm_checks to service_role;
select cron.alter_job((select jobid from cron.job where jobname = 'angebote-dm'), schedule := '*/30 * * * *');
