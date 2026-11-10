-- 0014 · Монолит на Railway: сессии, сброс пароля, идемпотентный приём заявок, live-события.

-- ───────── Сессии (cookie хранит случайный токен, в базе — только его SHA-256) ─────────
create table auth.sessions (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text
);
create index sessions_user_idx on auth.sessions(user_id);
create index sessions_expiry_idx on auth.sessions(expires_at);

create table auth.password_resets (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null,
  used_at      timestamptz
);

-- ───────── Идемпотентный приём: повтор той же заявки (submission_id) не создаёт второй лид ─────────
create function public.ingest_lead_once(p_organization uuid, p_channel uuid, p_source text,
  p_consent_at timestamptz, p_input jsonb, p_submission text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_existing public.leads; v_result jsonb;
begin
  if p_submission is null then
    return public.ingest_lead(p_organization, p_channel, p_source, p_consent_at, p_input);
  end if;
  if p_submission !~ '^[A-Za-z0-9_.:-]{6,100}$' then raise exception 'invalid submission id' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text || ':submission:' || p_submission, 3));
  select * into v_existing from public.leads where organization_id = p_organization and legacy_uid = 'submission:' || p_submission;
  if found then
    return jsonb_build_object('id', v_existing.id, 'number', v_existing.number, 'duplicate_ids', '[]'::jsonb, 'replayed', true);
  end if;
  v_result := public.ingest_lead(p_organization, p_channel, p_source, p_consent_at, p_input);
  -- legacy_uid ставится ПОСЛЕ вставки: триггер уведомлений уже поставил доставку в очередь.
  update public.leads set legacy_uid = 'submission:' || p_submission
    where organization_id = p_organization and id = (v_result->>'id')::uuid;
  return v_result;
end;
$$;
revoke all on function public.ingest_lead_once(uuid, uuid, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.ingest_lead_once(uuid, uuid, text, timestamptz, jsonb, text) to service_role;

-- Напоминания «нет ответа» работают и для заявок с submission_id.
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
 where (l.legacy_uid is null or l.legacy_uid like 'telegram:%' or l.legacy_uid like 'submission:%')
 and l.deleted_at is null and l.first_response_at is null and st.kind='open' and s.enabled and k.kind=any(s.events)
 and l.created_at>=now()-interval '7 days'
 and ((k.kind='unanswered_15m' and l.created_at<=now()-interval '15 minutes' and l.created_at>now()-interval '2 hours')
 or (k.kind='unanswered_2h' and l.created_at<=now()-interval '2 hours' and m.role in ('owner','admin')))
 and (s.channel='email' or (s.channel='telegram' and exists(select 1 from public.telegram_links t where t.organization_id=s.organization_id and t.user_id=s.user_id and t.chat_id is not null))
 or (s.channel='push' and exists(select 1 from public.push_subscriptions p where p.organization_id=s.organization_id and p.user_id=s.user_id))) on conflict do nothing;
 delete from public.intake_log where received_at<now()-interval '30 days';
 delete from auth.sessions where expires_at<now();
 delete from auth.password_resets where expires_at<now()-interval '1 day';
end;
$$;

-- ───────── Live-обновления: вместо Supabase Realtime — LISTEN/NOTIFY → SSE ─────────
create function public.notify_lead_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_notify('lead_changes', json_build_object(
    'organization_id', coalesce(new.organization_id, old.organization_id),
    'id', coalesce(new.id, old.id), 'op', tg_op)::text);
  return null;
end;
$$;
revoke all on function public.notify_lead_change() from public, anon, authenticated;
create trigger leads_live after insert or update or delete on public.leads
  for each row execute function public.notify_lead_change();
