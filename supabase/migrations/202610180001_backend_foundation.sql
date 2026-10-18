-- Fio de Varanda: base de dados para a etapa de backend.
-- Não importar o catálogo demonstrativo como estoque comercial.
create extension if not exists pgcrypto;

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'admin' check (role = 'admin'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  image_url text,
  sort_order integer not null default 0,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text not null default '',
  details jsonb not null default '[]'::jsonb check (jsonb_typeof(details) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  featured boolean not null default false,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text text not null,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, storage_path)
);
create unique index if not exists product_images_one_primary
  on public.product_images(product_id) where is_primary;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  option_values jsonb not null default '{}'::jsonb check (jsonb_typeof(option_values) = 'object'),
  price_cents integer not null check (price_cents >= 0),
  stock_on_hand integer not null default 0 check (stock_on_hand >= 0),
  stock_reserved integer not null default 0 check (stock_reserved >= 0 and stock_reserved <= stock_on_hand),
  weight_grams integer check (weight_grams is null or weight_grams >= 0),
  dimensions_mm jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  discount_value integer not null check (discount_value > 0),
  minimum_subtotal_cents integer not null default 0 check (minimum_subtotal_cents >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or starts_at is null or expires_at > starts_at)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  idempotency_key text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  shipping_address jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'expired')),
  shipping_status text not null default 'pending'
    check (shipping_status in ('pending', 'quoted', 'label_created', 'shipped', 'delivered', 'cancelled')),
  payment_provider text,
  payment_reference text unique,
  shipping_provider text,
  shipping_service text,
  tracking_code text,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  coupon_code_snapshot text,
  customer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  option_snapshot jsonb not null default '{}'::jsonb,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  line_total_cents integer not null check (line_total_cents >= 0)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id),
  delta integer not null check (delta <> 0),
  reason text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider, provider_event_id)
);

create index if not exists products_public_listing on public.products(status, featured, updated_at desc);
create index if not exists products_category_listing on public.products(category_id, status);
create index if not exists variants_product_active on public.product_variants(product_id, active);
create index if not exists orders_created_at on public.orders(created_at desc);
create index if not exists orders_status_created_at on public.orders(status, created_at desc);
create index if not exists order_items_order_id on public.order_items(order_id);
create index if not exists inventory_movements_variant_date on public.inventory_movements(variant_id, created_at desc);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_profiles_set_updated_at on public.admin_profiles;
create trigger admin_profiles_set_updated_at before update on public.admin_profiles
for each row execute function private.set_updated_at();
drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
for each row execute function private.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function private.set_updated_at();
drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at before update on public.product_variants
for each row execute function private.set_updated_at();
drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at before update on public.coupons
for each row execute function private.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function private.set_updated_at();

create or replace function private.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_profiles ap
    where ap.user_id = (select auth.uid())
      and ap.active = true
      and ap.role = 'admin'
  );
$$;
revoke all on function private.is_store_admin() from public, anon;
grant execute on function private.is_store_admin() to authenticated;

alter table public.admin_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "admins read own profile" on public.admin_profiles;
create policy "admins read own profile" on public.admin_profiles
for select to authenticated using (user_id = (select auth.uid()) or (select private.is_store_admin()));
drop policy if exists "admins manage profiles" on public.admin_profiles;
create policy "admins manage profiles" on public.admin_profiles
for all to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

drop policy if exists "public reads active categories" on public.categories;
create policy "public reads active categories" on public.categories
for select to anon, authenticated using (active = true);
drop policy if exists "admins manage categories" on public.categories;
create policy "admins manage categories" on public.categories
for all to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

drop policy if exists "public reads active products" on public.products;
create policy "public reads active products" on public.products
for select to anon, authenticated using (
  status = 'active' and exists (
    select 1 from public.categories c where c.id = category_id and c.active = true
  )
);
drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products
for all to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

drop policy if exists "public reads active product images" on public.product_images;
create policy "public reads active product images" on public.product_images
for select to anon, authenticated using (
  exists (select 1 from public.products p where p.id = product_id and p.status = 'active')
);
drop policy if exists "admins manage product images" on public.product_images;
create policy "admins manage product images" on public.product_images
for all to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

drop policy if exists "public reads active variants of active products" on public.product_variants;
create policy "public reads active variants of active products" on public.product_variants
for select to anon, authenticated using (
  active = true and exists (
    select 1 from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = product_id and p.status = 'active' and c.active = true
  )
);
drop policy if exists "admins manage variants" on public.product_variants;
create policy "admins manage variants" on public.product_variants
for all to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons
for all to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));
drop policy if exists "admins read orders" on public.orders;
create policy "admins read orders" on public.orders
for select to authenticated using ((select private.is_store_admin()));
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders" on public.orders
for update to authenticated using ((select private.is_store_admin())) with check ((select private.is_store_admin()));
drop policy if exists "admins read order items" on public.order_items;
create policy "admins read order items" on public.order_items
for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id)
  and (select private.is_store_admin())
);
drop policy if exists "admins read inventory movements" on public.inventory_movements;
create policy "admins read inventory movements" on public.inventory_movements
for select to authenticated using ((select private.is_store_admin()));
drop policy if exists "admins read payment events" on public.payment_events;
create policy "admins read payment events" on public.payment_events
for select to authenticated using ((select private.is_store_admin()));

-- A API pública não recebe acesso às tabelas de operação. O catálogo público
-- usa colunas explícitas para não expor estoque interno nem metadados privados.
revoke all on public.admin_profiles, public.categories, public.products,
  public.product_images, public.product_variants, public.coupons, public.orders,
  public.order_items, public.inventory_movements, public.payment_events
  from public, anon, authenticated;

grant select (id, name, slug, description, image_url, sort_order)
  on public.categories to anon, authenticated;
grant select (id, category_id, name, slug, description, details, status, featured, seo_title, seo_description)
  on public.products to anon, authenticated;
grant select (id, product_id, storage_path, alt_text, sort_order, is_primary)
  on public.product_images to anon, authenticated;
grant select (id, product_id, sku, option_values, price_cents, weight_grams, dimensions_mm, active)
  on public.product_variants to anon, authenticated;

grant all on public.admin_profiles, public.categories, public.products,
  public.product_images, public.product_variants, public.coupons, public.orders,
  public.order_items, public.inventory_movements, public.payment_events
  to authenticated;
grant all on public.admin_profiles, public.categories, public.products,
  public.product_images, public.product_variants, public.coupons, public.orders,
  public.order_items, public.inventory_movements, public.payment_events
  to service_role;
do $$
declare order_number_sequence text;
begin
  order_number_sequence := pg_get_serial_sequence('public.orders', 'order_number');
  if order_number_sequence is not null then
    execute format('grant usage, select on sequence %s to service_role', order_number_sequence);
  end if;
end;
$$;

-- Nenhuma política anônima de escrita ou leitura foi criada para pedidos,
-- clientes, cupons, eventos de pagamento ou movimentos de estoque.
