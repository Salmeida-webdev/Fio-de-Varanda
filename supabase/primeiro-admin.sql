-- Execute no SQL Editor do projeto Supabase depois de criar o usuário
-- em Authentication → Users. Substitua pelo e-mail exato da conta.
insert into public.admin_profiles (user_id, display_name)
select id, 'Segundo Almeida'
from auth.users
where lower(email) = lower('SEU_EMAIL_ADMIN')
  and email_confirmed_at is not null;
