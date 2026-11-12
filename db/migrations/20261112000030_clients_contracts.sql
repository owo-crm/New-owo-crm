-- 0030 · Разделение «Leady · Klienci · Umowy» (решение 036).
--
-- Один и тот же человек может обратиться дважды: летом на свадьбу, через год на юбилей.
-- В общем списке это выглядело как дубль. Теперь:
--   Lead   — обращение, по которому умову ещё не выслали;
--   Klient — тот, кому умову уже выслали (один человек = одна строка, даже если обращений несколько);
--   Umowa  — подписанная умова; их у клиента может быть сколько угодно.
--
-- Отдельных таблиц не заводим: это разные взгляды на те же лиды. Человека узнаём
-- по телефону, а если его нет — по почте.

create function public.person_key(p_phone text, p_email text, p_lead uuid)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(p_phone), ''), lower(nullif(trim(p_email), '')), 'lead:' || p_lead::text);
$$;

-- Позиция этапа «умова выслана»: всё, что на ней и дальше, — уже клиент.
create function public.client_stage_position(p_organization uuid)
returns integer language sql stable set search_path = '' as $$
  select coalesce(
    (select position from public.pipeline_stages
      where organization_id = p_organization and key = 'contract_sent'),
    (select min(position) from public.pipeline_stages
      where organization_id = p_organization and kind = 'won'));
$$;

/**
 * Клиенты: по одной строке на человека. stage_key — самый дальний этап среди его обращений,
 * leads — сколько раз обращался, contracts — сколько умов подписано.
 */
create function public.clients_list(p_organization uuid, p_query text default null)
returns table (
  person_key text, lead_id uuid, client_name text, phone_e164 text, email text,
  stage_key text, leads bigint, contracts bigint,
  last_event date, first_seen timestamptz, last_seen timestamptz
)
language sql stable security invoker set search_path = '' as $$
  with mine as (
    select l.*, s.position as stage_position, s.kind as stage_kind,
           public.person_key(l.phone_e164, l.email, l.id) as pkey
    from public.leads l
    join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
    where l.organization_id = p_organization and l.deleted_at is null and s.kind <> 'lost'
      and s.position >= public.client_stage_position(p_organization)
  ),
  filtered as (
    select * from mine
    where p_query is null or p_query = ''
       or client_name ilike '%' || p_query || '%'
       or coalesce(phone_e164, '') ilike '%' || p_query || '%'
       or coalesce(email, '') ilike '%' || p_query || '%'
  ),
  best as (
    select distinct on (pkey) pkey, id, client_name, phone_e164, email, stage_key, stage_position
    from filtered order by pkey, stage_position desc, created_at desc
  )
  select b.pkey, b.id, b.client_name, b.phone_e164, b.email, b.stage_key,
         count(*) as leads,
         count(*) filter (where f.stage_kind = 'won') as contracts,
         max(f.event_date) as last_event,
         min(f.created_at) as first_seen,
         max(f.created_at) as last_seen
  from best b join filtered f on f.pkey = b.pkey
  group by b.pkey, b.id, b.client_name, b.phone_e164, b.email, b.stage_key
  order by max(f.created_at) desc;
$$;

/** Умовы: по строке на подписанную умову, с номером документа, если он есть. */
create function public.contracts_list(p_organization uuid, p_query text default null)
returns table (
  lead_id uuid, client_name text, phone_e164 text, email text, stage_key text,
  event_date date, event_type text, event_city text,
  number text, signed_at timestamptz, amount_grosze bigint, paid_grosze bigint
)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.client_name, l.phone_e164, l.email, l.stage_key,
         l.event_date, l.event_type, l.event_city,
         d.number, coalesce(d.created_at, l.updated_at) as signed_at,
         coalesce((select sum(p.amount_grosze) from public.lead_payments p
                    where p.organization_id = l.organization_id and p.lead_id = l.id), 0),
         coalesce((select sum(p.amount_grosze) from public.lead_payments p
                    where p.organization_id = l.organization_id and p.lead_id = l.id
                      and p.paid_at is not null), 0)
  from public.leads l
  join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
  left join lateral (
    select number, created_at from public.documents doc
     where doc.organization_id = l.organization_id and doc.lead_id = l.id and doc.kind = 'contract'
     order by doc.created_at desc limit 1
  ) d on true
  where l.organization_id = p_organization and l.deleted_at is null and s.kind = 'won'
    and (p_query is null or p_query = ''
         or l.client_name ilike '%' || p_query || '%'
         or coalesce(l.phone_e164, '') ilike '%' || p_query || '%'
         or coalesce(d.number, '') ilike '%' || p_query || '%')
  order by coalesce(d.created_at, l.updated_at) desc;
$$;

revoke all on function public.clients_list(uuid, text), public.contracts_list(uuid, text),
  public.person_key(text, text, uuid), public.client_stage_position(uuid) from public, anon;
grant execute on function public.clients_list(uuid, text), public.contracts_list(uuid, text),
  public.person_key(text, text, uuid), public.client_stage_position(uuid) to authenticated;
