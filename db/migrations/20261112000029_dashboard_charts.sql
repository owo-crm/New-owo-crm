-- 0029 · Данные для графиков на «Pulpit».
--
-- Три вопроса, на которые экран отвечает без клика: сколько заявок приходит и сколько
-- из них доходит до подписи, откуда они приходят, и насколько занят ближайший сезон.

create function public.dashboard_charts(p_organization uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with today as (select (now() at time zone 'Europe/Warsaw')::date as d),
  -- Шесть последних месяцев, включая пустые: пропуск месяца врёт о динамике.
  months as (
    select generate_series(
      date_trunc('month', (select d from today)) - interval '5 months',
      date_trunc('month', (select d from today)),
      interval '1 month'
    )::date as m
  ),
  leads_by_month as (
    select date_trunc('month', (l.created_at at time zone 'Europe/Warsaw'))::date as m,
           count(*) as leads,
           count(*) filter (where s.kind = 'won') as won
    from public.leads l
    join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
    where l.organization_id = p_organization and l.deleted_at is null
      and l.created_at >= (select date_trunc('month', d) - interval '5 months' from today)
    group by 1
  ),
  -- Откуда приходят заявки за последние 90 дней. Всё мелкое складываем в «Inne».
  sources as (
    select coalesce(nullif(trim(l.source_label), ''), 'Bez źródła') as source, count(*) as leads
    from public.leads l
    where l.organization_id = p_organization and l.deleted_at is null
      and l.created_at >= (select d - 90 from today)
    group by 1
  ),
  ranked as (select source, leads, row_number() over (order by leads desc, source) as rn from sources),
  -- Занятость ближайших шести месяцев: подписано против «пока только в планах».
  ahead as (
    select generate_series(
      date_trunc('month', (select d from today)),
      date_trunc('month', (select d from today)) + interval '5 months',
      interval '1 month'
    )::date as m
  ),
  booked as (
    select date_trunc('month', l.event_date)::date as m,
           count(*) filter (where s.kind = 'won') as confirmed,
           count(*) filter (where s.kind = 'open') as tentative
    from public.leads l
    join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
    where l.organization_id = p_organization and l.deleted_at is null and s.kind <> 'lost'
      and l.event_date >= (select date_trunc('month', d)::date from today)
      and l.event_date < (select (date_trunc('month', d) + interval '6 months')::date from today)
    group by 1
  )
  select jsonb_build_object(
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(months.m, 'YYYY-MM'),
        'leads', coalesce(b.leads, 0),
        'won', coalesce(b.won, 0)
      ) order by months.m)
      from months left join leads_by_month b on b.m = months.m
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(x order by x->>'leads' desc) from (
        select jsonb_build_object('source', source, 'leads', leads) as x
        from ranked where rn <= 5
        union all
        select jsonb_build_object('source', 'Inne', 'leads', sum(leads))
        from ranked where rn > 5 having sum(leads) > 0
      ) s
    ), '[]'::jsonb),
    'ahead', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(ahead.m, 'YYYY-MM'),
        'confirmed', coalesce(k.confirmed, 0),
        'tentative', coalesce(k.tentative, 0)
      ) order by ahead.m)
      from ahead left join booked k on k.m = ahead.m
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.dashboard_charts(uuid) from public, anon;
grant execute on function public.dashboard_charts(uuid) to authenticated;
