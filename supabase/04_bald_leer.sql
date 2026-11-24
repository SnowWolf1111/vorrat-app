-- 04: "Bald leer" – Artikel ist noch da, soll aber schon nachgekauft werden.
-- Einkaufslisten-Eintrag mit origin 'bald_leer'; wird beim nächsten Einlagern automatisch abgehakt.

alter table public.shopping_list drop constraint shopping_list_origin_check;
alter table public.shopping_list add constraint shopping_list_origin_check
  check (origin in ('auto', 'alexa', 'manual', 'bald_leer'));

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
    -- Nachschub ist da: "bald leer" immer abhaken, Mindestbestand-Einträge nur wenn wieder genug da ist
    update public.shopping_list l
    set status = 'done', done_at = now()
    from public.stock_overview o
    where l.article_id = p_article_id and o.article_id = p_article_id
      and l.status = 'open'
      and (l.origin = 'bald_leer' or (l.origin = 'auto' and not o.below_min));
  end if;
  return p_entry_id;
end $$;
