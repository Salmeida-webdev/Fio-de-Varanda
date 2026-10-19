create or replace function public.admin_list_store_sandbox_orders()
returns table (
  id uuid,
  payment_reference text,
  total_cents integer,
  payment_status text,
  created_at timestamptz,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = v_user_id and ap.role = 'admin' and ap.active is true
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;

  return query
    select o.id, o.payment_reference, o.total_cents, o.payment_status, o.created_at, o.items
    from private.store_sandbox_orders o
    order by o.created_at desc
    limit 100;
end;
$$;

revoke all on function public.admin_list_store_sandbox_orders() from public, anon, authenticated;
grant execute on function public.admin_list_store_sandbox_orders() to authenticated;
