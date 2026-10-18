create table if not exists private.melhor_envio_tokens (
  id boolean primary key default true check (id = true),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
revoke all on table private.melhor_envio_tokens from public, anon, authenticated;

create or replace function public.store_melhor_envio_token(
  p_access_token text,
  p_refresh_token text,
  p_expires_in integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_access_token,'') = '' or coalesce(p_refresh_token,'') = '' or p_expires_in < 60 then
    raise exception 'invalid_provider_token';
  end if;
  insert into private.melhor_envio_tokens(id,access_token,refresh_token,expires_at,updated_at)
  values(true,p_access_token,p_refresh_token,now()+make_interval(secs=>p_expires_in),now())
  on conflict(id) do update set access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,updated_at=now();
end;
$$;
revoke all on function public.store_melhor_envio_token(text,text,integer) from public, anon, authenticated;
grant execute on function public.store_melhor_envio_token(text,text,integer) to service_role;

create or replace function public.get_melhor_envio_token()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('access_token',access_token,'refresh_token',refresh_token,'expires_at',expires_at)
  from private.melhor_envio_tokens where id=true;
$$;
revoke all on function public.get_melhor_envio_token() from public, anon, authenticated;
grant execute on function public.get_melhor_envio_token() to service_role;
