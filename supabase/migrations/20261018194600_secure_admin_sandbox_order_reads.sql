create policy "admins read sandbox orders"
  on private.store_sandbox_orders
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admin_profiles ap
      where ap.user_id = (select auth.uid())
        and ap.role = 'admin'
        and ap.active is true
    )
  );

grant usage on schema private to authenticated;
grant select on table private.store_sandbox_orders to authenticated;
alter function public.admin_list_store_sandbox_orders() security invoker;
