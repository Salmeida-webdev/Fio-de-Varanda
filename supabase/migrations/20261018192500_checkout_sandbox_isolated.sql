create schema if not exists private;

create table if not exists private.store_sandbox_orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  items jsonb not null,
  shipping jsonb not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  payment_reference text unique,
  checkout_url text,
  payment_status text not null default 'pending'
    check (payment_status in ('pending','approved','rejected','cancelled','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.store_sandbox_payment_events (
  provider_event_id text primary key,
  order_id uuid not null references private.store_sandbox_orders(id) on delete cascade,
  payment_status text not null,
  received_at timestamptz not null default now()
);

alter table private.store_sandbox_orders enable row level security;
alter table private.store_sandbox_payment_events enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on table private.store_sandbox_orders, private.store_sandbox_payment_events from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on table private.store_sandbox_orders, private.store_sandbox_payment_events to service_role;

create or replace function public.create_store_sandbox_order(
  p_idempotency_key text,
  p_customer jsonb,
  p_address jsonb,
  p_items jsonb,
  p_shipping jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_variant_id uuid;
  v_existing private.store_sandbox_orders%rowtype;
  v_row record;
  v_variant record;
  v_quantity integer;
  v_subtotal integer := 0;
  v_shipping_cents integer;
  v_line_total integer;
  v_items jsonb := '[]'::jsonb;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[0-9a-f-]{36}$' then raise exception 'invalid_idempotency_key'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_cart'; end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then raise exception 'invalid_cart'; end if;
  if coalesce(p_customer->>'name','') = '' or coalesce(p_customer->>'email','') = '' or coalesce(p_customer->>'phone','') = '' then raise exception 'invalid_customer'; end if;
  if coalesce(p_shipping->>'service_id','') = '' or coalesce(p_shipping->>'price_cents','') !~ '^[0-9]+$' then raise exception 'invalid_shipping'; end if;
  v_shipping_cents := (p_shipping->>'price_cents')::integer;

  select * into v_existing from private.store_sandbox_orders where idempotency_key=p_idempotency_key for update;
  if found then
    return jsonb_build_object('order_id',v_existing.id,'existing',true,'checkout_url',v_existing.checkout_url,'payment_reference',v_existing.payment_reference,'total_cents',v_existing.total_cents,'items',v_existing.items);
  end if;

  for v_row in select value from jsonb_array_elements(p_items) loop
    begin
      v_quantity := (v_row.value->>'quantity')::integer;
      v_variant_id := (v_row.value->>'variant_id')::uuid;
    exception when others then raise exception 'invalid_cart_item';
    end;
    if v_quantity < 1 or v_quantity > 10 then raise exception 'invalid_quantity'; end if;
    select pv.id,pv.sku,pv.option_values,pv.price_cents,pv.stock_on_hand,pv.stock_reserved,p.name as product_name
      into v_variant
      from public.product_variants pv
      join public.products p on p.id=pv.product_id
      join public.categories c on c.id=p.category_id
     where pv.id=v_variant_id and pv.active=true and p.status='active' and c.active=true
     for share of pv;
    if not found then raise exception 'product_unavailable'; end if;
    if v_variant.stock_on_hand-v_variant.stock_reserved < v_quantity then raise exception 'insufficient_stock'; end if;
    v_line_total := v_variant.price_cents*v_quantity;
    v_subtotal := v_subtotal+v_line_total;
    v_items := v_items||jsonb_build_array(jsonb_build_object(
      'variant_id',v_variant.id,'name',v_variant.product_name,'sku',v_variant.sku,
      'option_values',v_variant.option_values,'quantity',v_quantity,
      'unit_price_cents',v_variant.price_cents,'line_total_cents',v_line_total
    ));
  end loop;

  insert into private.store_sandbox_orders(idempotency_key,items,shipping,subtotal_cents,shipping_cents,total_cents)
  values(p_idempotency_key,v_items,p_shipping,v_subtotal,v_shipping_cents,v_subtotal+v_shipping_cents)
  returning id into v_order_id;
  return jsonb_build_object('order_id',v_order_id,'existing',false,'total_cents',v_subtotal+v_shipping_cents,'items',v_items);
exception when unique_violation then
  select * into v_existing from private.store_sandbox_orders where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('order_id',v_existing.id,'existing',true,'checkout_url',v_existing.checkout_url,'payment_reference',v_existing.payment_reference,'total_cents',v_existing.total_cents,'items',v_existing.items); end if;
  raise;
end;
$$;
revoke all on function public.create_store_sandbox_order(text,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_store_sandbox_order(text,jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.save_store_sandbox_checkout(p_order_id uuid,p_payment_reference text,p_checkout_url text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_payment_reference,'')='' or coalesce(p_checkout_url,'') not like 'https://%' then raise exception 'invalid_sandbox_checkout'; end if;
  update private.store_sandbox_orders set payment_reference=p_payment_reference,checkout_url=p_checkout_url,updated_at=now()
   where id=p_order_id and payment_status='pending';
  return found;
end;
$$;
revoke all on function public.save_store_sandbox_checkout(uuid,text,text) from public, anon, authenticated;
grant execute on function public.save_store_sandbox_checkout(uuid,text,text) to service_role;

create or replace function public.apply_store_sandbox_payment_event(p_event_id text,p_order_id uuid,p_payment_reference text,p_provider_total_cents integer,p_payment_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_order private.store_sandbox_orders%rowtype;
begin
  if coalesce(p_event_id,'')='' or p_payment_status not in ('approved','rejected','cancelled','pending','expired') then raise exception 'invalid_sandbox_event'; end if;
  select * into v_order from private.store_sandbox_orders where id=p_order_id and payment_reference=p_payment_reference for update;
  if not found then raise exception 'sandbox_order_not_matched'; end if;
  if p_provider_total_cents is null or p_provider_total_cents<>v_order.total_cents then raise exception 'sandbox_payment_total_mismatch'; end if;
  insert into private.store_sandbox_payment_events(provider_event_id,order_id,payment_status)
  values(left(p_event_id,240),p_order_id,p_payment_status) on conflict(provider_event_id) do nothing;
  if not found then return false; end if;
  update private.store_sandbox_orders set payment_status=p_payment_status,updated_at=now() where id=p_order_id;
  return true;
end;
$$;
revoke all on function public.apply_store_sandbox_payment_event(text,uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.apply_store_sandbox_payment_event(text,uuid,text,integer,text) to service_role;
