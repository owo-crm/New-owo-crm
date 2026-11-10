-- 0013 · Keep literal email/name search and allow member removal without deleting lead history.
alter table public.leads drop constraint leads_organization_id_assigned_to_fkey;
alter table public.leads add constraint leads_organization_id_assigned_to_fkey
 foreign key(organization_id,assigned_to) references public.memberships(organization_id,user_id) on delete set null (assigned_to);
alter table public.lead_events drop constraint lead_events_organization_id_actor_user_id_fkey;
alter table public.lead_events add constraint lead_events_organization_id_actor_user_id_fkey
 foreign key(organization_id,actor_user_id) references public.memberships(organization_id,user_id) on delete set null (actor_user_id);

-- 0005 · Parameterized search (no user input interpolated in PostgREST filter expressions).
create or replace function public.search_leads(p_organization uuid, p_query text default '', p_stage text default null,
  p_source uuid default null, p_assigned text default null, p_from date default null, p_to date default null)
returns setof public.leads language sql stable security invoker set search_path = '' as $$
  select l.* from public.leads l where l.organization_id = p_organization and l.deleted_at is null
    and (p_stage is null or l.stage_key = p_stage)
    and (p_source is null or l.source_channel_id = p_source)
    and (p_assigned is null or (p_assigned = 'unassigned' and l.assigned_to is null) or l.assigned_to::text = p_assigned)
    and (p_from is null or l.event_date >= p_from) and (p_to is null or l.event_date <= p_to)
    and (p_query = '' or position(lower(p_query) in lower(l.client_name)) > 0
      or position(lower(p_query) in lower(coalesce(l.email,''))) > 0
      or (p_query ~ '^[+0-9[:space:]().-]+$' and regexp_replace(p_query,'[^0-9]','','g') <> '' and position(regexp_replace(p_query,'[^0-9]','','g') in coalesce(l.phone_e164,'')) > 0))
  order by l.created_at desc, l.id desc;
$$;
revoke all on function public.search_leads(uuid,text,text,uuid,text,date,date) from public, anon;
grant execute on function public.search_leads(uuid,text,text,uuid,text,date,date) to authenticated;
