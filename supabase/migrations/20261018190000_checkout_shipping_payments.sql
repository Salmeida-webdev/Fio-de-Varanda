-- Checkout server-side: preços e disponibilidade vêm do catálogo do Supabase.
alter table public.orders
  add column if not exists shipping_quote_snapshot jsonb,
  add column if not exists checkout_url text,
  add column if not exists payment_mode text not null default 'production'
    check (payment_mode in ('production', 'sandbox'));

create or replace function public.create_store_checkout_order(
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
  v_subtotal integer := 0;
  v_quantity integer;
  v_variant_id uuid;
  v_variant record;
  v_row record;
  v_shipping_cents integer;
  v_item_total integer;
  v_inserted integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_expired record;
  v_expired_item record;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 20 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_cart';
  end if;
  if coalesce(p_customer->>'name','') = '' or coalesce(p_customer->>'email','') = '' or coalesce(p_customer->>'phone','') = '' then
    raise exception 'invalid_customer';
  end if;
  if coalesce(p_shipping->>'service_id','') = '' or coalesce(p_shipping->>'price_cents','') !~ '^[0-9]+$' then
    raise exception 'invalid_shipping';
  end if;
  v_shipping_cents := (p_shipping->>'price_cents')::integer;

  select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
  if v_order_id is not null then
    return (select jsonb_build_object('order_id',o.id,'existing',true,'checkout_url',o.checkout_url,'payment_reference',o.payment_reference,'total_cents',o.total_cents,'items',coalesce((select jsonb_agg(jsonb_build_object('variant_id',oi.variant_id,'name',oi.product_name_snapshot,'sku',oi.sku_snapshot,'quantity',oi.quantity,'unit_price_cents',oi.unit_price_cents,'line_total_cents',oi.line_total_cents)) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb)) from public.orders o where o.id=v_order_id);
  end if;

  for v_expired in select id from public.orders where payment_status='pending' and created_at < now()-interval '30 minutes' for update skip locked loop
    for v_expired_item in select variant_id,quantity from public.order_items where order_id=v_expired.id and variant_id is not null loop
      update public.product_variants set stock_reserved=greatest(0,stock_reserved-v_expired_item.quantity) where id=v_expired_item.variant_id;
    end loop;
    update public.orders set status='cancelled',payment_status='expired' where id=v_expired.id;
  end loop;

  insert into public.orders (
    idempotency_key, customer_name, customer_email, customer_phone,
    shipping_address, shipping_provider, shipping_service, shipping_status,
    shipping_cents, subtotal_cents, total_cents, shipping_quote_snapshot,
    payment_provider, payment_mode, status, payment_status
  ) values (
    p_idempotency_key,
    left(trim(p_customer->>'name'),120), lower(left(trim(p_customer->>'email'),180)), left(trim(p_customer->>'phone'),30),
    p_address, 'melhor_envio', left(p_shipping->>'service_name',120), 'quoted',
    v_shipping_cents, 0, v_shipping_cents, p_shipping,
    'mercado_pago', coalesce(nullif(current_setting('app.integration_mode', true),''),'production'), 'pending', 'pending'
  ) returning id into v_order_id;

  for v_row in select value from jsonb_array_elements(p_items) loop
    begin
      v_variant_id := (v_row.value->>'variant_id')::uuid;
      v_quantity := (v_row.value->>'quantity')::integer;
    exception when others then
      raise exception 'invalid_cart_item';
    end;
    if v_quantity < 1 or v_quantity > 10 then raise exception 'invalid_quantity'; end if;

    select pv.id, pv.sku, pv.option_values, pv.price_cents, pv.stock_on_hand, pv.stock_reserved,
           p.name as product_name
      into v_variant
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.categories c on c.id = p.category_id
     where pv.id = v_variant_id and pv.active = true and p.status = 'active' and c.active = true
     for update of pv;
    if not found then raise exception 'product_unavailable'; end if;
    if v_variant.stock_on_hand - v_variant.stock_reserved < v_quantity then raise exception 'insufficient_stock'; end if;

    update public.product_variants set stock_reserved = stock_reserved + v_quantity where id = v_variant.id;
    v_item_total := v_variant.price_cents * v_quantity;
    v_subtotal := v_subtotal + v_item_total;
    insert into public.order_items(order_id, variant_id, product_name_snapshot, sku_snapshot, option_snapshot, unit_price_cents, quantity, line_total_cents)
    values (v_order_id, v_variant.id, v_variant.product_name, v_variant.sku, v_variant.option_values, v_variant.price_cents, v_quantity, v_item_total);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'variant_id',v_variant.id,'name',v_variant.product_name,'sku',v_variant.sku,
      'quantity',v_quantity,'unit_price_cents',v_variant.price_cents,'line_total_cents',v_item_total
    ));
    v_inserted := v_inserted + 1;
  end loop;
  if v_inserted <> jsonb_array_length(p_items) then raise exception 'invalid_cart'; end if;
  update public.orders set subtotal_cents = v_subtotal, total_cents = v_subtotal + v_shipping_cents where id = v_order_id;
  return jsonb_build_object('order_id',v_order_id,'existing',false,'subtotal_cents',v_subtotal,'shipping_cents',v_shipping_cents,'total_cents',v_subtotal+v_shipping_cents,'items',v_items);
exception when unique_violation then
  select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
  if v_order_id is not null then return (select jsonb_build_object('order_id',o.id,'existing',true,'checkout_url',o.checkout_url,'payment_reference',o.payment_reference,'total_cents',o.total_cents,'items',coalesce((select jsonb_agg(jsonb_build_object('variant_id',oi.variant_id,'name',oi.product_name_snapshot,'sku',oi.sku_snapshot,'quantity',oi.quantity,'unit_price_cents',oi.unit_price_cents,'line_total_cents',oi.line_total_cents)) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb)) from public.orders o where o.id=v_order_id); end if;
  raise;
end;
$$;
revoke all on function public.create_store_checkout_order(text,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_store_checkout_order(text,jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.apply_store_payment_event(
  p_event_id text,
  p_order_id uuid,
  p_payment_status text,
  p_payment_reference text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_new_status text;
begin
  if p_event_id is null or length(p_event_id) < 1 then raise exception 'invalid_event'; end if;
  if p_payment_status not in ('approved','rejected','cancelled','pending','refunded') then raise exception 'invalid_payment_status'; end if;
  insert into public.payment_events(provider,provider_event_id,order_id,event_type,processed_at)
  values ('mercado_pago',left(p_event_id,240),p_order_id,'order.'||p_payment_status,now())
  on conflict (provider,provider_event_id) do nothing;
  if not found then return false; end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found then update public.payment_events set processing_error='order_not_found' where provider='mercado_pago' and provider_event_id=left(p_event_id,240); return false; end if;
  if v_order.status in ('cancelled','refunded') then return false; end if;

  if p_payment_status='approved' then
    if v_order.payment_status='approved' then return true; end if;
    for v_item in select variant_id,quantity from public.order_items where order_id=p_order_id and variant_id is not null loop
      update public.product_variants
         set stock_on_hand=stock_on_hand-v_item.quantity,
             stock_reserved=greatest(0,stock_reserved-v_item.quantity)
       where id=v_item.variant_id and stock_on_hand>=v_item.quantity;
      if not found then raise exception 'inventory_commit_failed'; end if;
      insert into public.inventory_movements(variant_id,delta,reason,order_id)
      values(v_item.variant_id,-v_item.quantity,'order_paid',p_order_id);
    end loop;
    v_new_status := 'paid';
  elsif p_payment_status in ('rejected','cancelled','refunded') then
    for v_item in select variant_id,quantity from public.order_items where order_id=p_order_id and variant_id is not null loop
      update public.product_variants set stock_reserved=greatest(0,stock_reserved-v_item.quantity) where id=v_item.variant_id;
    end loop;
    v_new_status := case when p_payment_status='refunded' then 'refunded' else 'cancelled' end;
  else
    v_new_status := 'pending';
  end if;
  update public.orders set payment_status=p_payment_status,status=v_new_status,payment_reference=coalesce(p_payment_reference,payment_reference) where id=p_order_id;
  update public.payment_events set processed_at=now() where provider='mercado_pago' and provider_event_id=left(p_event_id,240);
  return true;
end;
$$;
revoke all on function public.apply_store_payment_event(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.apply_store_payment_event(text,uuid,text,text) to service_role;


create or replace function public.release_store_checkout_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.orders%rowtype; v_item record;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.payment_status='approved' or v_order.status in ('cancelled','refunded') then return false; end if;
  for v_item in select variant_id,quantity from public.order_items where order_id=p_order_id and variant_id is not null loop
    update public.product_variants set stock_reserved=greatest(0,stock_reserved-v_item.quantity) where id=v_item.variant_id;
  end loop;
  update public.orders set status='cancelled',payment_status='cancelled' where id=p_order_id;
  return true;
end;
$$;
revoke all on function public.release_store_checkout_order(uuid) from public, anon, authenticated;
grant execute on function public.release_store_checkout_order(uuid) to service_role;
