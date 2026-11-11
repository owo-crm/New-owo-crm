-- 0025 · Услуги агентства (решение 027): у каждой услуги один ответственный партнёр —
-- он получает весь фонд исполнителей 65 % по заказам этой услуги. Клиенту назначаются услуги
-- со своей ценой (меняется в карточке клиента). Вклады партнёров в общий фонд.

create table public.agency_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  -- Ответственный: получает 65 % по заказам этой услуги.
  owner_id uuid not null references auth.users(id),
  kind text not null default 'project' check (kind in ('retainer', 'project')),
  -- Цена-ориентир; у каждого клиента своя цена (agency_client_services.price_grosze).
  default_price_grosze bigint check (default_price_grosze >= 0 and default_price_grosze <= 10000000000),
  active boolean not null default true,
  -- 'crm' — абонемент CRM: оплаты из Stripe автоматически идут заказами этой услуги.
  system_key text check (system_key in ('crm')),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name),
  unique (organization_id, system_key)
);

create function public.agency_check_service_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m where m.organization_id = new.organization_id and m.user_id = new.owner_id) then
    raise exception 'user is not a member of this organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.agency_check_service_owner() from public, anon, authenticated;
create trigger agency_services_owner before insert or update of owner_id on public.agency_services
  for each row execute function public.agency_check_service_owner();

-- Услуги клиента: что ему оказываем и по какой цене.
create table public.agency_client_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  service_id uuid not null,
  price_grosze bigint not null check (price_grosze >= 0 and price_grosze <= 10000000000),
  active boolean not null default true,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (client_id, service_id),
  foreign key (organization_id, client_id) references public.agency_clients(organization_id, id) on delete cascade,
  foreign key (organization_id, service_id) references public.agency_services(organization_id, id) on delete cascade
);
create trigger agency_client_services_updated_at before update on public.agency_client_services
  for each row execute function public.set_updated_at();

-- Заказ по услуге: 65 % автоматически ответственному (строка исполнителя 100 %).
alter table public.agency_orders add column service_id uuid;
alter table public.agency_orders add constraint agency_orders_service_fk
  foreign key (organization_id, service_id) references public.agency_services(organization_id, id) on delete set null (service_id);
grant update (service_id) on public.agency_orders to authenticated;

create function public.agency_service_owner_work() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if new.service_id is null or (tg_op = 'UPDATE' and new.service_id is not distinct from old.service_id) then
    return new;
  end if;
  select s.owner_id into v_owner from public.agency_services s where s.id = new.service_id;
  delete from public.agency_order_work w where w.order_id = new.id;
  insert into public.agency_order_work (organization_id, order_id, user_id, hours)
  values (new.organization_id, new.id, v_owner, 100);
  return new;
end;
$$;
revoke all on function public.agency_service_owner_work() from public, anon, authenticated;
create trigger agency_orders_service_owner after insert or update of service_id on public.agency_orders
  for each row execute function public.agency_service_owner_work();

-- Вклады партнёров в общий фонд (например, Artem 7 500 zł) — увеличивают сальдо фонда.
create table public.agency_fund_contributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  contributed_on date not null,
  amount_grosze bigint not null check (amount_grosze > 0 and amount_grosze <= 10000000000),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger agency_fund_contributions_member before insert or update of user_id on public.agency_fund_contributions
  for each row execute function public.agency_check_member();

do $$
declare t text;
begin
  foreach t in array array['agency_services','agency_client_services','agency_fund_contributions'] loop
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
grant update (name, description, owner_id, kind, default_price_grosze, active) on public.agency_services to authenticated;
grant update (price_grosze, active, note) on public.agency_client_services to authenticated;
grant update (contributed_on, amount_grosze, note) on public.agency_fund_contributions to authenticated;

-- Сводка: сальдо фонда учитывает вклады партнёров.
create or replace function public.agency_summary(p_organization uuid, p_month date default null)
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
  ),
  -- Общий фонд за всё время: доля компании со всех оплаченных заказов минус расходы фонда.
  fund_all as (
    select coalesce(sum(s.amount_grosze), 0) as total
    from o cross join lateral public.agency_order_split(p_organization, o.id) s
    where o.status = 'paid' and s.role = 'company'
  ),
  costs as (
    select c.* from public.agency_order_costs c join paid on paid.id = c.order_id
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
    -- Прямые расходы, оплачиваемые партнёрам (логистика и т. п.) — тоже «кому сколько».
    'costs_to_people', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.paid_to, 'amount_grosze', x.total))
        from (select paid_to, sum(amount_grosze) as total from costs where paid_to is not null group by paid_to) x), '[]'),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'amount_grosze', x.total))
        from (select py.user_id, sum(py.amount_grosze) as total from public.agency_payouts py, p
              where py.organization_id = p_organization and py.period_month = p.start group by py.user_id) x), '[]'),
    'fund', jsonb_build_object(
      'month_in', (select coalesce(sum(amount_grosze), 0) from split where role = 'company'),
      'month_out', (select coalesce(sum(e.amount_grosze), 0) from public.agency_fund_expenses e, p
                    where e.organization_id = p_organization and e.spent_on >= p.start and e.spent_on < p.stop),
      'contributions', (select coalesce(sum(c.amount_grosze), 0) from public.agency_fund_contributions c
                    where c.organization_id = p_organization),
      'balance', (select total from fund_all) - (select coalesce(sum(e.amount_grosze), 0)
                    from public.agency_fund_expenses e where e.organization_id = p_organization)
                 + (select coalesce(sum(c.amount_grosze), 0) from public.agency_fund_contributions c
                    where c.organization_id = p_organization)),
    -- Откуда пришли деньги месяца: источник лида клиента, абонемент CRM (Stripe) или вручную.
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', x.source, 'amount_grosze', x.total, 'orders', x.n)
          order by x.total desc)
        from (select coalesce(nullif(l.source_label, ''),
                       case when paid.stripe_invoice_id is not null then 'Abonament CRM' else 'Bez leada' end) as source,
                     sum(paid.amount_grosze) as total, count(*) as n
              from paid join public.agency_clients c on c.organization_id = paid.organization_id and c.id = paid.client_id
              left join public.leads l on l.id = c.lead_id
              group by 1) x), '[]'),
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
