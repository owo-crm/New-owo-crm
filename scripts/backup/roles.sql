-- Роли кластера не попадают в pg_dump (они общие для всего сервера, а не для одной базы).
-- Перед восстановлением их нужно создать — тем же блоком, что в миграции 0000_platform.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
do $$ begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
exception when others then null;
end $$;
