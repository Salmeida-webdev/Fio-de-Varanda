create index if not exists store_sandbox_payment_events_order_id_idx
  on private.store_sandbox_payment_events(order_id);

create policy "deny direct access to sandbox orders"
  on private.store_sandbox_orders
  for all to public
  using (false)
  with check (false);

create policy "deny direct access to sandbox events"
  on private.store_sandbox_payment_events
  for all to public
  using (false)
  with check (false);
