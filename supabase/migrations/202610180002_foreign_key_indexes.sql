-- Índices para as chaves estrangeiras sinalizadas pelo advisor de desempenho.
create index if not exists inventory_movements_actor_user_id_idx
  on public.inventory_movements(actor_user_id);
create index if not exists inventory_movements_order_id_idx
  on public.inventory_movements(order_id);
create index if not exists order_items_variant_id_idx
  on public.order_items(variant_id);
create index if not exists payment_events_order_id_idx
  on public.payment_events(order_id);
