-- Private lookup used only by the authenticated, admin-only sandbox sync Edge Function.
-- The Mercado Pago reference is restricted to test Order IDs before reading a row.
create or replace function public.lookup_store_sandbox_order_for_sync(p_payment_reference text)
returns table (
  order_id uuid,
  payment_reference text,
  total_cents integer,
  payment_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.payment_reference, o.total_cents, o.payment_status
  from private.store_sandbox_orders as o
  where p_payment_reference ~ '^ORDTST[0-9A-Z]+$'
    and o.payment_reference = p_payment_reference
  limit 1;
$$;

revoke all on function public.lookup_store_sandbox_order_for_sync(text)
  from public, anon, authenticated;
grant execute on function public.lookup_store_sandbox_order_for_sync(text)
  to service_role;
