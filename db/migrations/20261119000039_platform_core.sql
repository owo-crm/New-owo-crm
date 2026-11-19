-- 0039 · M1.3 Platform Core: явные связи агентства с организациями, сотрудники платформы,
-- журнал аудита, сервисные допуски (docs/architecture/OWO_CRM_MIGRATION_PLAN.md M1.3, D-02, D-21).
--
-- Источник истины отношений «агентство ↔ организация» — platform_managed_orgs, а не agency_clients
-- (её заполняла старая автопривязка при старте, отключена в M1.1).
--   relation = 'client'  — клиент OWO Ads (новый бизнес, созданный OWO, — автоматически);
--   relation = 'service' — команда OWO обслуживает организацию, коммерческих отношений нет (Barowo).
-- Классификация существующих организаций утверждена владельцем 2026-11-19:
--   OWO Ads — agency (кабинет агентства, строки нет), Barowo — service. Других организаций нет.
-- Финансовые таблицы и agency_clients не меняются (запись Barowo ждёт M1.5).

-- ───────────────────────── Сотрудники платформы ─────────────────────────
create table public.platform_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level text not null default 'architect' check (level in ('architect', 'operator')),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

-- ───────────────────────── Журнал аудита (append-only) ─────────────────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid,                                  -- null = миграция / система
  action text not null check (char_length(action) between 1 and 80),
  entity text not null check (char_length(entity) between 1 and 80),
  entity_id text,
  before jsonb,
  after jsonb,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (organization_id, created_at desc);

-- ───────────────────────── Связи агентства с организациями ─────────────────────────
create table public.platform_managed_orgs (
  agency_org_id uuid not null references public.organizations(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  relation text not null check (relation in ('service', 'client')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  note text check (char_length(note) <= 500),
  primary key (agency_org_id, org_id),
  check (agency_org_id <> org_id)
);
create index platform_managed_orgs_org_idx on public.platform_managed_orgs (org_id);

-- Сервисный допуск сотрудника OWO с причиной и сроком (используется с M4.2 для чувствительных данных).
create table public.organization_service_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  granted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index organization_service_grants_idx on public.organization_service_grants (organization_id, user_id, expires_at);

-- RLS: читать — админы платформы и участники кабинета агентства (свои связи); писать — только
-- функциями/сервисом. Клиенты не видят и не меняют эти таблицы.
alter table public.platform_staff enable row level security;
alter table public.audit_log enable row level security;
alter table public.platform_managed_orgs enable row level security;
alter table public.organization_service_grants enable row level security;
create policy "platform admins read" on public.platform_staff for select to authenticated
  using (public.is_platform_admin());
create policy "platform admins read" on public.audit_log for select to authenticated
  using (public.is_platform_admin() or (organization_id is not null
         and public.has_role(organization_id, array['owner']::public.member_role[])));
create policy "agency members read" on public.platform_managed_orgs for select to authenticated
  using (public.is_platform_admin() or public.is_member(agency_org_id));
create policy "platform admins read" on public.organization_service_grants for select to authenticated
  using (public.is_platform_admin() or public.has_role(organization_id, array['owner']::public.member_role[]));
revoke all on public.platform_staff, public.audit_log, public.platform_managed_orgs,
  public.organization_service_grants from anon, authenticated;
grant select on public.platform_staff, public.audit_log, public.platform_managed_orgs,
  public.organization_service_grants to authenticated;
grant all on public.platform_staff, public.audit_log, public.platform_managed_orgs,
  public.organization_service_grants to service_role;

-- ───────────────────────── Заполнение по утверждённой классификации ─────────────────────────
insert into public.platform_staff (user_id, level, note)
select id, 'architect', 'z is_platform_admin (M1.3)' from auth.users where is_platform_admin
on conflict do nothing;

do $$
declare
  v_agency uuid;
  r record;
begin
  for r in
    select o.id, o.name from public.organizations o where o.industry_preset <> 'agency' order by o.created_at
  loop
    if r.name !~* 'barowo' then
      -- Не входит в утверждённый список — связь не создаётся (решение владельца).
      raise notice 'M1.3: organizacja % (%) bez relacji — nie ma jej na zatwierdzonej liście', r.name, r.id;
      continue;
    end if;
    -- Агентство — явно: из существующей строки agency_clients этой организации; иначе —
    -- единственный кабинет агентства (если их несколько — без связи, решать вручную).
    select ac.organization_id into v_agency from public.agency_clients ac
      where ac.client_org_id = r.id order by ac.created_at limit 1;
    if v_agency is null then
      select case when count(*) = 1 then min(o.id::text)::uuid end into v_agency
        from public.organizations o where o.industry_preset = 'agency';
    end if;
    if v_agency is null then
      raise notice 'M1.3: % — nie da się jednoznacznie ustalić agencji, relacja nie utworzona', r.name;
      continue;
    end if;
    insert into public.platform_managed_orgs (agency_org_id, org_id, relation, note)
      values (v_agency, r.id, 'service', 'Barowo — firma Ivana, nie klient OWO Ads (decyzja właściciela 2026-11-19)')
      on conflict do nothing;
    insert into public.audit_log (organization_id, action, entity, entity_id, after, note)
      values (r.id, 'relation.create', 'platform_managed_orgs', r.id::text,
              jsonb_build_object('agency_org_id', v_agency, 'relation', 'service'),
              'M1.3: klasyfikacja zatwierdzona przez właściciela 2026-11-19');
  end loop;
end $$;

-- ───────────────────────── Доступ агентства — из platform_managed_orgs ─────────────────────────
create or replace function public.manages_organization(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.platform_managed_orgs p
    join public.memberships m on m.organization_id = p.agency_org_id and m.user_id = (select auth.uid())
    where p.org_id = org
  );
$$;

create or replace function public.agency_sync_service_access(p_client_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid; v_fresh uuid[];
begin
  select p.agency_org_id into v_agency
    from public.platform_managed_orgs p
   where p.org_id = p_client_org
   order by p.approved_at limit 1;
  if v_agency is null then return; end if;

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

  if v_fresh is not null then
    update public.notification_settings set enabled = false
     where organization_id = p_client_org and user_id = any(v_fresh);
  end if;

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

create or replace function public.memberships_sync_agency_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := coalesce(new.organization_id, old.organization_id); v_client uuid;
begin
  if coalesce(new.is_service, old.is_service, false) then return null; end if;
  if not exists (select 1 from public.organizations o
                  where o.id = v_org and o.industry_preset = 'agency') then
    return null;
  end if;
  for v_client in
    select p.org_id from public.platform_managed_orgs p where p.agency_org_id = v_org
  loop
    perform public.agency_sync_service_access(v_client);
  end loop;
  return null;
end;
$$;

-- Явное создание связи в кабинете агентства («Nowy biznes», мастер «Utwórz CRM klienta»,
-- «Powiąż z istniejącym biznesem») → relation = 'client' (D-02). Существующую связь
-- (например, 'service' у Barowo) не переписываем.
create or replace function public.agency_clients_sync_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.client_org_id is not null then
    insert into public.platform_managed_orgs (agency_org_id, org_id, relation, approved_by, note)
      values (new.organization_id, new.client_org_id, 'client', new.created_by,
              'Utworzono w kabinecie agencji (D-02)')
      on conflict (agency_org_id, org_id) do nothing;
    perform public.agency_sync_service_access(new.client_org_id);
  end if;
  return null;
end;
$$;

-- Связь добавили напрямую (миграция, админ) — выдать сервисный доступ команде агентства.
create function public.platform_managed_orgs_sync_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.agency_sync_service_access(new.org_id);
  return null;
end;
$$;
create trigger platform_managed_orgs_sync_access
  after insert on public.platform_managed_orgs
  for each row execute function public.platform_managed_orgs_sync_access();
revoke all on function public.platform_managed_orgs_sync_access() from public, anon, authenticated;
