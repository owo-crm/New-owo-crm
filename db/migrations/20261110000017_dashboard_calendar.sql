-- 0017 · Главный экран = очередь работы, календарь = занятость по датам.
-- Логика «сезона суббот» убрана: она была только для Barowo и не подходит другим бизнесам.

drop function if exists public.lead_dashboard(uuid, integer, timestamptz);

-- Что требует внимания сегодня + показатели месяца. Всё в одном запросе.
create function public.work_queue(p_organization uuid, p_user uuid default null, p_now timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as (
    select l.*, s.kind from public.leads l
    join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
    where l.organization_id = p_organization and l.deleted_at is null
  ),
  -- «Не отвечен» = нет первого ответа; импортированные из бота с этапом выше «новый» считаются отвеченными.
  waiting as (
    select * from visible
    where kind = 'open' and first_response_at is null
      and not coalesce(legacy_uid like 'apps-script:%' and stage_key <> 'new', false)
  ),
  today_calls as (
    select l.id, l.client_name, l.phone_e164, l.next_contact_at as due_at, null::text as title
    from visible l
    where l.kind = 'open' and l.next_contact_at is not null
      and (l.next_contact_at at time zone 'Europe/Warsaw')::date <= (p_now at time zone 'Europe/Warsaw')::date
    union all
    select l.id, l.client_name, l.phone_e164, t.due_at, t.title
    from public.lead_tasks t join visible l on l.organization_id = t.organization_id and l.id = t.lead_id
    where t.done_at is null and (t.due_at at time zone 'Europe/Warsaw')::date <= (p_now at time zone 'Europe/Warsaw')::date
  ),
  month as (
    select date_trunc('month', p_now at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' as start
  )
  select jsonb_build_object(
    'now', p_now,
    'waiting_count', (select count(*) from waiting),
    'waiting', coalesce((select jsonb_agg(to_jsonb(w) - 'kind' order by w.created_at)
                         from (select * from waiting order by created_at limit 10) w), '[]'),
    'mine_count', (select count(*) from visible where kind = 'open' and assigned_to = p_user),
    'tasks_count', (select count(*) from today_calls),
    'tasks', coalesce((select jsonb_agg(to_jsonb(c) order by c.due_at) from (select * from today_calls order by due_at limit 8) c), '[]'),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object(
          'id', u.id, 'client_name', u.client_name, 'event_date', u.event_date,
          'event_type', u.event_type, 'event_city', u.event_city, 'confirmed', u.kind = 'won')
        order by u.event_date)
      from (select * from visible where kind <> 'lost' and event_date >= (p_now at time zone 'Europe/Warsaw')::date
            order by event_date limit 6) u), '[]'),
    'response_minutes', (select avg(greatest(extract(epoch from (first_response_at - created_at)) / 60, 0))
       from visible where first_response_at >= p_now - interval '30 days' and first_response_at <= p_now),
    'month_leads', (select count(*) from visible, month where created_at >= month.start and created_at <= p_now),
    'month_won', (select count(*) from visible, month
       where kind = 'won' and updated_at >= month.start and updated_at <= p_now),
    'form_connected', exists(select 1 from public.channels
       where organization_id = p_organization and type = 'website' and status = 'active' and last_received_at is not null)
  );
$$;
revoke all on function public.work_queue(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.work_queue(uuid, uuid, timestamptz) to authenticated;

-- Календарь: занятые даты за период. confirmed = договор подписан или задаток внесён.
create function public.calendar_events(p_organization uuid, p_from date, p_to date)
returns table (event_date date, id uuid, client_name text, event_type text, event_city text, confirmed boolean, stage_key text)
language sql stable security invoker set search_path = '' as $$
  select l.event_date, l.id, l.client_name, l.event_type, l.event_city, s.kind = 'won', l.stage_key
  from public.leads l
  join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
  where l.organization_id = p_organization and l.deleted_at is null and s.kind <> 'lost'
    and l.event_date between p_from and p_to
  order by l.event_date, s.kind = 'won' desc, l.created_at;
$$;
revoke all on function public.calendar_events(uuid, date, date) from public, anon;
grant execute on function public.calendar_events(uuid, date, date) to authenticated;
