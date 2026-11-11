-- 0020 · Кабинет агентства OWO Ads (пресет 'agency'): клиенты агентства, проданные заказы,
-- часы исполнителей, раздел денег и чек-лист настройки CRM клиента.
-- Описание: docs/02-data-model.md (раздел «Agencja»), решение 018 в docs/decisions.md.
-- С деньгами Barowo (lead_payments) не пересекается: другие таблицы и другие экраны.

-- ───────── Доли раздела: параметр организации, не число в формуле ─────────
-- Храним в базисных пунктах (1 % = 100), чтобы считать целыми числами и в SQL, и в TypeScript.
-- Значения по умолчанию дублируются в lib/agency/split.ts (DEFAULT_SHARES) — менять вместе.
alter table public.organizations
  add column agency_share_sale_bp integer not null default 1000 check (agency_share_sale_bp between 0 and 10000),
  add column agency_share_company_bp integer not null default 2500 check (agency_share_company_bp between 0 and 10000),
  add column agency_share_work_bp integer not null default 6500 check (agency_share_work_bp between 0 and 10000),
  add constraint organizations_agency_shares_sum
    check (agency_share_sale_bp + agency_share_company_bp + agency_share_work_bp = 10000);
grant update (agency_share_sale_bp, agency_share_company_bp, agency_share_work_bp)
  on public.organizations to authenticated;

-- ───────── Воронка агентства ─────────
-- Ключи 'new' и 'rejected' общие с Barowo: на них завязаны значения по умолчанию и отчёты.
create or replace function public.seed_lead_stages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.industry_preset = 'agency' then
    insert into public.pipeline_stages (organization_id, key, label_pl, position, kind) values
      (new.id, 'new', 'Nowy', 0, 'open'),
      (new.id, 'contacted', 'Kontakt', 1, 'open'),
      (new.id, 'meeting', 'Spotkanie', 2, 'open'),
      (new.id, 'offer_sent', 'Oferta', 3, 'open'),
      (new.id, 'client', 'Klient', 4, 'won'),
      (new.id, 'rejected', 'Odrzucony', 5, 'lost'),
      (new.id, 'spam', 'Spam', 6, 'lost');
    return new;
  end if;
  insert into public.pipeline_stages (organization_id, key, label_pl, position, kind) values
    (new.id, 'new', 'Nowy', 0, 'open'),
    (new.id, 'contacted', 'Skontaktowano', 1, 'open'),
    (new.id, 'offer_sent', 'Oferta wysłana', 2, 'open'),
    (new.id, 'offer_accepted', 'Oferta zaakceptowana', 3, 'open'),
    (new.id, 'contract_sent', 'Umowa wysłana', 4, 'open'),
    (new.id, 'contract_signed', 'Umowa podpisana', 5, 'won'),
    (new.id, 'deposit_paid', 'Zadatek wpłacony', 6, 'won'),
    (new.id, 'rejected', 'Odrzucony', 7, 'lost'),
    (new.id, 'spam', 'Spam', 8, 'lost');
  return new;
end;
$$;

-- ───────── Клиенты агентства ─────────
create table public.agency_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  nip text check (nip ~ '^[0-9]{10}$'),
  contact_name text check (char_length(contact_name) <= 200),
  phone text check (char_length(phone) <= 40),
  email text check (email = lower(email) and char_length(email) <= 254),
  city text check (char_length(city) <= 120),
  -- Мост между кабинетом агентства и CRM клиента: его организация в этой же установке.
  client_org_id uuid references public.organizations(id) on delete set null,
  -- Лид агентства, из которого завели клиента (кнопка на этапе «Klient»).
  lead_id uuid references public.leads(id) on delete set null,
  status text not null default 'lead' check (status in ('lead', 'active', 'paused', 'lost')),
  started_at date,
  note text check (char_length(note) <= 4000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (client_org_id is null or client_org_id <> organization_id)
);
create unique index agency_clients_client_org_idx on public.agency_clients (organization_id, client_org_id) where client_org_id is not null;
create unique index agency_clients_lead_idx on public.agency_clients (organization_id, lead_id) where lead_id is not null;
create index agency_clients_name_idx on public.agency_clients (organization_id, name);
create trigger agency_clients_updated_at before update on public.agency_clients
  for each row execute function public.set_updated_at();

-- ───────── Проданные заказы ─────────
-- Одна строка = один заказ. Абонемент = строка на каждый месяц.
-- period_month есть у всех заказов: это «месяц учёта», по нему строятся сводки.
create table public.agency_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null check (kind in ('retainer', 'project')),
  amount_grosze bigint not null check (amount_grosze >= 0 and amount_grosze <= 10000000000),
  -- Подрядчики, печать, шаблоны, дальние поездки — вычитаются до раздела.
  direct_costs_grosze bigint not null default 0 check (direct_costs_grosze >= 0),
  -- Рекламный бюджет клиента (Meta/Google): только для отчёта, в раздел не входит никогда.
  ad_budget_grosze bigint not null default 0 check (ad_budget_grosze >= 0 and ad_budget_grosze <= 10000000000),
  sold_by uuid references auth.users(id) on delete set null,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  status text not null default 'draft' check (status in ('draft', 'invoiced', 'paid', 'cancelled')),
  due_date date,
  paid_at timestamptz,
  note text check (char_length(note) <= 4000),
  -- Заказ скопирован кнопкой «повторить прошлый месяц» из этого заказа (защита от дублей).
  repeated_from uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.agency_clients(organization_id, id) on delete cascade,
  check (direct_costs_grosze <= amount_grosze),
  check ((status = 'paid') = (paid_at is not null))
);
create index agency_orders_month_idx on public.agency_orders (organization_id, period_month);
create index agency_orders_client_idx on public.agency_orders (organization_id, client_id, period_month desc);
create index agency_orders_due_idx on public.agency_orders (organization_id, due_date) where status = 'invoiced';
create unique index agency_orders_repeat_idx on public.agency_orders (organization_id, repeated_from) where repeated_from is not null;
create trigger agency_orders_updated_at before update on public.agency_orders
  for each row execute function public.set_updated_at();

-- ───────── Часы исполнителей ─────────
create table public.agency_order_work (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  hours numeric(6,2) not null check (hours > 0 and hours <= 500),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (order_id, user_id),
  foreign key (organization_id, order_id) references public.agency_orders(organization_id, id) on delete cascade
);
create index agency_order_work_user_idx on public.agency_order_work (organization_id, user_id);

-- Продавец и исполнители — только участники агентства (иначе деньги «уйдут» постороннему).
create function public.agency_check_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  -- to_jsonb: у двух таблиц разные имена колонки (sold_by / user_id).
  v_user := (to_jsonb(new) ->> case tg_table_name when 'agency_orders' then 'sold_by' else 'user_id' end)::uuid;
  if v_user is not null and not exists (
    select 1 from public.memberships m where m.organization_id = new.organization_id and m.user_id = v_user
  ) then
    raise exception 'user is not a member of this organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.agency_check_member() from public, anon, authenticated;
create trigger agency_orders_member before insert or update of sold_by on public.agency_orders
  for each row execute function public.agency_check_member();
create trigger agency_order_work_member before insert or update of user_id on public.agency_order_work
  for each row execute function public.agency_check_member();

-- Связать клиента можно только с организацией, в которой ты сам состоишь (или ты админ платформы):
-- иначе через чек-лист можно было бы «подглядывать» за чужой фирмой.
create function public.agency_check_client_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.client_org_id is not null
     and (tg_op = 'INSERT' or new.client_org_id is distinct from old.client_org_id)
     and (select auth.uid()) is not null
     and not public.is_member(new.client_org_id) and not public.is_platform_admin() then
    raise exception 'not a member of the client organization' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.agency_check_client_org() from public, anon, authenticated;
create trigger agency_clients_client_org before insert or update of client_org_id on public.agency_clients
  for each row execute function public.agency_check_client_org();

-- ───────── Справочник шагов настройки CRM клиента ─────────
-- Общий для всех агентств (как справочник, без organization_id): шаги меняются миграцией.
-- Названия шагов — в messages/pl.json (agency.steps.<key>). auto = отмечается по фактам в базе.
create table public.agency_setup_steps (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  position integer not null unique,
  auto boolean not null
);
insert into public.agency_setup_steps (key, position, auto) values
  ('org_created', 1, true),
  ('service_member', 2, true),
  ('branding', 3, false),
  ('stages', 4, false),
  ('intake_channel', 5, true),
  ('form_connected', 6, true),
  ('documents', 7, false),
  ('notifications', 8, false),
  ('owner_invited', 9, true),
  ('owner_joined', 10, true),
  ('handover', 11, false);
alter table public.agency_setup_steps enable row level security;
create policy "everyone reads steps" on public.agency_setup_steps for select to authenticated using (true);
revoke all on public.agency_setup_steps from anon, authenticated;
grant select on public.agency_setup_steps to authenticated;
grant all on public.agency_setup_steps to service_role;

-- Ручные отметки (только для шагов с auto = false).
create table public.agency_setup_marks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  step_key text not null references public.agency_setup_steps(key),
  done_at timestamptz not null default now(),
  done_by uuid,
  note text check (char_length(note) <= 500),
  primary key (organization_id, client_id, step_key),
  foreign key (organization_id, client_id) references public.agency_clients(organization_id, id) on delete cascade
);

create function public.agency_check_manual_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select s.auto from public.agency_setup_steps s where s.key = new.step_key) then
    raise exception 'step is checked automatically' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.agency_check_manual_step() from public, anon, authenticated;
create trigger agency_setup_marks_manual before insert or update on public.agency_setup_marks
  for each row execute function public.agency_check_manual_step();

-- ───────── RLS ─────────
do $$
declare t text;
begin
  foreach t in array array['agency_clients','agency_orders','agency_order_work','agency_setup_marks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('create policy "members write" on public.%I for insert to authenticated with check (public.is_member(organization_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- Удалять клиентов и заказы — только owner/admin; часы и ручные отметки — любой участник.
create policy "admins delete" on public.agency_clients for delete to authenticated
  using (public.has_role(organization_id, array['owner','admin']::public.member_role[]));
create policy "admins delete" on public.agency_orders for delete to authenticated
  using (public.has_role(organization_id, array['owner','admin']::public.member_role[]));
create policy "members delete" on public.agency_order_work for delete to authenticated
  using (public.is_member(organization_id));
create policy "members delete" on public.agency_setup_marks for delete to authenticated
  using (public.is_member(organization_id));

grant select, insert, delete on public.agency_clients, public.agency_orders,
  public.agency_order_work, public.agency_setup_marks to authenticated;
grant update (name, nip, contact_name, phone, email, city, client_org_id, status, started_at, note)
  on public.agency_clients to authenticated;
grant update (client_id, title, kind, amount_grosze, direct_costs_grosze, ad_budget_grosze, sold_by,
              period_month, status, due_date, paid_at, note)
  on public.agency_orders to authenticated;
grant update (hours, note) on public.agency_order_work to authenticated;
grant update (done_at, done_by, note) on public.agency_setup_marks to authenticated;

-- ───────── Раздел денег по заказу: единственное место, где живёт формула ─────────
-- база = сумма − прямые расходы (рекламный бюджет не участвует никогда);
-- продажа → sold_by, компания → user_id null, работа → исполнителям пропорционально часам.
-- Всё целыми грошами вниз; остаток от округления — компании. Сумма строк = база до гроша.
-- Нет продавца или нет часов → строка с user_id = null («не распределено»), не прячем.
-- TypeScript-копия для живого расчёта в форме: lib/agency/split.ts (тесты сверяют обе).
create function public.agency_order_split(p_organization uuid, p_order uuid)
returns table (user_id uuid, role text, amount_grosze bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_order public.agency_orders;
  v_org public.organizations;
  v_base bigint; v_sale bigint; v_work bigint; v_given bigint := 0; v_total_h bigint;
  r record;
begin
  select * into v_order from public.agency_orders o where o.organization_id = p_organization and o.id = p_order;
  if not found then return; end if;
  select * into v_org from public.organizations o where o.id = p_organization;

  v_base := v_order.amount_grosze - v_order.direct_costs_grosze;
  v_sale := v_base * v_org.agency_share_sale_bp / 10000;
  v_work := v_base * v_org.agency_share_work_bp / 10000;

  user_id := v_order.sold_by; role := 'sale'; amount_grosze := v_sale; return next;

  select coalesce(sum((w.hours * 100)::bigint), 0) into v_total_h
  from public.agency_order_work w where w.organization_id = p_organization and w.order_id = p_order;

  if v_total_h = 0 then
    user_id := null; role := 'work'; amount_grosze := v_work; v_given := v_work; return next;
  else
    for r in
      select w.user_id as u, (w.hours * 100)::bigint as h from public.agency_order_work w
      where w.organization_id = p_organization and w.order_id = p_order order by w.created_at, w.id
    loop
      user_id := r.u; role := 'work'; amount_grosze := v_work * r.h / v_total_h;
      v_given := v_given + amount_grosze;
      return next;
    end loop;
  end if;

  user_id := null; role := 'company'; amount_grosze := v_base - v_sale - v_given; return next;
end;
$$;
revoke all on function public.agency_order_split(uuid, uuid) from public, anon;
grant execute on function public.agency_order_split(uuid, uuid) to authenticated, service_role;

-- ───────── Чек-лист настройки: автоматические и ручные отметки ─────────
-- security definer: факты лежат в организации клиента, куда сотрудник агентства может не входить.
-- Наружу уходит только «сделано / когда» по каждому шагу — сами данные клиента не читаются.
-- Доступ: только участник агентства, к которому привязан клиент.
create function public.agency_setup_status(p_organization uuid, p_client uuid default null)
returns table (client_id uuid, step_key text, step_position integer, auto boolean,
               done_at timestamptz, done_by uuid, note text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_member(p_organization) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with c as (
    select ac.id, ac.client_org_id from public.agency_clients ac
    where ac.organization_id = p_organization and (p_client is null or ac.id = p_client)
  ),
  agency_users as (select m.user_id from public.memberships m where m.organization_id = p_organization),
  facts as (
    select c.id, 'org_created'::text as k, o.created_at as ts from c join public.organizations o on o.id = c.client_org_id
    union all
    select c.id, 'service_member', min(m.created_at) from c join public.memberships m
      on m.organization_id = c.client_org_id and m.is_service group by c.id
    union all
    select c.id, 'intake_channel', min(ch.created_at) from c join public.channels ch
      on ch.organization_id = c.client_org_id and ch.type = 'website' and ch.status = 'active' group by c.id
    union all
    select c.id, 'form_connected', min(il.received_at) from c join public.intake_log il
      on il.organization_id = c.client_org_id and il.ok group by c.id
    union all
    select c.id, 'owner_invited', min(i.created_at) from c join public.invitations i
      on i.organization_id = c.client_org_id and i.role = 'owner' and i.revoked_at is null group by c.id
    union all
    select c.id, 'owner_joined', min(m.created_at) from c join public.memberships m
      on m.organization_id = c.client_org_id and m.role = 'owner' and not m.is_service
      and m.user_id not in (select au.user_id from agency_users au) group by c.id
  )
  select c.id, s.key, s.position, s.auto,
         case when s.auto then f.ts else mk.done_at end,
         case when s.auto then null else mk.done_by end,
         case when s.auto then null else mk.note end
  from c cross join public.agency_setup_steps s
  left join facts f on s.auto and f.id = c.id and f.k = s.key
  left join public.agency_setup_marks mk on not s.auto and mk.organization_id = p_organization
    and mk.client_id = c.id and mk.step_key = s.key
  order by c.id, s.position;
end;
$$;
revoke all on function public.agency_setup_status(uuid, uuid) from public, anon;
grant execute on function public.agency_setup_status(uuid, uuid) to authenticated;

-- ───────── Клиент агентства из лида (этап «Klient») ─────────
-- Повторное нажатие возвращает уже созданного клиента, дубля не будет.
create function public.agency_client_from_lead(p_organization uuid, p_lead uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_lead public.leads;
begin
  select ac.id into v_id from public.agency_clients ac where ac.organization_id = p_organization and ac.lead_id = p_lead;
  if found then return v_id; end if;
  select * into v_lead from public.leads l where l.organization_id = p_organization and l.id = p_lead and l.deleted_at is null;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  insert into public.agency_clients (organization_id, name, contact_name, phone, email, city, lead_id, status, started_at, created_by)
  values (p_organization, v_lead.client_name, v_lead.client_name, v_lead.phone_e164, v_lead.email, v_lead.event_city,
          p_lead, 'active', (now() at time zone 'Europe/Warsaw')::date, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.agency_client_from_lead(uuid, uuid) from public, anon;
grant execute on function public.agency_client_from_lead(uuid, uuid) to authenticated;

-- ───────── «Повторить абонементы прошлого месяца» ─────────
-- Копирует абонементы предыдущего месяца (кроме отменённых) вместе со строками часов
-- как черновики; название месяца в заголовке меняется на новый. Повторный запуск дублей не создаёт.
create function public.agency_repeat_retainers(p_organization uuid, p_month date)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_prev date := (date_trunc('month', p_month) - interval '1 month')::date;
  v_names text[] := array['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
  v_count integer := 0;
  v_new uuid;
  r public.agency_orders;
begin
  for r in
    select o.* from public.agency_orders o
    where o.organization_id = p_organization and o.kind = 'retainer' and o.period_month = v_prev
      and o.status <> 'cancelled'
      and not exists (select 1 from public.agency_orders x where x.organization_id = p_organization and x.repeated_from = o.id)
    order by o.created_at
  loop
    insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, direct_costs_grosze,
      ad_budget_grosze, sold_by, period_month, status, due_date, note, repeated_from, created_by)
    values (p_organization, r.client_id,
      replace(r.title, v_names[extract(month from v_prev)::int], v_names[extract(month from v_month)::int]),
      'retainer', r.amount_grosze, r.direct_costs_grosze, r.ad_budget_grosze, r.sold_by, v_month, 'draft',
      (r.due_date + interval '1 month')::date, r.note, r.id, (select auth.uid()))
    returning id into v_new;
    insert into public.agency_order_work (organization_id, order_id, user_id, hours, note)
      select p_organization, v_new, w.user_id, w.hours, w.note from public.agency_order_work w
      where w.organization_id = p_organization and w.order_id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.agency_repeat_retainers(uuid, date) from public, anon;
grant execute on function public.agency_repeat_retainers(uuid, date) to authenticated;

-- ───────── Сводка «мозга» за месяц ─────────
-- Выставлено — счета месяца (invoiced + paid); Получено — оплаты, пришедшие в этом месяце;
-- Ожидается — выставленные неоплаченные счета месяца без просрочки; Просрочено — все с прошедшим сроком.
-- Раздел — по заказам, оплаченным в этом месяце: раздел + прямые расходы = Получено (до гроша).
create function public.agency_summary(p_organization uuid, p_month date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with period as (
    select coalesce(date_trunc('month', p_month)::date,
                    date_trunc('month', (now() at time zone 'Europe/Warsaw'))::date) as start,
           (now() at time zone 'Europe/Warsaw')::date as today
  ),
  p as (select start, (start + interval '1 month')::date as stop, today from period),
  o as (
    select o.*, c.name as client_name from public.agency_orders o
    join public.agency_clients c on c.organization_id = o.organization_id and c.id = o.client_id
    where o.organization_id = p_organization
  ),
  paid as (
    select o.* from o, p
    where o.status = 'paid' and (o.paid_at at time zone 'Europe/Warsaw')::date >= p.start
      and (o.paid_at at time zone 'Europe/Warsaw')::date < p.stop
  ),
  split as (
    select s.* from paid cross join lateral public.agency_order_split(p_organization, paid.id) s
  )
  select jsonb_build_object(
    'month', (select start from p),
    'invoiced_grosze', (select coalesce(sum(amount_grosze), 0) from o, p
                        where o.period_month = p.start and o.status in ('invoiced', 'paid')),
    'received_grosze', (select coalesce(sum(amount_grosze), 0) from paid),
    'expected_grosze', (select coalesce(sum(amount_grosze), 0) from o, p
                        where o.status = 'invoiced' and o.period_month = p.start
                          and (o.due_date is null or o.due_date >= p.today)),
    'overdue_grosze', (select coalesce(sum(amount_grosze), 0) from o, p
                       where o.status = 'invoiced' and o.due_date < p.today),
    'direct_costs_grosze', (select coalesce(sum(direct_costs_grosze), 0) from paid),
    'ad_budget_grosze', (select coalesce(sum(ad_budget_grosze), 0) from o, p
                         where o.period_month = p.start and o.status <> 'cancelled'),
    'split', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'role', x.role, 'amount_grosze', x.total)
                                        order by x.role, x.user_id)
                       from (select s.user_id, s.role, sum(s.amount_grosze) as total from split s
                             group by s.user_id, s.role having sum(s.amount_grosze) <> 0) x), '[]'),
    'overdue', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'client_id', x.client_id,
          'client_name', x.client_name, 'title', x.title, 'amount_grosze', x.amount_grosze, 'due_date', x.due_date)
          order by x.due_date)
        from (select o.* from o, p where o.status = 'invoiced' and o.due_date < p.today order by o.due_date limit 30) x), '[]'),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'status', c.status, 'client_org_id', c.client_org_id,
          'created_at', c.created_at,
          'month_grosze', (select coalesce(sum(o.amount_grosze), 0) from o, p
                           where o.client_id = c.id and o.period_month = p.start and o.status <> 'cancelled'),
          'month_orders', (select count(*) from o, p where o.client_id = c.id and o.period_month = p.start and o.status <> 'cancelled'),
          'last_activity', greatest(c.updated_at,
              (select max(greatest(o.updated_at, o.paid_at)) from o where o.client_id = c.id),
              (select max(mk.done_at) from public.agency_setup_marks mk
               where mk.organization_id = p_organization and mk.client_id = c.id)))
          order by case c.status when 'active' then 0 when 'lead' then 1 when 'paused' then 2 else 3 end, c.name)
        from public.agency_clients c where c.organization_id = p_organization), '[]')
  );
$$;
revoke all on function public.agency_summary(uuid, date) from public, anon;
grant execute on function public.agency_summary(uuid, date) to authenticated;
