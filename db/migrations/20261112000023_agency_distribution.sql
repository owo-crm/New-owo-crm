-- 0023 · Распределение прибыли OWO Ads по документу партнёров (docs/agency-distribution.md, решение 025):
-- несколько продавцов с долями 10 %, вклад исполнителей часами ИЛИ согласованными баллами,
-- прямые расходы строками (с оплатой конкретному человеку — логистика), общий фонд 25 %
-- с расходами и остатком, учёт выплат партнёрам.

-- ───────── Продавцы заказа: 10 % делятся между ними по долям ─────────
create table public.agency_order_sellers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  share_bp integer not null check (share_bp between 1 and 10000),
  primary key (order_id, user_id),
  foreign key (organization_id, order_id) references public.agency_orders(organization_id, id) on delete cascade
);
-- Прежний единственный продавец → 100 % комиссии.
insert into public.agency_order_sellers (organization_id, order_id, user_id, share_bp)
  select organization_id, id, sold_by, 10000 from public.agency_orders where sold_by is not null;

create trigger agency_order_sellers_member before insert or update of user_id on public.agency_order_sellers
  for each row execute function public.agency_check_member();

-- ───────── Вклад исполнителей: часы или согласованные баллы (§5) ─────────
alter table public.agency_orders add column work_basis text not null default 'hours'
  check (work_basis in ('hours', 'points'));
comment on column public.agency_order_work.hours is
  'Часы (work_basis = hours) или согласованные баллы вклада (work_basis = points). 65 % делятся пропорционально.';

-- ───────── Прямые расходы строками (§6, §10.3) ─────────
create table public.agency_order_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  label text not null check (char_length(label) between 1 and 200),
  amount_grosze bigint not null check (amount_grosze > 0 and amount_grosze <= 10000000000),
  -- Кому платим из расходов проекта (например, логистика Artem). null — внешнему подрядчику.
  paid_to uuid references auth.users(id) on delete set null,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, order_id) references public.agency_orders(organization_id, id) on delete cascade
);
create index agency_order_costs_order_idx on public.agency_order_costs (organization_id, order_id);

create function public.agency_check_cost_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.paid_to is not null and not exists (
    select 1 from public.memberships m where m.organization_id = new.organization_id and m.user_id = new.paid_to
  ) then
    raise exception 'user is not a member of this organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.agency_check_cost_member() from public, anon, authenticated;
create trigger agency_order_costs_member before insert or update of paid_to on public.agency_order_costs
  for each row execute function public.agency_check_cost_member();

-- Сумма строк расходов = direct_costs_grosze заказа (одна правда для формулы раздела).
create function public.agency_sync_order_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_order uuid := coalesce(new.order_id, old.order_id);
begin
  update public.agency_orders o
     set direct_costs_grosze = (select coalesce(sum(c.amount_grosze), 0) from public.agency_order_costs c where c.order_id = v_order)
   where o.id = v_order;
  return null;
end;
$$;
revoke all on function public.agency_sync_order_costs() from public, anon, authenticated;
create trigger agency_order_costs_sync after insert or update or delete on public.agency_order_costs
  for each row execute function public.agency_sync_order_costs();

-- ───────── Общий фонд OWO Ads: расходы (§4) ─────────
create table public.agency_fund_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  spent_on date not null,
  category text not null check (category in ('ads', 'equipment', 'software', 'transport', 'other')),
  label text not null check (char_length(label) between 1 and 200),
  amount_grosze bigint not null check (amount_grosze > 0 and amount_grosze <= 10000000000),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index agency_fund_expenses_idx on public.agency_fund_expenses (organization_id, spent_on desc);

-- ───────── Выплаты партнёрам (§10.11) ─────────
create table public.agency_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  amount_grosze bigint not null check (amount_grosze > 0 and amount_grosze <= 10000000000),
  paid_at timestamptz not null default now(),
  note text check (char_length(note) <= 500),
  created_by uuid,
  unique (organization_id, id)
);
create index agency_payouts_idx on public.agency_payouts (organization_id, period_month);
create trigger agency_payouts_member before insert or update of user_id on public.agency_payouts
  for each row execute function public.agency_check_member();

-- ───────── RLS: как у остальных таблиц агентства ─────────
do $$
declare t text;
begin
  foreach t in array array['agency_order_sellers','agency_order_costs','agency_fund_expenses','agency_payouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('create policy "members write" on public.%I for insert to authenticated with check (public.is_member(organization_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
create policy "members delete" on public.agency_order_sellers for delete to authenticated using (public.is_member(organization_id));
create policy "members delete" on public.agency_order_costs for delete to authenticated using (public.is_member(organization_id));
-- Деньги фонда и выплаты удаляют только owner/admin.
create policy "admins delete" on public.agency_fund_expenses for delete to authenticated
  using (public.has_role(organization_id, array['owner','admin']::public.member_role[]));
create policy "admins delete" on public.agency_payouts for delete to authenticated
  using (public.has_role(organization_id, array['owner','admin']::public.member_role[]));
grant select, insert, delete on public.agency_order_sellers, public.agency_order_costs,
  public.agency_fund_expenses, public.agency_payouts to authenticated;
grant update (share_bp) on public.agency_order_sellers to authenticated;
grant update (label, amount_grosze, paid_to, note) on public.agency_order_costs to authenticated;
grant update (spent_on, category, label, amount_grosze) on public.agency_fund_expenses to authenticated;
grant update (amount_grosze, paid_at, note) on public.agency_payouts to authenticated;
grant update (work_basis) on public.agency_orders to authenticated;

-- ───────── Формула раздела: продавцы с долями ─────────
-- Продажа 10 %: каждому продавцу floor(продажа × доля); непокрытая доля — строка user_id = null
-- («nierozdzielone»); остатки округления — компании. Работа — как прежде (часы или баллы).
create or replace function public.agency_order_split(p_organization uuid, p_order uuid)
returns table (user_id uuid, role text, amount_grosze bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_order public.agency_orders;
  v_org public.organizations;
  v_base bigint; v_sale bigint; v_work bigint; v_given bigint := 0; v_total_h bigint;
  v_shares bigint;
  r record;
begin
  select * into v_order from public.agency_orders o where o.organization_id = p_organization and o.id = p_order;
  if not found then return; end if;
  select * into v_org from public.organizations o where o.id = p_organization;

  v_base := v_order.amount_grosze - v_order.direct_costs_grosze;
  v_sale := v_base * v_org.agency_share_sale_bp / 10000;
  v_work := v_base * v_org.agency_share_work_bp / 10000;

  select coalesce(sum(s.share_bp), 0) into v_shares
  from public.agency_order_sellers s where s.organization_id = p_organization and s.order_id = p_order;
  for r in
    select s.user_id as u, s.share_bp as bp from public.agency_order_sellers s
    where s.organization_id = p_organization and s.order_id = p_order order by s.share_bp desc, s.user_id
  loop
    user_id := r.u; role := 'sale'; amount_grosze := v_sale * least(r.bp, 10000) / 10000;
    v_given := v_given + amount_grosze;
    return next;
  end loop;
  if v_shares < 10000 then
    user_id := null; role := 'sale'; amount_grosze := v_sale * (10000 - v_shares) / 10000;
    v_given := v_given + amount_grosze;
    return next;
  end if;

  select coalesce(sum((w.hours * 100)::bigint), 0) into v_total_h
  from public.agency_order_work w where w.organization_id = p_organization and w.order_id = p_order;

  if v_total_h = 0 then
    user_id := null; role := 'work'; amount_grosze := v_work; v_given := v_given + v_work; return next;
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

  user_id := null; role := 'company'; amount_grosze := v_base - v_given; return next;
end;
$$;

-- Повтор абонементов копирует и продавцов.
create or replace function public.agency_copy_sellers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.repeated_from is not null then
    insert into public.agency_order_sellers (organization_id, order_id, user_id, share_bp)
    select new.organization_id, new.id, s.user_id, s.share_bp from public.agency_order_sellers s
    where s.order_id = new.repeated_from on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.agency_copy_sellers() from public, anon, authenticated;
create trigger agency_orders_copy_sellers after insert on public.agency_orders
  for each row execute function public.agency_copy_sellers();

-- Повтор абонементов копирует и строки расходов (как стартовую точку на новый месяц).
create or replace function public.agency_copy_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.repeated_from is not null then
    insert into public.agency_order_costs (organization_id, order_id, label, amount_grosze, paid_to, note)
    select new.organization_id, new.id, c.label, c.amount_grosze, c.paid_to, c.note
    from public.agency_order_costs c where c.order_id = new.repeated_from;
  end if;
  return new;
end;
$$;
revoke all on function public.agency_copy_costs() from public, anon, authenticated;
create trigger agency_orders_copy_costs after insert on public.agency_orders
  for each row execute function public.agency_copy_costs();

-- ───────── Сводка «мозга»: + фонд, выплаты, расходы партнёрам, доход по источникам ─────────
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
      'balance', (select total from fund_all) - (select coalesce(sum(e.amount_grosze), 0)
                    from public.agency_fund_expenses e where e.organization_id = p_organization)),
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

-- Совместимость: заказ с одним sold_by (без явных продавцов) = этот продавец на 100 % комиссии.
create or replace function public.agency_default_seller() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sold_by is not null and new.repeated_from is null then
    insert into public.agency_order_sellers (organization_id, order_id, user_id, share_bp)
    values (new.organization_id, new.id, new.sold_by, 10000) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.agency_default_seller() from public, anon, authenticated;
create trigger agency_orders_default_seller after insert on public.agency_orders
  for each row execute function public.agency_default_seller();
