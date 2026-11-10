-- 0008 · Tenant dashboard aggregates; calendar boundaries always use Warsaw.
create function public.lead_dashboard(p_organization uuid,p_year integer,p_now timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as (
    select l.*,s.kind from public.leads l join public.pipeline_stages s on s.organization_id=l.organization_id and s.key=l.stage_key
    where l.organization_id=p_organization and l.deleted_at is null
  ), stats as (
    select count(*) filter(where first_response_at is null and kind='open') as waiting_count,
      avg(greatest(extract(epoch from (first_response_at-created_at))/60,0)) filter(where first_response_at >= p_now-interval '30 days' and first_response_at <= p_now) as response_minutes,
      count(*) filter(where created_at >= date_trunc('month',p_now at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' and created_at <= p_now) as month_leads
    from visible
  )
  select jsonb_build_object('waiting_count',waiting_count,'response_minutes',response_minutes,'month_leads',month_leads,
    'waiting',coalesce((select jsonb_agg(to_jsonb(w)-'kind') from (select * from visible where first_response_at is null and kind='open' order by created_at,id limit 12) w),'[]'),
    'inquiries',coalesce((select jsonb_object_agg(event_date::text,'inquiry') from visible where kind<>'lost' and event_date >= make_date(p_year,1,1) and event_date < make_date(p_year+1,1,1)),'{}'),
    'month_won',(select count(distinct l.id) from visible l join public.lead_events e on e.organization_id=l.organization_id and e.lead_id=l.id
      join public.pipeline_stages s on s.organization_id=e.organization_id and s.key=e.payload->'patch'->>'stage_key'
      where l.kind='won' and s.kind='won' and e.type='stage_changed' and e.created_at >= date_trunc('month',p_now at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' and e.created_at <= p_now),
    'followups',(select count(*) from public.lead_tasks t join visible l on l.organization_id=t.organization_id and l.id=t.lead_id
      where t.done_at is null and (t.due_at at time zone 'Europe/Warsaw')::date <= (p_now at time zone 'Europe/Warsaw')::date),
    'form_connected',exists(select 1 from public.channels where organization_id=p_organization and type='website' and status='active' and last_received_at is not null)) from stats;
$$;
revoke all on function public.lead_dashboard(uuid,integer,timestamptz) from public,anon;
grant execute on function public.lead_dashboard(uuid,integer,timestamptz) to authenticated;
