begin;

alter table private.store_sandbox_orders
  add column if not exists shipping_status text not null default 'quoted',
  add column if not exists tracking_code text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'store_sandbox_orders_shipping_status_check'
       and conrelid = 'private.store_sandbox_orders'::regclass
  ) then
    alter table private.store_sandbox_orders
      add constraint store_sandbox_orders_shipping_status_check
      check (shipping_status in ('pending', 'quoted', 'label_created', 'shipped', 'delivered', 'cancelled'));
  end if;
end;
$$;

comment on column private.store_sandbox_orders.shipping_status is
  'Status de expedição administrado pelo painel; não altera o status do pagamento.';
comment on column private.store_sandbox_orders.tracking_code is
  'Código de rastreio informado pela administração da loja.';

drop policy if exists "admins update sandbox fulfillment" on private.store_sandbox_orders;
create policy "admins update sandbox fulfillment"
  on private.store_sandbox_orders
  for update
  to authenticated
  using (
    exists (
      select 1 from public.admin_profiles ap
       where ap.user_id = (select auth.uid())
         and ap.role = 'admin'
         and ap.active is true
    )
  )
  with check (
    exists (
      select 1 from public.admin_profiles ap
       where ap.user_id = (select auth.uid())
         and ap.role = 'admin'
         and ap.active is true
    )
  );
grant update (shipping_status, tracking_code, updated_at)
  on private.store_sandbox_orders to authenticated;

create or replace function public.admin_list_store_sandbox_orders_with_fulfillment()
returns table (
  id uuid,
  payment_reference text,
  total_cents integer,
  payment_status text,
  created_at timestamptz,
  items jsonb,
  customer jsonb,
  shipping_address jsonb,
  shipping_quote jsonb,
  shipping_status text,
  tracking_code text
)
language plpgsql
stable
security invoker
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
    select o.id, o.payment_reference, o.total_cents, o.payment_status,
           o.created_at, o.items, o.customer, o.shipping_address, o.shipping,
           o.shipping_status, o.tracking_code
      from private.store_sandbox_orders o
     order by o.created_at desc
     limit 100;
end;
$$;

revoke all on function public.admin_list_store_sandbox_orders_with_fulfillment()
  from public, anon, authenticated;
grant execute on function public.admin_list_store_sandbox_orders_with_fulfillment()
  to authenticated;

create or replace function public.admin_update_store_order_fulfillment(
  p_order_id uuid,
  p_environment text,
  p_shipping_status text,
  p_tracking_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tracking_code text := nullif(left(trim(coalesce(p_tracking_code, '')), 120), '');
  v_result jsonb;
begin
  if v_user_id is null or not exists (
    select 1 from public.admin_profiles ap
     where ap.user_id = v_user_id and ap.role = 'admin' and ap.active is true
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;

  if p_shipping_status is null or p_shipping_status not in ('pending', 'quoted', 'label_created', 'shipped', 'delivered') then
    raise exception 'invalid_shipping_status' using errcode = '22023';
  end if;
  if length(coalesce(p_tracking_code, '')) > 120 then
    raise exception 'invalid_tracking_code' using errcode = '22023';
  end if;

  if p_environment = 'produção' then
    update public.orders o
       set shipping_status = p_shipping_status,
           tracking_code = v_tracking_code,
           updated_at = now()
     where o.id = p_order_id
       and o.payment_status = 'approved'
    returning jsonb_build_object(
      'order_id', o.id,
      'environment', 'produção',
      'shipping_status', o.shipping_status,
      'tracking_code', o.tracking_code,
      'updated_at', o.updated_at
    ) into v_result;
  elsif p_environment = 'teste' then
    update private.store_sandbox_orders o
       set shipping_status = p_shipping_status,
           tracking_code = v_tracking_code,
           updated_at = now()
     where o.id = p_order_id
       and o.payment_status = 'approved'
    returning jsonb_build_object(
      'order_id', o.id,
      'environment', 'teste',
      'shipping_status', o.shipping_status,
      'tracking_code', o.tracking_code,
      'updated_at', o.updated_at
    ) into v_result;
  else
    raise exception 'invalid_order_environment' using errcode = '22023';
  end if;

  if v_result is null then
    raise exception 'paid_order_not_found';
  end if;
  return v_result;
end;
$$;

revoke all on function public.admin_update_store_order_fulfillment(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_store_order_fulfillment(uuid, text, text, text)
  to authenticated;

commit;
