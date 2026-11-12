-- Доступ команды OWO Ads ко кабинетам клиентов.
--
-- Было: сервисную строку получал только тот, кто нажал «создать бизнес». Второй владелец
-- агентства в кабинет клиента попасть не мог, хотя именно он ведёт рекламу и переписку.
-- Стало: доступ следует из участия в кабинете агентства — владельцы и админы OWO Ads
-- автоматически становятся обслуживающими участниками каждого своего клиента, а при
-- понижении или уходе из агентства теряют его. Клиент эти строки видит, но снять не может
-- (правила из миграции 19 остаются в силе). Роль в кабинете клиента — admin: настроить
-- и вести можно всё, но единственным владельцем остаётся сам клиент.

-- ───────────────────────── Синхронизация одного кабинета ─────────────────────────
create function public.agency_sync_service_access(p_client_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid; v_fresh uuid[];
begin
  select ac.organization_id into v_agency
    from public.agency_clients ac
   where ac.client_org_id = p_client_org
   order by ac.created_at limit 1;
  if v_agency is null then return; end if;

  -- Добавить и пометить всех владельцев/админов агентства.
  -- Новая строка не должна будить команду по каждому лиду клиента: уведомления
  -- в чужом кабинете выключаем сразу, включить их можно вручную в настройках.
  with added as (
    insert into public.memberships (organization_id, user_id, role, is_service)
    select p_client_org, m.user_id, 'admin'::public.member_role, true
      from public.memberships m
     where m.organization_id = v_agency
       and m.role in ('owner', 'admin')
    on conflict (organization_id, user_id) do update set is_service = true
    returning user_id, (xmax = 0) as fresh
  )
  select array_agg(user_id) filter (where fresh) into v_fresh from added;

  -- Отдельным запросом: настройки создаёт триггер на memberships, он срабатывает
  -- по завершении вставки, поэтому раньше выключать нечего.
  if v_fresh is not null then
    update public.notification_settings set enabled = false
     where organization_id = p_client_org and user_id = any(v_fresh);
  end if;

  -- Убрать сервисные строки тех, кто уже не владелец и не админ агентства.
  delete from public.memberships d
   where d.organization_id = p_client_org
     and d.is_service
     and not exists (
       select 1 from public.memberships m
        where m.organization_id = v_agency and m.user_id = d.user_id
          and m.role in ('owner', 'admin')
     );
end;
$$;
revoke all on function public.agency_sync_service_access(uuid) from public, anon;

-- ───────────────────────── Триггеры ─────────────────────────
-- Новый клиент с кабинетом (или кабинет привязали позже) — выдать доступ всей команде.
create function public.agency_clients_sync_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.client_org_id is not null then
    perform public.agency_sync_service_access(new.client_org_id);
  end if;
  return null;
end;
$$;

create trigger agency_clients_sync_access
  after insert or update of client_org_id on public.agency_clients
  for each row execute function public.agency_clients_sync_access();

-- Состав агентства поменялся — пересчитать доступ по всем его клиентам.
create function public.memberships_sync_agency_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := coalesce(new.organization_id, old.organization_id); v_client uuid;
begin
  -- Только для кабинета самого агентства; сервисные строки у клиентов не трогаем.
  if coalesce(new.is_service, old.is_service, false) then return null; end if;
  if not exists (select 1 from public.organizations o
                  where o.id = v_org and o.industry_preset = 'agency') then
    return null;
  end if;
  for v_client in
    select ac.client_org_id from public.agency_clients ac
     where ac.organization_id = v_org and ac.client_org_id is not null
  loop
    perform public.agency_sync_service_access(v_client);
  end loop;
  return null;
end;
$$;

create trigger memberships_sync_agency_access
  after insert or delete or update of role on public.memberships
  for each row execute function public.memberships_sync_agency_access();

-- ───────────────────────── Задним числом ─────────────────────────
do $$
declare v_client uuid;
begin
  for v_client in
    select distinct ac.client_org_id from public.agency_clients ac
     where ac.client_org_id is not null
  loop
    perform public.agency_sync_service_access(v_client);
  end loop;
end $$;
