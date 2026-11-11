-- 0022 · Админы платформы (OWO Ads) видят все бизнесы установки: Barowo, кабинет агентства,
-- все бизнесы клиентов — старые и будущие. Решение 023.
-- Участие — роль admin с пометкой is_service: клиент видит обслуживающий аккаунт, но удалить
-- его не может; в платные места абонемента он не входит (billable_seats).

-- Новый бизнес: сразу добавляем всех админов платформы (кроме создателя — он станет владельцем).
create function public.add_platform_admins() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (organization_id, user_id, role, is_service)
  select new.id, u.id, 'admin', true from auth.users u
  where u.is_platform_admin and u.id is distinct from (select auth.uid())
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.add_platform_admins() from public, anon, authenticated;
create trigger organization_platform_admins after insert on public.organizations
  for each row execute function public.add_platform_admins();

-- Дозаполнить участие во всех существующих бизнесах (зовётся при каждом запуске приложения,
-- после того как из переменных Railway создан/обновлён админ). Существующие роли не трогает.
create function public.sync_platform_admin_memberships() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.memberships (organization_id, user_id, role, is_service)
  select o.id, u.id, 'admin', true from public.organizations o cross join auth.users u
  where u.is_platform_admin
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.sync_platform_admin_memberships() from public, anon, authenticated;

select public.sync_platform_admin_memberships();
