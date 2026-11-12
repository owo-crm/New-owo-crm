-- 0027 · Услуги без цен, системные услуги и рекламный бюджет.
--
-- Решение владельца 12.11: у услуги нет цены. Услуга нужна только для двух вещей —
-- назначить ответственного (он получает фонд исполнителей 65 %) и разделить прибыль
-- по направлениям. Цена живёт в заказе, она каждый раз договорная.
--
-- Две услуги зашиты в систему: абонемент CRM и реклама. Их нельзя удалить или
-- переименовать — настраивается только ответственный. Остальные услуги заводятся руками.

-- ── Цены уходят ──────────────────────────────────────────────────────────────
alter table public.agency_services drop column default_price_grosze;
alter table public.agency_client_services drop column price_grosze;

-- ── Системные услуги: добавилась реклама ─────────────────────────────────────
alter table public.agency_services drop constraint agency_services_system_key_check;
alter table public.agency_services add constraint agency_services_system_key_check
  check (system_key in ('crm', 'ads'));

comment on column public.agency_services.system_key is
  'Зашитая услуга: crm — абонемент CRM, ads — реклама с бюджетом клиента. Имя и удаление заблокированы.';

-- Системную услугу нельзя удалить и переименовать: меняется только ответственный и active.
create function public.agency_protect_system_service() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null then
      raise exception 'system service cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.system_key is not null and (new.system_key is distinct from old.system_key or new.name <> old.name) then
    raise exception 'system service cannot be renamed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.agency_protect_system_service() from public, anon, authenticated;
create trigger agency_services_protect before update or delete on public.agency_services
  for each row execute function public.agency_protect_system_service();

-- ── Рекламный бюджет клиента ─────────────────────────────────────────────────
-- Бюджет принадлежит связке «клиент × услуга» и имеет смысл только у услуги 'ads'.
-- Это деньги клиента: в раздел 10/25/65 они не входят никогда.
alter table public.agency_client_services
  add column monthly_budget_grosze bigint
    check (monthly_budget_grosze is null or (monthly_budget_grosze >= 0 and monthly_budget_grosze <= 10000000000));

comment on column public.agency_client_services.monthly_budget_grosze is
  'Месячный рекламный бюджет клиента. Деньги клиента, в раздел прибыли не входят.';

grant update (active, note, monthly_budget_grosze) on public.agency_client_services to authenticated;
grant update (name, description, owner_id, kind, active) on public.agency_services to authenticated;

-- ── Подключённые рекламные кабинеты ──────────────────────────────────────────
-- Расход заполняет импорт статистики, которого пока нет: пока он не появится,
-- spend_synced_at остаётся пустым, и экран честно пишет «не подключено».
create table public.agency_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  platform text not null check (platform in ('google', 'meta')),
  external_id text not null check (char_length(external_id) between 1 and 64),
  label text check (char_length(label) <= 120),
  connected_at timestamptz not null default now(),
  -- Расход с начала текущего месяца, снимок последней синхронизации.
  spend_mtd_grosze bigint check (spend_mtd_grosze is null or spend_mtd_grosze >= 0),
  spend_month date,
  spend_synced_at timestamptz,
  unique (organization_id, id),
  unique (client_id, platform),
  foreign key (organization_id, client_id) references public.agency_clients(organization_id, id) on delete cascade
);

-- ── Подробности лида агентства ───────────────────────────────────────────────
-- Отдельной таблицей, чтобы не трогать public.leads: она общая для всех отраслей.
create table public.agency_lead_details (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  -- Кто привёл: по нему считается доля за приведение клиента.
  referred_by uuid references auth.users(id) on delete set null,
  -- Контактное лицо: у лида агентства это человек, а client_name — название фирмы.
  contact_name text check (char_length(contact_name) <= 200),
  -- Ожидаемый месячный рекламный бюджет, если среди услуг есть реклама.
  monthly_budget_grosze bigint
    check (monthly_budget_grosze is null or (monthly_budget_grosze >= 0 and monthly_budget_grosze <= 10000000000)),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, lead_id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade
);
create trigger agency_lead_details_updated_at before update on public.agency_lead_details
  for each row execute function public.set_updated_at();

-- Услуги, которые лид потенциально возьмёт. После превращения в клиента переносятся
-- в agency_client_services.
create table public.agency_lead_services (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  service_id uuid not null,
  primary key (organization_id, lead_id, service_id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, service_id) references public.agency_services(organization_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['agency_ad_accounts','agency_lead_details','agency_lead_services'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('create policy "members write" on public.%I for insert to authenticated with check (public.is_member(organization_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id))', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant update (label, external_id, spend_mtd_grosze, spend_month, spend_synced_at) on public.agency_ad_accounts to authenticated;
grant update (referred_by, contact_name, monthly_budget_grosze, note) on public.agency_lead_details to authenticated;

-- ── Зашитые услуги в кабинете агентства ─────────────────────────────────────
-- Вызывается и миграцией (для существующих кабинетов), и при создании нового кабинета:
-- кабинет агентства заводится при старте приложения, уже после миграций.
create function public.agency_ensure_system_services(p_organization uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.agency_services (organization_id, name, description, owner_id, kind, system_key)
  select o.id, v.name, v.description, m.user_id, v.kind, v.system_key
  from public.organizations o
  join lateral (
    select m.user_id from public.memberships m
    where m.organization_id = o.id
    order by (m.role <> 'owner'), m.created_at limit 1
  ) m on true
  cross join (values
    ('Abonament CRM', 'Usługa wbudowana. Opłaty za system trafiają tu automatycznie.', 'retainer', 'crm'),
    ('Reklama Meta i Google', 'Usługa wbudowana. Budżet reklamowy klienta rozliczany jest osobno.', 'retainer', 'ads')
  ) as v(name, description, kind, system_key)
  where o.id = p_organization and o.industry_preset = 'agency'
    and not exists (
      select 1 from public.agency_services s
      where s.organization_id = o.id and (s.system_key = v.system_key or s.name = v.name)
    );
$$;
revoke all on function public.agency_ensure_system_services(uuid) from public, anon;
grant execute on function public.agency_ensure_system_services(uuid) to authenticated, service_role;

select public.agency_ensure_system_services(id)
  from public.organizations where industry_preset = 'agency';

-- ── Клиент из лида забирает с собой услуги, бюджет и того, кто его привёл ────
create or replace function public.agency_client_from_lead(p_organization uuid, p_lead uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_lead public.leads; v_details public.agency_lead_details;
begin
  select ac.id into v_id from public.agency_clients ac where ac.organization_id = p_organization and ac.lead_id = p_lead;
  if found then return v_id; end if;
  select * into v_lead from public.leads l where l.organization_id = p_organization and l.id = p_lead and l.deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  select * into v_details from public.agency_lead_details d
   where d.organization_id = p_organization and d.lead_id = p_lead;

  insert into public.agency_clients (organization_id, name, contact_name, phone, email, city, lead_id, status, started_at, created_by)
  values (p_organization, v_lead.client_name,
          coalesce(nullif(v_details.contact_name, ''), v_lead.client_name),
          v_lead.phone_e164, v_lead.email, v_lead.event_city,
          p_lead, 'active', (now() at time zone 'Europe/Warsaw')::date, (select auth.uid()))
  returning id into v_id;

  -- Услуги, выбранные на этапе лида, становятся услугами клиента. Бюджет достаётся рекламе.
  insert into public.agency_client_services (organization_id, client_id, service_id, monthly_budget_grosze)
  select p_organization, v_id, ls.service_id,
         case when s.system_key = 'ads' then v_details.monthly_budget_grosze end
  from public.agency_lead_services ls
  join public.agency_services s on s.organization_id = ls.organization_id and s.id = ls.service_id
  where ls.organization_id = p_organization and ls.lead_id = p_lead
  on conflict (client_id, service_id) do nothing;

  return v_id;
end;
$$;
