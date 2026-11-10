-- 0003 · Single transaction for ingestion. Invoker privileges preserve RLS.
alter table public.leads add constraint leads_contact_required check (phone_e164 is not null or email is not null);

create function public.ingest_lead(p_organization uuid, p_channel uuid, p_source text, p_consent_at timestamptz, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.leads; v_duplicates uuid[]; v_duplicate uuid;
begin
  -- Serialize ingestion for this organization so concurrent identical submissions get linked.
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text, 0));
  select coalesce(array_agg(id), '{}') into v_duplicates from public.leads
    where organization_id = p_organization and deleted_at is null and created_at >= now() - interval '30 days'
      and ((p_input->>'phone_e164' is not null and phone_e164 = p_input->>'phone_e164')
        or (p_input->>'email' is not null and email = lower(p_input->>'email')));
  insert into public.leads (organization_id, source_channel_id, source_label, client_name,
    phone_e164, email, event_type, event_date, event_city, venue, guests, budget_grosze,
    message, custom_fields, utm, page_url, referrer, consent_at)
  values (p_organization, p_channel, p_source, p_input->>'client_name',
    p_input->>'phone_e164', lower(p_input->>'email'), p_input->>'event_type', (p_input->>'event_date')::date,
    p_input->>'event_city', p_input->>'venue', (p_input->>'guests')::integer, (p_input->>'budget_grosze')::integer,
    coalesce(p_input->>'message',''), coalesce(p_input->'custom_fields','{}'), coalesce(p_input->'utm','{}'),
    p_input->>'page_url', p_input->>'referrer', p_consent_at) returning * into v_lead;
  insert into public.lead_events (organization_id, lead_id, type, actor_user_id, payload)
    values (p_organization, v_lead.id, 'created', auth.uid(), jsonb_build_object('source', p_source));
  foreach v_duplicate in array v_duplicates loop
    insert into public.lead_events (organization_id, lead_id, type, actor_user_id, payload) values
      (p_organization, v_lead.id, 'possible_duplicate', auth.uid(), jsonb_build_object('lead_id', v_duplicate)),
      (p_organization, v_duplicate, 'possible_duplicate', auth.uid(), jsonb_build_object('lead_id', v_lead.id));
  end loop;
  return jsonb_build_object('id', v_lead.id, 'number', v_lead.number, 'duplicate_ids', v_duplicates);
end;
$$;
revoke all on function public.ingest_lead(uuid, uuid, text, timestamptz, jsonb) from public, anon;
grant execute on function public.ingest_lead(uuid, uuid, text, timestamptz, jsonb) to authenticated, service_role;
