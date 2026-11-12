-- 0031 · Рассылки (решение 037): перенос панели из Telegram-бота.
--
-- Отличие от уведомлений: это письма клиентам, а не себе. Поэтому обязательны отписка
-- в каждом письме и очередь по дням — дневной лимит ящика (обычно 450–500 писем)
-- не должен ломать кампанию, она просто доедет за несколько дней.

-- Согласие на рекламу — не то же самое, что согласие ответить на заявку.
alter table public.leads add column marketing_consent_at timestamptz;
comment on column public.leads.marketing_consent_at is
  'Согласие на рекламную рассылку. Согласие из формы заявки (consent_at) этого не заменяет.';
grant update (marketing_consent_at) on public.leads to authenticated;

-- Отписавшиеся: по адресу, а не по лиду — человек отписывается один раз навсегда.
create table public.mail_optouts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  created_at timestamptz not null default now(),
  source text,
  primary key (organization_id, email)
);

create table public.mailing_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  subject text not null default '' check (char_length(subject) <= 200),
  body text not null default '' check (char_length(body) <= 8000),
  heading1 text check (char_length(heading1) <= 60),
  heading2 text check (char_length(heading2) <= 60),
  button_text text check (char_length(button_text) <= 60),
  button_url text check (char_length(button_url) <= 500),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.mailing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null default '' check (char_length(body) <= 8000),
  heading1 text, heading2 text, button_text text, button_url text,
  status text not null default 'sending' check (status in ('sending', 'done', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, id)
);

create table public.mailing_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  lead_id uuid,
  email text not null check (email = lower(email)),
  name text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  sent_at timestamptz,
  error text,
  unique (campaign_id, email),
  foreign key (organization_id, campaign_id) references public.mailing_campaigns(organization_id, id) on delete cascade
);
create index mailing_recipients_queue on public.mailing_recipients (organization_id, status)
  where status = 'pending';

-- ── Контакты для рассылки ───────────────────────────────────────────────────
-- Один адрес — одна строка, даже если обращений было несколько: берём самое свежее.
create function public.mailing_contacts(p_organization uuid)
returns table (
  lead_id uuid, name text, email text, event_label text, event_date date,
  signed boolean, past boolean, created_days integer, unsubscribed boolean, consent boolean
)
language sql stable security invoker set search_path = '' as $$
  select distinct on (lower(l.email))
    l.id, l.client_name, lower(l.email),
    nullif(trim(coalesce(l.event_type, '')), ''), l.event_date,
    s.kind = 'won',
    l.event_date is not null and l.event_date < (now() at time zone 'Europe/Warsaw')::date,
    extract(day from (now() - l.created_at))::integer,
    exists (select 1 from public.mail_optouts o
             where o.organization_id = l.organization_id and o.email = lower(l.email)),
    l.marketing_consent_at is not null
  from public.leads l
  join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
  where l.organization_id = p_organization and l.deleted_at is null
    and l.email is not null and l.email <> '' and l.stage_key <> 'spam'
  order by lower(l.email), l.created_at desc;
$$;

-- ── Запуск кампании ─────────────────────────────────────────────────────────
-- Отписавшиеся отсеиваются здесь, а не в интерфейсе: так их нельзя обойти случайно.
create function public.mailing_start(p_organization uuid, p_campaign jsonb, p_leads uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.mailing_campaigns
    (organization_id, subject, body, heading1, heading2, button_text, button_url, created_by)
  values (p_organization,
    p_campaign->>'subject', coalesce(p_campaign->>'body', ''),
    p_campaign->>'heading1', p_campaign->>'heading2',
    p_campaign->>'buttonText', p_campaign->>'buttonUrl', (select auth.uid()))
  returning id into v_id;

  insert into public.mailing_recipients (organization_id, campaign_id, lead_id, email, name)
  select distinct on (lower(l.email))
         p_organization, v_id, l.id, lower(l.email), l.client_name
  from public.leads l
  where l.organization_id = p_organization and l.id = any(p_leads)
    and l.email is not null and l.email <> '' and l.deleted_at is null
    and not exists (select 1 from public.mail_optouts o
                     where o.organization_id = p_organization and o.email = lower(l.email))
  order by lower(l.email), l.created_at desc
  on conflict do nothing;

  return v_id;
end;
$$;

/** Очередь на отправку: письма уходят порциями, сколько позволяет дневной лимит. */
create function public.mailing_next(p_organization uuid, p_limit integer)
returns table (recipient_id uuid, campaign_id uuid, email text, name text,
               subject text, body text, heading1 text, heading2 text,
               button_text text, button_url text)
language sql stable security invoker set search_path = '' as $$
  select r.id, c.id, r.email, r.name, c.subject, c.body, c.heading1, c.heading2,
         c.button_text, c.button_url
  from public.mailing_recipients r
  join public.mailing_campaigns c on c.organization_id = r.organization_id and c.id = r.campaign_id
  where r.organization_id = p_organization and r.status = 'pending' and c.status = 'sending'
  order by c.created_at, r.id
  limit greatest(0, p_limit);
$$;

create function public.mailing_mark(p_organization uuid, p_recipient uuid, p_ok boolean, p_error text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_campaign uuid;
begin
  update public.mailing_recipients
     set status = case when p_ok then 'sent' else 'failed' end,
         sent_at = now(), error = p_error
   where organization_id = p_organization and id = p_recipient
  returning campaign_id into v_campaign;

  -- Кампания закрывается сама, когда в ней не осталось ожидающих.
  update public.mailing_campaigns c set status = 'done', finished_at = now()
   where c.organization_id = p_organization and c.id = v_campaign and c.status = 'sending'
     and not exists (select 1 from public.mailing_recipients r
                      where r.campaign_id = c.id and r.status = 'pending');
end;
$$;

/** Сводка по кампаниям для панели. */
create function public.mailing_summary(p_organization uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', c.id, 'subject', c.subject, 'status', c.status,
      'created_at', c.created_at,
      'sent', count(*) filter (where r.status = 'sent'),
      'pending', count(*) filter (where r.status = 'pending'),
      'failed', count(*) filter (where r.status = 'failed'),
      'total', count(r.id)
    ) as x
    from public.mailing_campaigns c
    left join public.mailing_recipients r
      on r.organization_id = c.organization_id and r.campaign_id = c.id
    where c.organization_id = p_organization
    group by c.id, c.subject, c.status, c.created_at
    order by c.created_at desc limit 20
  ) s;
$$;

do $$
declare t text;
begin
  foreach t in array array['mail_optouts','mailing_templates','mailing_campaigns','mailing_recipients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('create policy "members write" on public.%I for insert to authenticated with check (public.is_member(organization_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id))', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant update (name, subject, body, heading1, heading2, button_text, button_url, position)
  on public.mailing_templates to authenticated;
grant update (status, finished_at) on public.mailing_campaigns to authenticated;
grant update (status, sent_at, error) on public.mailing_recipients to authenticated;

revoke all on function public.mailing_contacts(uuid), public.mailing_start(uuid, jsonb, uuid[]),
  public.mailing_next(uuid, integer), public.mailing_mark(uuid, uuid, boolean, text),
  public.mailing_summary(uuid) from public, anon;
grant execute on function public.mailing_contacts(uuid), public.mailing_start(uuid, jsonb, uuid[]),
  public.mailing_next(uuid, integer), public.mailing_mark(uuid, uuid, boolean, text),
  public.mailing_summary(uuid) to authenticated;
