-- 0036 · Ключи платформы, которые приложение создаёт само (решение 043): сейчас — пара VAPID
-- для push-уведомлений. Только сервер: RLS включён, прав у authenticated/anon нет.
create table public.platform_secrets (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.platform_secrets enable row level security;
revoke all on public.platform_secrets from anon, authenticated;
grant all on public.platform_secrets to service_role;
