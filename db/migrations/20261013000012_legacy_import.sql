-- 0012 · Silent idempotent import. Existing CRM data is never overwritten.
create function public.import_legacy_lead(p_organization uuid,p_uid text,p_input jsonb,p_stage text,p_created timestamptz,p_response timestamptz,p_source text,p_raw jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_lead uuid;v_channel uuid;
begin
 if p_uid is null or p_uid not like 'apps-script:%' or char_length(p_uid)>160 or p_created is null then raise exception 'invalid legacy metadata';end if;
 if p_response<p_created then raise exception 'response before creation';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization::text || ':legacy-import',3));
 select id into v_lead from public.leads where organization_id=p_organization and legacy_uid=p_uid;
 if found then return jsonb_build_object('id',v_lead,'inserted',false);end if;
 select id into v_channel from public.channels where organization_id=p_organization and type='manual' and name='Import Apps Script' limit 1;
 if v_channel is null then insert into public.channels(organization_id,type,name) values(p_organization,'manual','Import Apps Script') returning id into v_channel;end if;
 insert into public.leads(organization_id,legacy_uid,source_channel_id,source_label,stage_key,client_name,phone_e164,email,
 event_type,event_date,event_city,venue,guests,budget_grosze,message,custom_fields,utm,page_url,referrer,created_at,first_response_at,raw_payload)
 values(p_organization,p_uid,v_channel,coalesce(nullif(p_source,''),'Import Apps Script'),p_stage,p_input->>'client_name',p_input->>'phone_e164',lower(p_input->>'email'),
 p_input->>'event_type',(p_input->>'event_date')::date,p_input->>'event_city',p_input->>'venue',(p_input->>'guests')::integer,(p_input->>'budget_grosze')::integer,
 coalesce(p_input->>'message',''),coalesce(p_input->'custom_fields','{}'),coalesce(p_input->'utm','{}'),p_input->>'page_url',p_input->>'referrer',p_created,p_response,p_raw) returning id into v_lead;
 insert into public.lead_events(organization_id,lead_id,type,payload,created_at) values(p_organization,v_lead,'created',jsonb_build_object('imported',true,'legacy_uid',p_uid),p_created);
 return jsonb_build_object('id',v_lead,'inserted',true);
end;
$$;
revoke all on function public.import_legacy_lead(uuid,text,jsonb,text,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_legacy_lead(uuid,text,jsonb,text,timestamptz,timestamptz,text,jsonb) to service_role;

-- Imported history must stay silent even when recent.
create or replace function public.prepare_notification_jobs() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.notification_deliveries d set status='skipped',error=null
 where d.kind<>'new_lead' and d.status in ('queued','failed') and exists(
  select 1 from public.leads l join public.pipeline_stages s on s.organization_id=l.organization_id and s.key=l.stage_key
  where l.organization_id=d.organization_id and l.id=d.lead_id and (l.deleted_at is not null or l.first_response_at is not null or s.kind<>'open'));
 update public.notification_deliveries set status='dead',error='worker_timeout',lease_token=null,locked_at=null
 where status='processing' and attempts>=5 and locked_at<now()-interval '5 minutes';
 insert into public.notification_deliveries(organization_id,lead_id,user_id,channel,kind)
 select l.organization_id,l.id,s.user_id,s.channel,k.kind from public.leads l
 join public.pipeline_stages st on st.organization_id=l.organization_id and st.key=l.stage_key
 join public.notification_settings s on s.organization_id=l.organization_id
 join public.memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
 cross join (values ('unanswered_15m'),('unanswered_2h')) k(kind)
 where (l.legacy_uid is null or l.legacy_uid like 'telegram:%') and l.deleted_at is null and l.first_response_at is null and st.kind='open' and s.enabled and k.kind=any(s.events)
 and l.created_at>=now()-interval '7 days'
 and ((k.kind='unanswered_15m' and l.created_at<=now()-interval '15 minutes' and l.created_at>now()-interval '2 hours')
 or (k.kind='unanswered_2h' and l.created_at<=now()-interval '2 hours' and m.role in ('owner','admin')))
 and (s.channel='email' or (s.channel='telegram' and exists(select 1 from public.telegram_links t where t.organization_id=s.organization_id and t.user_id=s.user_id and t.chat_id is not null))
 or (s.channel='push' and exists(select 1 from public.push_subscriptions p where p.organization_id=s.organization_id and p.user_id=s.user_id))) on conflict do nothing;
 delete from public.intake_log where received_at<now()-interval '30 days';
end;
$$;

-- Known historical contact is not an unanswered lead; its response duration remains unknown.
-- 0008 · Tenant dashboard aggregates; calendar boundaries always use Warsaw.
create or replace function public.lead_dashboard(p_organization uuid,p_year integer,p_now timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as (
    select l.*,s.kind from public.leads l join public.pipeline_stages s on s.organization_id=l.organization_id and s.key=l.stage_key
    where l.organization_id=p_organization and l.deleted_at is null
  ), stats as (
    select count(*) filter(where first_response_at is null and kind='open' and not coalesce(legacy_uid like 'apps-script:%' and stage_key<>'new',false)) as waiting_count,
      avg(greatest(extract(epoch from (first_response_at-created_at))/60,0)) filter(where first_response_at >= p_now-interval '30 days' and first_response_at <= p_now) as response_minutes,
      count(*) filter(where created_at >= date_trunc('month',p_now at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' and created_at <= p_now) as month_leads
    from visible
  )
  select jsonb_build_object('waiting_count',waiting_count,'response_minutes',response_minutes,'month_leads',month_leads,
    'waiting',coalesce((select jsonb_agg(to_jsonb(w)-'kind') from (select * from visible where first_response_at is null and kind='open' and not coalesce(legacy_uid like 'apps-script:%' and stage_key<>'new',false) order by created_at,id limit 12) w),'[]'),
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
