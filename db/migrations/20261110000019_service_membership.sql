-- Сервисное участие OWO Ads в фирме клиента.
--
-- Клиент видит этот аккаунт в списке команды с отдельной подписью — ничего не прячем,
-- это важно и для доверия, и для RODO. Но владелец клиента не может его удалить или
-- понизить в правах: иначе агентство теряет доступ к системе, которую обслуживает.
-- Снять отметку может только администратор платформы.

alter table public.memberships add column is_service boolean not null default false;

comment on column public.memberships.is_service is
  'Обслуживающий аккаунт агентства: виден клиенту, но снять его может только админ платформы.';

-- Админ платформы определяется по auth.users; функция нужна в политиках RLS.
create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select u.is_platform_admin from auth.users u where u.id = (select auth.uid())),
    false
  );
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Удаление: владельца нельзя никому, сервисный аккаунт — только админу платформы.
drop policy "admins remove memberships" on public.memberships;
create policy "admins remove memberships" on public.memberships
  for delete to authenticated
  using (
    role <> 'owner'
    and (not is_service or (select public.is_platform_admin()))
    and (select public.has_role(organization_id, array['owner', 'admin']::public.member_role[]))
  );

-- Смена роли: те же правила, иначе сервисный аккаунт можно просто понизить до member.
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
  update public.memberships set role = p_role where organization_id = p_organization and user_id = p_user;
end;
$$;

-- Список команды отдаёт признак, чтобы подписать строку в интерфейсе.
drop function public.team_members(uuid);
create function public.team_members(p_organization uuid)
returns table (user_id uuid, role public.member_role, name text, login text, is_service boolean, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role,
    coalesce(nullif(m.display_name, ''), nullif(p.full_name, ''), u.email) as name,
    u.email as login, m.is_service, m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.organization_id = p_organization and public.is_member(p_organization)
  order by m.created_at;
$$;
revoke all on function public.team_members(uuid) from public, anon;
grant execute on function public.team_members(uuid) to authenticated;

-- Отметить своё участие обслуживающим: вызывает создатель бизнеса (админ платформы).
create function public.mark_service_membership(p_organization uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.memberships set is_service = true
   where organization_id = p_organization and user_id = (select auth.uid());
end;
$$;
revoke all on function public.mark_service_membership(uuid) from public, anon;
grant execute on function public.mark_service_membership(uuid) to authenticated;
