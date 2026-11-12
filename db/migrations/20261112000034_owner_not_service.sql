-- Владелец кабинета — всегда свой человек; агентство в чужом кабинете — admin.
--
-- Ваня и Артём должны быть wlaścicielami и в OWO Ads, и в Barowo одновременно. Barowo при
-- этом зарегистрировано клиентом агентства, и синхронизация доступа (решение 038) помечала
-- их настоящее владение Barowo обслуживающим: они перестали бы считаться местами абонемента,
-- а чек-лист «владелец зашёл» не отмечался бы никогда.
--
-- Правило теперь одно и простое:
--   • role = 'owner' — человек клиента (создал кабинет или принял приглашение владельцем);
--   • is_service = true, role = 'admin' — доступ агентства, выданный автоматикой.
-- Автоматика создаёт только свои строки и никогда не переписывает чужие.

-- ───────────────────────── Синхронизация не трогает существующие строки ─────────────────────────
create or replace function public.agency_sync_service_access(p_client_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid; v_fresh uuid[];
begin
  select ac.organization_id into v_agency
    from public.agency_clients ac
   where ac.client_org_id = p_client_org
   order by ac.created_at limit 1;
  if v_agency is null then return; end if;

  -- do nothing, а не do update: если строка уже есть, она чужая (владелец кабинета или
  -- приглашённый сотрудник клиента) — её состав и роль решает клиент, не мы.
  with added as (
    insert into public.memberships (organization_id, user_id, role, is_service)
    select p_client_org, m.user_id, 'admin'::public.member_role, true
      from public.memberships m
     where m.organization_id = v_agency
       and m.role in ('owner', 'admin')
    on conflict (organization_id, user_id) do nothing
    returning user_id
  )
  select array_agg(user_id) into v_fresh from added;

  -- Уведомления в чужом кабинете выключаем сразу: иначе каждый новый клиент начинает
  -- будить всю команду по каждому лиду. Отдельным запросом — настройки создаёт триггер.
  if v_fresh is not null then
    update public.notification_settings set enabled = false
     where organization_id = p_client_org and user_id = any(v_fresh);
  end if;

  -- Забираем только свои строки: владение и роли людей клиента не наши.
  delete from public.memberships d
   where d.organization_id = p_client_org
     and d.is_service
     and d.role <> 'owner'
     and not exists (
       select 1 from public.memberships m
        where m.organization_id = v_agency and m.user_id = d.user_id
          and m.role in ('owner', 'admin')
     );
end;
$$;

-- ───────────────────────── Создатель кабинета клиента — не его владелец ─────────────────────────
-- create_organization делает создателя владельцем; для кабинета клиента это неверно:
-- владельцем станет сам клиент, когда примет приглашение. Мы остаёмся admin.
create or replace function public.mark_service_membership(p_organization uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.memberships
     set is_service = true, role = 'admin'::public.member_role
   where organization_id = p_organization and user_id = (select auth.uid());
end;
$$;

-- ───────────────────────── Приглашение сильнее сервисной строки ─────────────────────────
-- Было `do nothing`: приглашённый владелец, у которого уже есть сервисная строка,
-- молча оставался админом — ровно случай Вани в Barowo.
create or replace function public.accept_invitation(p_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_inv public.invitations; v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from public.invitations where token_hash = p_hash for update;
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'invitation invalid' using errcode = '22023';
  end if;
  insert into public.memberships (organization_id, user_id, role) values (v_inv.organization_id, v_user, v_inv.role)
  on conflict (organization_id, user_id) do update
    set role = case
                 when public.memberships.role = 'owner' or v_inv.role = 'owner' then 'owner'::public.member_role
                 when public.memberships.role = 'admin' or v_inv.role = 'admin' then 'admin'::public.member_role
                 else public.memberships.role
               end,
        is_service = public.memberships.is_service and v_inv.role <> 'owner';
  update public.invitations set accepted_by = v_user, accepted_at = now() where id = v_inv.id;
  return v_inv.organization_id;
end;
$$;

-- Назначение владельцем вручную тоже снимает отметку: владелец не обслуживающий аккаунт.
create or replace function public.set_member_role(p_organization uuid, p_user uuid, p_role public.member_role) returns void
language plpgsql security definer set search_path = '' as $$
declare v_service boolean;
begin
  if not public.has_role(p_organization, array['owner']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select m.is_service into v_service from public.memberships m
   where m.organization_id = p_organization and m.user_id = p_user;
  if coalesce(v_service, false) and not public.is_platform_admin() then
    raise exception 'service membership' using errcode = '42501';
  end if;
  if p_role <> 'owner' and (select count(*) from public.memberships where organization_id = p_organization and role = 'owner' and user_id <> p_user) = 0 then
    raise exception 'last owner' using errcode = '22023';
  end if;
  update public.memberships
     set role = p_role, is_service = is_service and p_role <> 'owner'
   where organization_id = p_organization and user_id = p_user;
end;
$$;

-- ───────────────────────── Привести уже помеченные строки к правилу ─────────────────────────
-- Обслуживающая строка с ролью owner — след прежнего поведения; делаем её admin.
update public.memberships set role = 'admin'::public.member_role where is_service and role = 'owner';
