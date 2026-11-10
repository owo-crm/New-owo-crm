-- 0004 · Persistent, atomic 10/hour limit; only hashed IP, no personal form data in logs.
create index intake_log_ip_idx on public.intake_log (organization_id, (payload->>'ip_hash'), received_at);
create function public.reserve_intake(p_organization uuid, p_channel uuid, p_ip_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_count integer; v_id uuid; v_allowed boolean;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid ip hash'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text || p_ip_hash, 1));
  select count(*) into v_count from public.intake_log where organization_id = p_organization
    and payload->>'ip_hash' = p_ip_hash and received_at > now() - interval '1 hour' and error is distinct from 'rate_limited';
  v_allowed := v_count < 10;
  insert into public.intake_log (organization_id, channel_id, ok, error, payload)
    values (p_organization, p_channel, false, case when v_allowed then 'received' else 'rate_limited' end, jsonb_build_object('ip_hash', p_ip_hash)) returning id into v_id;
  return jsonb_build_object('id', v_id, 'allowed', v_allowed);
end;
$$;
revoke all on function public.reserve_intake(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_intake(uuid, uuid, text) to service_role;

create function public.mark_channel_received() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.ok and new.error is null then
    update public.channels set last_received_at = greatest(coalesce(last_received_at, new.received_at), new.received_at)
      where organization_id = new.organization_id and id = new.channel_id;
  end if;
  return new;
end;
$$;
revoke all on function public.mark_channel_received() from public, anon, authenticated;
create trigger intake_received after update on public.intake_log for each row execute function public.mark_channel_received();
