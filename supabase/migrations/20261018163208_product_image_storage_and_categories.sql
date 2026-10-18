-- Supabase migration applied to project Fio de Varanda SP.
-- Mirrors the remote migration recorded as version 20261018163208.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/webp', 'image/jpeg', 'image/png', 'image/avif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "store admins upload product images" on storage.objects;
create policy "store admins upload product images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = 'products'
  and (select private.is_store_admin())
);

drop policy if exists "store admins update product images" on storage.objects;
create policy "store admins update product images"
on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = 'products'
  and (select private.is_store_admin())
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = 'products'
  and (select private.is_store_admin())
);

drop policy if exists "store admins delete product images" on storage.objects;
create policy "store admins delete product images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = 'products'
  and (select private.is_store_admin())
);

insert into public.categories (name, slug, description, sort_order, active)
values
  ('Redes', 'redes', 'Redes de descanso — catálogo demonstrativo.', 1, true),
  ('Cama', 'cama', 'Peças para cama — catálogo demonstrativo.', 2, true),
  ('Mesa', 'mesa', 'Peças para mesa — catálogo demonstrativo.', 3, true),
  ('Banho', 'banho', 'Peças para banho — catálogo demonstrativo.', 4, true),
  ('Acessórios', 'acessorios', 'Acessórios têxteis — catálogo demonstrativo.', 5, true)
on conflict (slug) do nothing;
