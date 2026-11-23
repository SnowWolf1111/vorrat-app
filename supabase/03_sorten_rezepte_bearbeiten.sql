-- 03: Sorten/Marken je Einlagerung, Artikelbilder, Warenkorb-Markierung,
--     Rezepte mit Mengen/Portionen, Verbrauch aus einer bestimmten Packung,
--     Gewürze einzeln, Notizen aufgeräumt.

alter table public.articles      add column if not exists image_url text;
alter table public.stock_entries add column if not exists ean text,
                                 add column if not exists variant text;   -- Marke/Sorte, z. B. "Rewe Beste Wahl"
alter table public.shopping_list add column if not exists carted_at timestamptz;
alter table public.dishes        add column if not exists servings smallint not null default 2,
                                 add column if not exists instructions text,
                                 add column if not exists origin text not null default 'liste';
alter table public.dish_items    add column if not exists amount numeric(10,2),
                                 add column if not exists unit text;

-- Einlagern mit Barcode/Sorte
drop function if exists public.add_stock(uuid, bigint, numeric, smallint, date, date);
create or replace function public.add_stock(
  p_entry_id     uuid,
  p_article_id   bigint,
  p_amount       numeric,
  p_location_id  smallint,
  p_best_before  date default null,
  p_purchased_at date default current_date,
  p_ean          text default null,
  p_variant      text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Menge muss größer 0 sein';
  end if;

  insert into public.stock_entries (id, article_id, location_id, amount, best_before, purchased_at, ean, variant)
  values (p_entry_id, p_article_id, p_location_id, p_amount, p_best_before, coalesce(p_purchased_at, current_date), p_ean, p_variant)
  on conflict (id) do nothing;

  if found then
    insert into public.stock_log (op_id, article_id, stock_entry_id, kind, change, best_before, location_id)
    values (p_entry_id, p_article_id, p_entry_id, 'add', p_amount, p_best_before, p_location_id);

    update public.shopping_list l
    set status = 'done', done_at = now()
    from public.stock_overview o
    where l.article_id = p_article_id
      and o.article_id = p_article_id
      and l.status = 'open'
      and l.origin = 'auto'
      and not o.below_min;
  end if;

  return p_entry_id;
end $$;

-- Verbrauch aus genau einer Packung (z. B. die, die bald abläuft)
create or replace function public.consume_entry(
  p_entry_id uuid,
  p_amount   numeric,
  p_op_id    uuid
) returns numeric
language plpgsql security invoker set search_path = '' as $$
declare e record; taken numeric;
begin
  if exists (select 1 from public.stock_log where op_id = p_op_id) then
    return (select coalesce(-sum(change), 0) from public.stock_log where op_id = p_op_id);
  end if;
  select * into e from public.stock_entries where id = p_entry_id for update;
  if not found then return 0; end if;
  taken := least(e.amount, p_amount);
  if taken <= 0 then return 0; end if;
  update public.stock_entries set amount = amount - taken where id = e.id;
  insert into public.stock_log (op_id, article_id, stock_entry_id, kind, change, best_before, location_id)
  values (p_op_id, e.article_id, e.id, 'consume', -taken, e.best_before, e.location_id);
  perform public.refresh_shopping_list();
  return taken;
end $$;

-- Mindestbestand prüfen nach Korrekturen (Menge geändert / Eintrag gelöscht)
revoke all on function public.add_stock(uuid, bigint, numeric, smallint, date, date, text, text) from public, anon;
revoke all on function public.consume_entry(uuid, numeric, uuid) from public, anon;
grant execute on function public.add_stock(uuid, bigint, numeric, smallint, date, date, text, text) to authenticated;
grant execute on function public.consume_entry(uuid, numeric, uuid) to authenticated;

-- ---------- Daten aufräumen ----------
update public.articles set name = 'Hot-Dog-Brötchen', note = 'einfrieren' where code = 'A010';
update public.articles set note = null where code in ('A001','A002','A005','A012','A018','A019','A031','A044','A047');
update public.articles set note = 'Rewe: ab 3 Stk 10 % Rabatt' where code = 'A004';

-- Gewürze einzeln statt "Gewürze Basis"
insert into public.articles (code, name, category, default_location_id, unit, min_stock, reorder_qty, source)
select v.code, v.name, 'Gewürze', (select id from public.locations where name = 'Vorratsschrank'), 'Dose/Streuer', 0, 1, 'Amazon'
from (values ('A048','Salz'), ('A049','Pfeffer'), ('A050','Paprika edelsüß'), ('A051','Currypulver'), ('A052','Knoblauchgranulat')) v(code, name)
on conflict (code) do nothing;

with g as (select id from public.articles where code = 'A029'),
     s as (select id from public.articles where code = 'A048'),
     p as (select id from public.articles where code = 'A049'),
     pa as (select id from public.articles where code = 'A050'),
     k as (select id from public.articles where code = 'A052')
insert into public.dish_items (dish_id, article_id, optional)
select i.dish_id, x.id, false
from public.dish_items i, g, lateral (
  select s.id from s where i.free_text is null
  union all select p.id from p where i.free_text is null
  union all select pa.id from pa where i.free_text is null and i.dish_id = (select id from public.dishes where name like 'Rigatoni%')
  union all select k.id from k where i.free_text = 'Knoblauch'
) x
where i.article_id = g.id;

delete from public.dish_items where article_id = (select id from public.articles where code = 'A029');
update public.articles set active = false where code = 'A029';
