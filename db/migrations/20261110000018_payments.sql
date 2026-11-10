-- 0018 · Деньги: план платежей по лиду, напоминания о задатке, сводка по финансам.
-- Таблица универсальная: Barowo создаёт три платежа из договора, другие бизнесы — свои.

create table public.lead_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  kind text not null check (kind in ('deposit', 'balance', 'other')),
  label text not null check (char_length(label) between 1 and 120),
  amount_grosze bigint not null check (amount_grosze > 0 and amount_grosze <= 100000000),
  due_date date,
  paid_at timestamptz,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade
);
create index lead_payments_lead_idx on public.lead_payments (organization_id, lead_id, position);
-- Для напоминаний: только неоплаченные со сроком.
create index lead_payments_due_idx on public.lead_payments (due_date) where paid_at is null and due_date is not null;

alter table public.lead_payments enable row level security;
create policy "members read" on public.lead_payments for select to authenticated using (public.is_member(organization_id));
create policy "members write" on public.lead_payments for insert to authenticated with check (public.is_member(organization_id));
create policy "members update" on public.lead_payments for update to authenticated
  using (public.is_member(organization_id)) with check (public.is_member(organization_id));
create policy "admins delete" on public.lead_payments for delete to authenticated
  using (public.has_role(organization_id, array['owner','admin']::public.member_role[]));
revoke all on public.lead_payments from anon, authenticated;
grant select, insert, delete on public.lead_payments to authenticated;
grant update (label, amount_grosze, due_date, paid_at, position) on public.lead_payments to authenticated;
grant all on public.lead_payments to service_role;

-- ───────── Напоминания о деньгах: новые виды уведомлений ─────────
alter table public.notification_deliveries add column payment_id uuid;
alter table public.notification_deliveries drop constraint notification_deliveries_kind_check;
alter table public.notification_deliveries add constraint notification_deliveries_kind_check
  check (kind in ('new_lead','unanswered_15m','unanswered_2h','payment_3d','payment_today','payment_overdue'));
alter table public.notification_settings drop constraint notification_settings_events_check;
alter table public.notification_settings add constraint notification_settings_events_check
  check (events <@ array['new_lead','unanswered_15m','unanswered_2h','payment_3d','payment_today','payment_overdue']::text[]);
alter table public.notification_settings alter column events set default
  array['new_lead','unanswered_15m','unanswered_2h','payment_3d','payment_today','payment_overdue'];
update public.notification_settings
   set events = events || array['payment_3d','payment_today','payment_overdue']
 where not events @> array['payment_3d'];

-- Один лид может ждать нескольких платежей, поэтому уникальность учитывает платёж.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.notification_deliveries'::regclass and contype = 'u';
  if c is not null then
    execute format('alter table public.notification_deliveries drop constraint %I', c);
  end if;
end $$;
create unique index notification_deliveries_dedup on public.notification_deliveries
  (organization_id, lead_id, user_id, channel, kind,
   coalesce(payment_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ───────── План платежей из договора ─────────
create function public.set_contract_payments(
  p_organization uuid, p_lead uuid, p_rows jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare r jsonb; i smallint := 0;
begin
  if not public.is_member(p_organization) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  -- Оплаченное не трогаем: перевыпуск договора не стирает историю денег.
  delete from public.lead_payments
   where organization_id = p_organization and lead_id = p_lead and paid_at is null;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.lead_payments (organization_id, lead_id, kind, label, amount_grosze, due_date, position)
    select p_organization, p_lead, r->>'kind', r->>'label', (r->>'amount_grosze')::bigint,
           nullif(r->>'due_date','')::date, i
    where not exists (
      select 1 from public.lead_payments p
       where p.organization_id = p_organization and p.lead_id = p_lead
         and p.paid_at is not null and p.kind = r->>'kind' and p.label = r->>'label');
    i := i + 1;
  end loop;
end;
$$;
revoke all on function public.set_contract_payments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_contract_payments(uuid, uuid, jsonb) to authenticated, service_role;

-- Лид считается оплатившим задаток, когда оплачены все платежи kind='deposit'.
create function public.sync_deposit_flag() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_lead uuid; v_done boolean;
begin
  v_org := coalesce(new.organization_id, old.organization_id);
  v_lead := coalesce(new.lead_id, old.lead_id);
  select count(*) filter (where kind = 'deposit') > 0
     and count(*) filter (where kind = 'deposit' and paid_at is null) = 0
    into v_done
    from public.lead_payments where organization_id = v_org and lead_id = v_lead;
  update public.leads
     set deposit_paid_at = case when v_done then coalesce(deposit_paid_at, now()) else null end
   where organization_id = v_org and id = v_lead
     and (deposit_paid_at is null) = v_done;
  return null;
end;
$$;
revoke all on function public.sync_deposit_flag() from public, anon, authenticated;
create trigger lead_payments_deposit after insert or update or delete on public.lead_payments
  for each row execute function public.sync_deposit_flag();

-- ───────── Планировщик: напоминания о деньгах рядом с напоминаниями о лидах ─────────
create or replace function public.prepare_notification_jobs() returns void
language plpgsql security definer set search_path='' as $$
declare v_today date := (now() at time zone 'Europe/Warsaw')::date;
begin
 -- Снимаем напоминания по лидам, на которые уже ответили или которые закрыты.
 update public.notification_deliveries d set status='skipped',error=null
 where d.kind in ('unanswered_15m','unanswered_2h') and d.status in ('queued','failed') and exists(
  select 1 from public.leads l join public.pipeline_stages s on s.organization_id=l.organization_id and s.key=l.stage_key
  where l.organization_id=d.organization_id and l.id=d.lead_id and (l.deleted_at is not null or l.first_response_at is not null or s.kind<>'open'));
 -- Снимаем напоминания об оплаченных и удалённых платежах.
 update public.notification_deliveries d set status='skipped',error=null
 where d.kind like 'payment\_%' and d.status in ('queued','failed')
   and not exists(select 1 from public.lead_payments p where p.id=d.payment_id and p.paid_at is null);
 update public.notification_deliveries set status='dead',error='worker_timeout',lease_token=null,locked_at=null
 where status='processing' and attempts>=5 and locked_at<now()-interval '5 minutes';

 insert into public.notification_deliveries(organization_id,lead_id,user_id,channel,kind)
 select l.organization_id,l.id,s.user_id,s.channel,k.kind from public.leads l
 join public.pipeline_stages st on st.organization_id=l.organization_id and st.key=l.stage_key
 join public.notification_settings s on s.organization_id=l.organization_id
 join public.memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
 cross join (values ('unanswered_15m'),('unanswered_2h')) k(kind)
 where (l.legacy_uid is null or l.legacy_uid like 'telegram:%' or l.legacy_uid like 'submission:%')
 and l.deleted_at is null and l.first_response_at is null and st.kind='open' and s.enabled and k.kind=any(s.events)
 and l.created_at>=now()-interval '7 days'
 and ((k.kind='unanswered_15m' and l.created_at<=now()-interval '15 minutes' and l.created_at>now()-interval '2 hours')
 or (k.kind='unanswered_2h' and l.created_at<=now()-interval '2 hours' and m.role in ('owner','admin')))
 and (s.channel='email' or (s.channel='telegram' and exists(select 1 from public.telegram_links t where t.organization_id=s.organization_id and t.user_id=s.user_id and t.chat_id is not null))
 or (s.channel='push' and exists(select 1 from public.push_subscriptions ps where ps.organization_id=s.organization_id and ps.user_id=s.user_id))) on conflict do nothing;

 -- Деньги: за 3 дня до срока, в день срока и при просрочке (не старше 30 дней).
 insert into public.notification_deliveries(organization_id,lead_id,user_id,channel,kind,payment_id)
 select p.organization_id,p.lead_id,s.user_id,s.channel,k.kind,p.id
 from public.lead_payments p
 join public.leads l on l.organization_id=p.organization_id and l.id=p.lead_id and l.deleted_at is null
 join public.pipeline_stages st on st.organization_id=l.organization_id and st.key=l.stage_key and st.kind<>'lost'
 join public.notification_settings s on s.organization_id=p.organization_id
 join public.memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
 cross join (values ('payment_3d'),('payment_today'),('payment_overdue')) k(kind)
 where p.paid_at is null and p.due_date is not null and s.enabled and k.kind=any(s.events)
 and ((k.kind='payment_3d' and p.due_date=v_today+3)
   or (k.kind='payment_today' and p.due_date=v_today)
   or (k.kind='payment_overdue' and p.due_date<v_today and p.due_date>=v_today-30 and m.role in ('owner','admin')))
 and (s.channel='email' or (s.channel='telegram' and exists(select 1 from public.telegram_links t where t.organization_id=s.organization_id and t.user_id=s.user_id and t.chat_id is not null))
 or (s.channel='push' and exists(select 1 from public.push_subscriptions ps where ps.organization_id=s.organization_id and ps.user_id=s.user_id))) on conflict do nothing;

 delete from public.intake_log where received_at<now()-interval '30 days';
 delete from auth.sessions where expires_at<now();
 delete from auth.password_resets where expires_at<now()-interval '1 day';
end;
$$;

-- ───────── Сводка по деньгам ─────────
create function public.finance_summary(p_organization uuid, p_month date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select coalesce(date_trunc('month', p_month)::date,
                    date_trunc('month', (now() at time zone 'Europe/Warsaw'))::date) as start,
           (now() at time zone 'Europe/Warsaw')::date as today
  ),
  period as (select start, (start + interval '1 month')::date as stop, today from bounds),
  pay as (
    select p.*, l.source_label, l.client_name, l.event_date
    from public.lead_payments p
    join public.leads l on l.organization_id = p.organization_id and l.id = p.lead_id and l.deleted_at is null
    join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key and s.kind <> 'lost'
    where p.organization_id = p_organization
  )
  select jsonb_build_object(
    'month', (select start from period),
    'paid_grosze', (select coalesce(sum(amount_grosze),0) from pay, period
                    where paid_at >= period.start and paid_at < period.stop),
    'expected_grosze', (select coalesce(sum(amount_grosze),0) from pay, period
                    where paid_at is null and due_date >= period.start and due_date < period.stop),
    'overdue_grosze', (select coalesce(sum(amount_grosze),0) from pay, period
                    where paid_at is null and due_date < period.today),
    'overdue', coalesce((select jsonb_agg(jsonb_build_object(
          'id', o.id, 'lead_id', o.lead_id, 'client_name', o.client_name, 'label', o.label,
          'amount_grosze', o.amount_grosze, 'due_date', o.due_date) order by o.due_date)
        from (select * from pay, period where paid_at is null and due_date < period.today
              order by due_date limit 20) o), '[]'),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object(
          'id', u.id, 'lead_id', u.lead_id, 'client_name', u.client_name, 'label', u.label,
          'amount_grosze', u.amount_grosze, 'due_date', u.due_date) order by u.due_date)
        from (select * from pay, period where paid_at is null and due_date >= period.today
              order by due_date limit 20) u), '[]'),
    'signed_grosze', (select coalesce(sum(amount_grosze),0) from pay),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object(
          'source', s.source_label, 'paid_grosze', s.paid, 'open_grosze', s.open, 'leads', s.leads)
        order by s.paid desc) from (
        select source_label,
               coalesce(sum(amount_grosze) filter (where paid_at is not null), 0) as paid,
               coalesce(sum(amount_grosze) filter (where paid_at is null), 0) as open,
               count(distinct lead_id) as leads
        from pay group by source_label) s), '[]'),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', x.m, 'paid_grosze', x.total) order by x.m) from (
        select to_char(date_trunc('month', paid_at at time zone 'Europe/Warsaw'), 'YYYY-MM') as m,
               sum(amount_grosze) as total
        from pay where paid_at >= now() - interval '6 months'
        group by date_trunc('month', paid_at at time zone 'Europe/Warsaw')) x), '[]'),
    'funnel', coalesce((select jsonb_agg(jsonb_build_object(
          'key', st.key, 'label', st.label_pl, 'kind', st.kind, 'position', st.position,
          'leads', (select count(*) from public.leads l
                     where l.organization_id = p_organization and l.stage_key = st.key and l.deleted_at is null))
        order by st.position)
      from public.pipeline_stages st where st.organization_id = p_organization), '[]')
  );
$$;
revoke all on function public.finance_summary(uuid, date) from public, anon;
grant execute on function public.finance_summary(uuid, date) to authenticated;
