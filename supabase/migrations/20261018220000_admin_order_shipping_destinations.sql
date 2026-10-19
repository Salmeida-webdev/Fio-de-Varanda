begin;

alter table private.store_sandbox_orders
  add column if not exists customer jsonb not null default '{}'::jsonb,
  add column if not exists shipping_address jsonb not null default '{}'::jsonb;

comment on column private.store_sandbox_orders.customer is
  'Dados mínimos do comprador de pedidos sandbox; acessíveis somente por fluxo autenticado de administrador.';
comment on column private.store_sandbox_orders.shipping_address is
  'Endereço de entrega de pedidos sandbox; acessível somente por fluxo autenticado de administrador.';

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
  v_customer jsonb;
  v_address jsonb;
  v_postal text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[0-9a-f-]{36}$' then
    raise exception 'invalid_idempotency_key';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_cart';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_cart';
  end if;

  v_postal := regexp_replace(coalesce(p_address->>'postal_code',''), '[^0-9]', '', 'g');
  if length(trim(coalesce(p_customer->>'name',''))) = 0
    or length(trim(coalesce(p_customer->>'name',''))) > 120
    or length(trim(coalesce(p_customer->>'email',''))) > 180
    or lower(trim(coalesce(p_customer->>'email',''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(trim(coalesce(p_customer->>'phone',''))) = 0
    or length(trim(coalesce(p_customer->>'phone',''))) > 30
    or length(trim(coalesce(p_address->>'street',''))) = 0
    or length(trim(coalesce(p_address->>'street',''))) > 180
    or length(trim(coalesce(p_address->>'number',''))) = 0
    or length(trim(coalesce(p_address->>'number',''))) > 20
    or length(trim(coalesce(p_address->>'complement',''))) > 80
    or length(trim(coalesce(p_address->>'district',''))) = 0
    or length(trim(coalesce(p_address->>'district',''))) > 100
    or length(trim(coalesce(p_address->>'city',''))) = 0
    or length(trim(coalesce(p_address->>'city',''))) > 100
    or coalesce(p_address->>'state','') !~ '^[A-Za-z]{2}$'
    or v_postal !~ '^[0-9]{8}$' then
    raise exception 'invalid_customer_or_address';
  end if;
  if coalesce(p_shipping->>'service_id','') = ''
    or coalesce(p_shipping->>'price_cents','') !~ '^[0-9]+$' then
    raise exception 'invalid_shipping';
  end if;
  if coalesce(p_shipping->>'destination','') <> v_postal then
    raise exception 'shipping_address_mismatch';
  end if;

  v_customer := jsonb_build_object(
    'name', left(trim(p_customer->>'name'),120),
    'email', lower(left(trim(p_customer->>'email'),180)),
    'phone', left(trim(p_customer->>'phone'),30)
  );
  v_address := jsonb_build_object(
    'postal_code', v_postal,
    'street', left(trim(p_address->>'street'),180),
    'number', left(trim(p_address->>'number'),40),
    'complement', left(trim(coalesce(p_address->>'complement','')),120),
    'district', left(trim(p_address->>'district'),120),
    'city', left(trim(p_address->>'city'),120),
    'state', upper(trim(p_address->>'state'))
  );
  v_shipping_cents := (p_shipping->>'price_cents')::integer;

  select * into v_existing
    from private.store_sandbox_orders
   where idempotency_key = p_idempotency_key
   for update;
  if found then
    -- Pedidos criados antes desta migração só podem receber o endereço se a
    -- mesma chave de checkout for reutilizada com os dados completos.
    if v_existing.shipping_address = '{}'::jsonb then
      update private.store_sandbox_orders
         set customer = case when customer = '{}'::jsonb then v_customer else customer end,
             shipping_address = v_address,
             updated_at = now()
       where id = v_existing.id
       returning * into v_existing;
    end if;
    return jsonb_build_object(
      'order_id',v_existing.id,'existing',true,'checkout_url',v_existing.checkout_url,
      'payment_reference',v_existing.payment_reference,'total_cents',v_existing.total_cents,
      'items',v_existing.items
    );
  end if;

  for v_row in select value from jsonb_array_elements(p_items) loop
    begin
      v_quantity := (v_row.value->>'quantity')::integer;
      v_variant_id := (v_row.value->>'variant_id')::uuid;
    exception when others then
      raise exception 'invalid_cart_item';
    end;
    if v_quantity < 1 or v_quantity > 10 then
      raise exception 'invalid_quantity';
    end if;

    select pv.id,pv.sku,pv.option_values,pv.price_cents,pv.stock_on_hand,
           pv.stock_reserved,p.name as product_name
      into v_variant
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      join public.categories c on c.id = p.category_id
     where pv.id = v_variant_id and pv.active = true
       and p.status = 'active' and c.active = true
     for share of pv;
    if not found then
      raise exception 'product_unavailable';
    end if;
    if v_variant.stock_on_hand-v_variant.stock_reserved < v_quantity then
      raise exception 'insufficient_stock';
    end if;

    v_line_total := v_variant.price_cents*v_quantity;
    v_subtotal := v_subtotal+v_line_total;
    v_items := v_items||jsonb_build_array(jsonb_build_object(
      'variant_id',v_variant.id,'name',v_variant.product_name,'sku',v_variant.sku,
      'option_values',v_variant.option_values,'quantity',v_quantity,
      'unit_price_cents',v_variant.price_cents,'line_total_cents',v_line_total
    ));
  end loop;

  insert into private.store_sandbox_orders(
    idempotency_key,items,shipping,customer,shipping_address,
    subtotal_cents,shipping_cents,total_cents
  ) values (
    p_idempotency_key,v_items,p_shipping,v_customer,v_address,
    v_subtotal,v_shipping_cents,v_subtotal+v_shipping_cents
  ) returning id into v_order_id;

  return jsonb_build_object(
    'order_id',v_order_id,'existing',false,
    'total_cents',v_subtotal+v_shipping_cents,'items',v_items
  );
exception when unique_violation then
  select * into v_existing
    from private.store_sandbox_orders
   where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_id',v_existing.id,'existing',true,'checkout_url',v_existing.checkout_url,
      'payment_reference',v_existing.payment_reference,'total_cents',v_existing.total_cents,
      'items',v_existing.items
    );
  end if;
  raise;
end;
$$;

revoke all on function public.create_store_sandbox_order(text,jsonb,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_store_sandbox_order(text,jsonb,jsonb,jsonb,jsonb)
  to service_role;

create function public.admin_list_store_sandbox_orders_with_destinations()
returns table (
  id uuid,
  payment_reference text,
  total_cents integer,
  payment_status text,
  created_at timestamptz,
  items jsonb,
  customer jsonb,
  shipping_address jsonb,
  shipping_quote jsonb
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
    select o.id,o.payment_reference,o.total_cents,o.payment_status,
           o.created_at,o.items,o.customer,o.shipping_address,o.shipping
      from private.store_sandbox_orders o
     order by o.created_at desc
     limit 100;
end;
$$;

revoke all on function public.admin_list_store_sandbox_orders_with_destinations()
  from public, anon, authenticated;
grant execute on function public.admin_list_store_sandbox_orders_with_destinations()
  to authenticated;

commit;
