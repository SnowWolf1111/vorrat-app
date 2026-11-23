-- =====================================================================
-- Vorrats-App – Datenbankschema (Supabase / Postgres)
-- Einmal komplett im Supabase SQL Editor ausführen.
-- Datenmodell an Grocy angelehnt: Bestand je Einlagerung (MHD), Mindestbestand,
-- Lagerorte, Einkaufsliste, Gerichte.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Lagerorte
-- ---------------------------------------------------------------------
create table public.locations (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  is_frozen  boolean not null default false,
  sort       smallint not null default 0
);

insert into public.locations (name, is_frozen, sort) values
  ('TK Keller',       true,  1),
  ('TK Küche',        true,  2),
  ('Kühlschrank',     false, 3),
  ('Vorratsschrank',  false, 4);

-- ---------------------------------------------------------------------
-- Katalog
-- ---------------------------------------------------------------------
create table public.articles (
  id                   bigint generated always as identity primary key,
  code                 text unique,                       -- A001 … aus der Excel
  name                 text not null,
  category             text,
  default_location_id  smallint references public.locations(id),
  unit                 text,
  min_stock            numeric(10,2) not null default 0 check (min_stock >= 0),
  reorder_qty          numeric(10,2) not null default 1 check (reorder_qty > 0),
  source               text check (source in ('Amazon','Rewe','Metro','Vor Ort')),
  amazon_asin          text,
  amazon_product       text,
  amazon_price         numeric(8,2),
  rewe_product         text,
  rewe_price           numeric(8,2),
  local_ref            text,                              -- Vor Ort / Metro (Referenz)
  note                 text,
  aliases              text[] not null default '{}',      -- für Alexa-Zuordnung
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.barcodes (
  ean            text primary key,
  article_id     bigint not null references public.articles(id) on delete cascade,
  off_name       text,
  off_brand      text,
  off_quantity   text,
  off_image_url  text,
  created_at     timestamptz not null default now()
);
create index on public.barcodes (article_id);

-- ---------------------------------------------------------------------
-- Bestand: eine Zeile je Einlagerung (amount = Restmenge)
-- id wird in der App erzeugt (uuid) -> Offline-Warteschlange ist idempotent
-- ---------------------------------------------------------------------
create table public.stock_entries (
  id            uuid primary key default gen_random_uuid(),
  article_id    bigint not null references public.articles(id) on delete cascade,
  location_id   smallint not null references public.locations(id),
  amount        numeric(10,2) not null check (amount >= 0),
  best_before   date,
  purchased_at  date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.stock_entries (article_id) where amount > 0;

-- Verlauf (Einlagern, Verbrauch, Korrektur) – auch für "Rückgängig"
create table public.stock_log (
  id              uuid primary key default gen_random_uuid(),
  op_id           uuid,                 -- Vorgangs-ID aus der App (Idempotenz)
  article_id      bigint not null references public.articles(id) on delete cascade,
  stock_entry_id  uuid references public.stock_entries(id) on delete set null,
  kind            text not null check (kind in ('add','consume','correct','move')),
  change          numeric(10,2) not null,
  best_before     date,
  location_id     smallint references public.locations(id),
  created_at      timestamptz not null default now()
);
create index on public.stock_log (op_id);
create index on public.stock_log (article_id, created_at desc);

-- ---------------------------------------------------------------------
-- Einkaufsliste
-- ---------------------------------------------------------------------
create table public.shopping_list (
  id          uuid primary key default gen_random_uuid(),
  article_id  bigint references public.articles(id) on delete cascade,
  free_text   text,                                        -- z. B. unzugeordneter Alexa-Eintrag
  amount      numeric(10,2) not null default 1 check (amount > 0),
  source      text check (source in ('Amazon','Rewe','Metro','Vor Ort')),
  origin      text not null default 'manual' check (origin in ('auto','alexa','manual')),
  status      text not null default 'open' check (status in ('open','done')),
  note        text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  check (article_id is not null or free_text is not null)
);
create index on public.shopping_list (status);

-- ---------------------------------------------------------------------
-- Gerichte
-- ---------------------------------------------------------------------
create table public.dishes (
  id    smallint generated always as identity primary key,
  name  text not null unique,
  hint  text,
  sort  smallint not null default 0
);

-- alt_group: Zutaten mit gleicher Nummer sind Alternativen ("A oder B")
create table public.dish_items (
  id          bigint generated always as identity primary key,
  dish_id     smallint not null references public.dishes(id) on delete cascade,
  article_id  bigint references public.articles(id) on delete cascade,
  free_text   text,
  optional    boolean not null default false,
  alt_group   smallint,
  check (article_id is not null or free_text is not null)
);
create index on public.dish_items (dish_id);

-- ---------------------------------------------------------------------
-- updated_at automatisch pflegen
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_articles_touch      before update on public.articles      for each row execute function public.touch_updated_at();
create trigger trg_stock_entries_touch before update on public.stock_entries for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Übersicht: Bestand je Artikel
-- ---------------------------------------------------------------------
create view public.stock_overview with (security_invoker = true) as
select
  a.id                                         as article_id,
  a.code,
  a.name,
  a.category,
  a.unit,
  a.min_stock,
  a.reorder_qty,
  a.source,
  a.default_location_id,
  coalesce(sum(s.amount), 0)                   as amount,
  min(s.best_before)                           as next_best_before,
  coalesce(sum(s.amount), 0) < a.min_stock     as below_min
from public.articles a
left join public.stock_entries s on s.article_id = a.id and s.amount > 0
where a.active
group by a.id;

-- ---------------------------------------------------------------------
-- Mindestbestand -> Einkaufsliste
-- Legt für jeden Artikel unter Mindestbestand einen offenen Eintrag an,
-- sofern noch keiner offen ist. Gibt die Anzahl neuer Einträge zurück.
-- ---------------------------------------------------------------------
create or replace function public.refresh_shopping_list() returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  insert into public.shopping_list (article_id, amount, source, origin)
  select o.article_id, o.reorder_qty, o.source, 'auto'
  from public.stock_overview o
  where o.below_min
    and not exists (
      select 1 from public.shopping_list l
      where l.article_id = o.article_id and l.status = 'open'
    );
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Austragen: zieht vom Eintrag mit dem ältesten MHD ab (ohne MHD zuletzt,
-- bei gleichem MHD der älteste Einkauf zuerst). p_op_id macht den Aufruf
-- idempotent (Offline-Warteschlange darf doppelt senden).
-- Gibt die tatsächlich abgezogene Menge zurück.
-- ---------------------------------------------------------------------
create or replace function public.consume_stock(
  p_article_id  bigint,
  p_amount      numeric,
  p_op_id       uuid,
  p_location_id smallint default null
) returns numeric
language plpgsql security invoker set search_path = '' as $$
declare
  rest   numeric := p_amount;
  taken  numeric;
  e      record;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Menge muss größer 0 sein';
  end if;

  if exists (select 1 from public.stock_log where op_id = p_op_id) then
    return (select coalesce(-sum(change), 0) from public.stock_log where op_id = p_op_id);
  end if;

  for e in
    select * from public.stock_entries
    where article_id = p_article_id
      and amount > 0
      and (p_location_id is null or location_id = p_location_id)
    order by best_before asc nulls last, purchased_at asc, created_at asc
    for update
  loop
    exit when rest <= 0;
    taken := least(e.amount, rest);
    update public.stock_entries set amount = amount - taken where id = e.id;
    insert into public.stock_log (op_id, article_id, stock_entry_id, kind, change, best_before, location_id)
    values (p_op_id, p_article_id, e.id, 'consume', -taken, e.best_before, e.location_id);
    rest := rest - taken;
  end loop;

  perform public.refresh_shopping_list();
  return p_amount - rest;
end $$;

-- ---------------------------------------------------------------------
-- Einlagern (idempotent über p_entry_id)
-- ---------------------------------------------------------------------
create or replace function public.add_stock(
  p_entry_id     uuid,
  p_article_id   bigint,
  p_amount       numeric,
  p_location_id  smallint,
  p_best_before  date default null,
  p_purchased_at date default current_date
) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Menge muss größer 0 sein';
  end if;

  insert into public.stock_entries (id, article_id, location_id, amount, best_before, purchased_at)
  values (p_entry_id, p_article_id, p_location_id, p_amount, p_best_before, coalesce(p_purchased_at, current_date))
  on conflict (id) do nothing;

  if found then
    insert into public.stock_log (op_id, article_id, stock_entry_id, kind, change, best_before, location_id)
    values (p_entry_id, p_article_id, p_entry_id, 'add', p_amount, p_best_before, p_location_id);
  end if;

  return p_entry_id;
end $$;

-- ---------------------------------------------------------------------
-- Zugriffsschutz (Row Level Security)
-- Einzelnutzer-App: Wer eingeloggt ist, darf alles; ohne Login nichts.
-- Neue Registrierungen werden im Supabase-Dashboard abgeschaltet.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['locations','articles','barcodes','stock_entries','stock_log',
                           'shopping_list','dishes','dish_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "nur_eingeloggt" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.refresh_shopping_list()                                to authenticated;
grant execute on function public.consume_stock(bigint, numeric, uuid, smallint)         to authenticated;
grant execute on function public.add_stock(uuid, bigint, numeric, smallint, date, date) to authenticated;
