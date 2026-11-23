-- Einlagern hakt automatische Einkaufslisten-Einträge ab, sobald der Mindestbestand wieder erreicht ist.
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
