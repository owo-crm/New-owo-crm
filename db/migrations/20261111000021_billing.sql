-- 0021 · Подписка по модулям: какие модули включены у бизнеса, абонемент в Stripe,
-- заявки клиента «Poproś o moduł», журнал вебхуков Stripe. Решение 022 в docs/decisions.md.
-- Каталог модулей и цены — в lib/billing/modules.ts (в базе только ключи).

-- ───────── Модули бизнеса ─────────
create table public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module text not null check (module in ('leads', 'channels', 'documents', 'payments', 'calendar')),
  enabled_at timestamptz not null default now(),
  enabled_by uuid,
  primary key (organization_id, module)
);

-- Уже работающие бизнесы (Barowo и др.) получают всё — ничего не ломается.
insert into public.organization_modules (organization_id, module)
  select o.id, m.module from public.organizations o
  cross join (values ('leads'), ('channels'), ('documents'), ('payments'), ('calendar')) m(module)
  on conflict do nothing;

-- Новый бизнес стартует с полным набором на пробный период (organizations.trial_ends_at).
-- Мастер «Utwórz CRM klienta» в кабинете агентства сразу ставит только оплаченные модули.
create function public.seed_organization_modules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_modules (organization_id, module)
  select new.id, m from unnest(array['leads','channels','documents','payments','calendar']) m;
  return new;
end;
$$;
revoke all on function public.seed_organization_modules() from public, anon, authenticated;
create trigger organization_modules_seed after insert on public.organizations
  for each row execute function public.seed_organization_modules();

-- Включён ли модуль. 'leads' — база, есть всегда.
create function public.has_module(org uuid, p_module text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_module = 'leads' or exists (
    select 1 from public.organization_modules m where m.organization_id = org and m.module = p_module
  );
$$;
revoke all on function public.has_module(uuid, text) from public, anon;
grant execute on function public.has_module(uuid, text) to authenticated, service_role;

-- Обслуживает ли текущий пользователь этот бизнес как агентство (клиент привязан к его агентству).
create function public.manages_organization(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.agency_clients ac
    join public.memberships m on m.organization_id = ac.organization_id and m.user_id = (select auth.uid())
    where ac.client_org_id = org
  );
$$;
revoke all on function public.manages_organization(uuid) from public, anon;
grant execute on function public.manages_organization(uuid) to authenticated;

alter table public.organization_modules enable row level security;
create policy "members or agency read" on public.organization_modules for select to authenticated
  using (public.is_member(organization_id) or public.manages_organization(organization_id));
revoke all on public.organization_modules from anon, authenticated;
grant select on public.organization_modules to authenticated;
grant all on public.organization_modules to service_role;

-- Модули меняет только агентство, которое обслуживает бизнес (или админ платформы).
-- Клиент сам не включает ничего — только просит (module_requests).
create function public.set_organization_modules(p_org uuid, p_modules text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.manages_organization(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_modules) m where m not in ('leads','channels','documents','payments','calendar')) then
    raise exception 'unknown module' using errcode = '22023';
  end if;
  delete from public.organization_modules where organization_id = p_org and module <> all (p_modules || array['leads']);
  insert into public.organization_modules (organization_id, module, enabled_by)
    select p_org, m, (select auth.uid()) from unnest(p_modules || array['leads']) m
    on conflict do nothing;
  -- Заявки на включённые модули считаются выполненными.
  update public.module_requests set handled_at = now()
    where organization_id = p_org and handled_at is null and module = any (p_modules);
end;
$$;

-- ───────── Заявки клиента «Poproś o moduł» ─────────
create table public.module_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module text not null check (module in ('channels', 'documents', 'payments', 'calendar')),
  requested_by uuid,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create unique index module_requests_open_idx on public.module_requests (organization_id, module) where handled_at is null;
alter table public.module_requests enable row level security;
create policy "members or agency read" on public.module_requests for select to authenticated
  using (public.is_member(organization_id) or public.manages_organization(organization_id));
create policy "members request" on public.module_requests for insert to authenticated
  with check (public.is_member(organization_id) and requested_by = (select auth.uid()));
create policy "agency handles" on public.module_requests for update to authenticated
  using (public.manages_organization(organization_id)) with check (public.manages_organization(organization_id));
revoke all on public.module_requests from anon, authenticated;
grant select, insert on public.module_requests to authenticated;
grant update (handled_at) on public.module_requests to authenticated;
grant all on public.module_requests to service_role;

revoke all on function public.set_organization_modules(uuid, text[]) from public, anon;
grant execute on function public.set_organization_modules(uuid, text[]) to authenticated;

-- ───────── Абонемент бизнеса (Stripe) ─────────
-- Сумма считается в lib/billing/pricing.ts; здесь — настройки клиента и состояние подписки.
-- Пишет только сервер (вебхук Stripe и действия агентства через asService после проверки прав).
create table public.organization_billing (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Клиент ведёт у нас рекламу: база бесплатно, модули −50 % (lib/billing/pricing.ts).
  ad_client boolean not null default false,
  -- Дополнительная скидка в базисных пунктах (1 % = 100).
  discount_bp integer not null default 0 check (discount_bp between 0 and 10000),
  billing_email text check (char_length(billing_email) <= 254),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'none'
    check (status in ('none', 'incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  monthly_net_grosze bigint not null default 0 check (monthly_net_grosze >= 0),
  billed_seats integer not null default 1 check (billed_seats >= 0),
  current_period_end timestamptz,
  synced_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  updated_at timestamptz not null default now()
);
create trigger organization_billing_updated_at before update on public.organization_billing
  for each row execute function public.set_updated_at();
alter table public.organization_billing enable row level security;
create policy "owners or agency read" on public.organization_billing for select to authenticated
  using (public.has_role(organization_id, array['owner','admin']::public.member_role[])
         or public.manages_organization(organization_id));
revoke all on public.organization_billing from anon, authenticated;
grant select on public.organization_billing to authenticated;
grant all on public.organization_billing to service_role;

-- Сколько платных мест: участники бизнеса без обслуживающих аккаунтов агентства.
create function public.billable_seats(org uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.memberships m where m.organization_id = org and not m.is_service;
$$;
revoke all on function public.billable_seats(uuid) from public, anon;
grant execute on function public.billable_seats(uuid) to authenticated, service_role;

-- ───────── Журнал вебхуков Stripe: повтор события не обрабатывается дважды ─────────
create table public.billing_events (
  id text primary key,
  type text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
grant all on public.billing_events to service_role;

-- ───────── Оплата абонемента → строка заказа в кабинете агентства ─────────
-- Счёт Stripe записывается заказом (kind = retainer, status = paid); комиссия Stripe — прямой расход,
-- поэтому в раздел идут только реальные деньги.
alter table public.agency_orders add column stripe_invoice_id text;
create unique index agency_orders_stripe_invoice_idx on public.agency_orders (stripe_invoice_id) where stripe_invoice_id is not null;

-- ───────── Чек-лист настройки зависит от модулей + шаг «абонемент оплачивается» ─────────
alter table public.agency_setup_steps add column module text;
update public.agency_setup_steps set module = 'documents' where key = 'documents';
insert into public.agency_setup_steps (key, position, auto) values ('subscription', 12, true);

create or replace function public.agency_setup_status(p_organization uuid, p_client uuid default null)
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
    union all
    select c.id, 'subscription', b.updated_at from c join public.organization_billing b
      on b.organization_id = c.client_org_id and b.status in ('active', 'trialing')
  )
  select c.id, s.key, s.position, s.auto,
         case when s.auto then f.ts else mk.done_at end,
         case when s.auto then null else mk.done_by end,
         case when s.auto then null else mk.note end
  from c cross join public.agency_setup_steps s
  left join facts f on s.auto and f.id = c.id and f.k = s.key
  left join public.agency_setup_marks mk on not s.auto and mk.organization_id = p_organization
    and mk.client_id = c.id and mk.step_key = s.key
  -- Шаг модуля показываем, только если модуль у клиента включён (нет CRM — показываем все).
  where s.module is null or c.client_org_id is null or public.has_module(c.client_org_id, s.module)
  order by c.id, s.position;
end;
$$;
