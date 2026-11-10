-- 0006 · Atomic edits + history, optimistic concurrency and eight-second undo.
create function public.change_lead(p_organization uuid, p_lead uuid, p_version timestamptz, p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_before public.leads; v_after public.leads; v_event uuid; v_snapshot jsonb; v_kind text;
  v_keys text[] := array['client_name','phone_e164','email','event_type','event_date','event_city','venue','guests','budget_grosze','message','assigned_to','stage_key'];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch - v_keys <> '{}'::jsonb or p_patch = '{}'::jsonb then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  select * into v_before from public.leads where organization_id = p_organization and id = p_lead and deleted_at is null for update;
  if not found then raise exception 'lead not found' using errcode = '42501'; end if;
  if v_before.updated_at <> p_version or p_version is null then raise exception 'lead changed' using errcode = '40001'; end if;
  v_after := jsonb_populate_record(v_before, p_patch);
  if p_patch ? 'stage_key' and v_after.stage_key <> 'new' and exists (select 1 from public.pipeline_stages where organization_id = p_organization and key = v_after.stage_key and kind <> 'lost') then
    v_after.first_response_at := coalesce(v_before.first_response_at, now());
  end if;
  select jsonb_object_agg(key,value) into v_snapshot from jsonb_each(to_jsonb(v_before)) where key = any(v_keys || array['first_response_at']);
  update public.leads set client_name=v_after.client_name, phone_e164=v_after.phone_e164, email=v_after.email,
    event_type=v_after.event_type, event_date=v_after.event_date, event_city=v_after.event_city, venue=v_after.venue,
    guests=v_after.guests, budget_grosze=v_after.budget_grosze, message=v_after.message, assigned_to=v_after.assigned_to,
    stage_key=v_after.stage_key, first_response_at=v_after.first_response_at
    where organization_id=p_organization and id=p_lead returning * into v_after;
  v_kind := case when p_patch ? 'stage_key' then 'stage_changed' else 'edited' end;
  insert into public.lead_events (organization_id,lead_id,type,actor_user_id,payload)
    values (p_organization,p_lead,v_kind,auth.uid(),jsonb_build_object('before',v_snapshot,'patch',p_patch,'version',v_after.updated_at)) returning id into v_event;
  return jsonb_build_object('event_id',v_event,'updated_at',v_after.updated_at);
end;
$$;

create function public.undo_lead_change(p_organization uuid, p_event uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_event public.lead_events; v_lead public.leads; v_before public.leads;
begin
  select * into v_event from public.lead_events where organization_id=p_organization and id=p_event
    and actor_user_id=auth.uid() and type in ('edited','stage_changed') and created_at >= now()-interval '8 seconds';
  if not found then raise exception 'undo expired' using errcode='40001'; end if;
  select * into v_lead from public.leads where organization_id=p_organization and id=v_event.lead_id and deleted_at is null for update;
  if not found or v_lead.updated_at <> (v_event.payload->>'version')::timestamptz then
    raise exception 'lead changed' using errcode='40001';
  end if;
  v_before := jsonb_populate_record(v_lead, v_event.payload->'before');
  update public.leads set client_name=v_before.client_name,phone_e164=v_before.phone_e164,email=v_before.email,
    event_type=v_before.event_type,event_date=v_before.event_date,event_city=v_before.event_city,venue=v_before.venue,
    guests=v_before.guests,budget_grosze=v_before.budget_grosze,message=v_before.message,assigned_to=v_before.assigned_to,
    stage_key=v_before.stage_key,first_response_at=v_before.first_response_at
    where organization_id=p_organization and id=v_lead.id;
  insert into public.lead_events (organization_id,lead_id,type,actor_user_id,payload)
    values (p_organization,v_lead.id,'restored',auth.uid(),jsonb_build_object('event_id',p_event));
end;
$$;
revoke all on function public.change_lead(uuid,uuid,timestamptz,jsonb), public.undo_lead_change(uuid,uuid) from public,anon;
grant execute on function public.change_lead(uuid,uuid,timestamptz,jsonb), public.undo_lead_change(uuid,uuid) to authenticated;
