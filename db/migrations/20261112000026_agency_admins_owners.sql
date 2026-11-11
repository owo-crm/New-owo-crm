-- 0026 · В кабинете самого агентства (пресет agency) админы платформы — владельцы, а не
-- «обслуживающий аккаунт» (решение 030). В бизнесах клиентов — как раньше: admin + is_service.

create or replace function public.add_platform_admins() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (organization_id, user_id, role, is_service)
  select new.id, u.id,
         case when new.industry_preset = 'agency' then 'owner'::public.member_role else 'admin'::public.member_role end,
         new.industry_preset <> 'agency'
  from auth.users u
  where u.is_platform_admin and u.id is distinct from (select auth.uid())
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.sync_platform_admin_memberships() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_fixed integer;
begin
  insert into public.memberships (organization_id, user_id, role, is_service)
  select o.id, u.id,
         case when o.industry_preset = 'agency' then 'owner'::public.member_role else 'admin'::public.member_role end,
         o.industry_preset <> 'agency'
  from public.organizations o cross join auth.users u
  where u.is_platform_admin
  on conflict do nothing;
  get diagnostics v_count = row_count;
  -- Исправить уже созданных: в кабинете агентства админ платформы — владелец, не сервис.
  update public.memberships m set role = 'owner', is_service = false
  from public.organizations o, auth.users u
  where o.id = m.organization_id and u.id = m.user_id
    and o.industry_preset = 'agency' and u.is_platform_admin
    and (m.role <> 'owner' or m.is_service);
  get diagnostics v_fixed = row_count;
  return v_count + v_fixed;
end;
$$;
revoke all on function public.sync_platform_admin_memberships() from public, anon, authenticated;

select public.sync_platform_admin_memberships();
