-- 0000 · Платформа: роли и схема auth на обычном Postgres (замена Supabase Auth).
-- Приложение подключается владельцем базы и на время запроса пользователя делает
-- `set local role authenticated` + `request.jwt.claim.sub` = id пользователя → RLS работает как раньше.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
-- Владелец подключения должен уметь переключаться в эти роли (на managed Postgres без superuser).
do $$ begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
exception when others then null; -- superuser: уже может всё
end $$;


create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique check (email = lower(email) and char_length(email) <= 254),
  password_hash       text not null,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  is_platform_admin   boolean not null default false,
  created_at          timestamptz not null default now(),
  last_sign_in_at     timestamptz
);

-- Как в Supabase: id пользователя берётся из настройки транзакции.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
