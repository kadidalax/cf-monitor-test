create or replace function public.cfm_reorder_website_monitors(input_ids jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  input_count integer;
  existing_count integer;
  updated_count integer;
begin
  with input_order as (
    select value::integer as id, min(ord)::integer as ord
    from jsonb_array_elements_text(case when jsonb_typeof(input_ids) = 'array' then input_ids else '[]'::jsonb end) with ordinality as item(value, ord)
    where value ~ '^[0-9]+$' and value::integer > 0
    group by value::integer
  )
  select count(*) into input_count from input_order;
  if input_count = 0 then
    return 0;
  end if;

  with input_order as (
    select value::integer as id, min(ord)::integer as ord
    from jsonb_array_elements_text(case when jsonb_typeof(input_ids) = 'array' then input_ids else '[]'::jsonb end) with ordinality as item(value, ord)
    where value ~ '^[0-9]+$' and value::integer > 0
    group by value::integer
  )
  select count(*) into existing_count
  from website_monitors w
  join input_order i on i.id = w.id;
  if existing_count <> input_count then
    raise exception 'Website monitor id does not exist';
  end if;

  with input_order as (
    select value::integer as id, min(ord)::integer as ord
    from jsonb_array_elements_text(case when jsonb_typeof(input_ids) = 'array' then input_ids else '[]'::jsonb end) with ordinality as item(value, ord)
    where value ~ '^[0-9]+$' and value::integer > 0
    group by value::integer
  ),
  final_order as (
    select id, (row_number() over (order by i.ord asc))::integer as sort_order
    from input_order i
    union all
    select w.id, (input_count + (row_number() over (order by w.sort_order asc, w.id asc))::integer)::integer
    from website_monitors w
    where not exists (select 1 from input_order i where i.id = w.id)
  ),
  updated as (
    update website_monitors w
    set sort_order = f.sort_order,
        updated_at = now()
    from final_order f
    where w.id = f.id
      and w.sort_order is distinct from f.sort_order
    returning w.id
  )
  select count(*) into updated_count from updated;

  return updated_count;
end;
$$;

revoke all on function public.cfm_reorder_website_monitors(jsonb) from public;
revoke all on function public.cfm_reorder_website_monitors(jsonb) from anon;
revoke all on function public.cfm_reorder_website_monitors(jsonb) from authenticated;
grant execute on function public.cfm_reorder_website_monitors(jsonb) to service_role;

notify pgrst, 'reload schema';
