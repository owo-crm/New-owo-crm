-- 0015 · Документы (оферта, меню для гостей, договор) + поля мероприятия из бота Barowo.

-- ───────── Какой генератор документов у фирмы (barowo = фирменные PDF/Word из бота v48) ─────────
alter table public.organizations add column document_engine text
  check (document_engine is null or document_engine ~ '^[a-z][a-z0-9_-]{0,40}$');

-- ───────── Поля лида, которые были в листе Lidy ─────────
alter table public.leads
  add column package_name text check (char_length(package_name) <= 60),
  add column service_hours text check (char_length(service_hours) <= 80),
  add column client_full_name text check (char_length(client_full_name) <= 500),
  add column client_address text check (char_length(client_address) <= 500),
  add column next_contact_at timestamptz,
  add column deposit_paid_at timestamptz;
grant update (package_name, service_hours, client_full_name, client_address, next_contact_at, deposit_paid_at)
  on public.leads to authenticated;

-- Этап «Umowa podpisana» (бот: SIGNED) между «Umowa wysłana» и «Zadatek wpłacony».
update public.pipeline_stages set position = position + 1 where key in ('deposit_paid', 'rejected', 'spam');
insert into public.pipeline_stages (organization_id, key, label_pl, position, kind)
  select id, 'contract_signed', 'Umowa podpisana', 5, 'won' from public.organizations
  on conflict do nothing;
create or replace function public.seed_lead_stages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pipeline_stages (organization_id, key, label_pl, position, kind) values
    (new.id, 'new', 'Nowy', 0, 'open'),
    (new.id, 'contacted', 'Skontaktowano', 1, 'open'),
    (new.id, 'offer_sent', 'Oferta wysłana', 2, 'open'),
    (new.id, 'offer_accepted', 'Oferta zaakceptowana', 3, 'open'),
    (new.id, 'contract_sent', 'Umowa wysłana', 4, 'open'),
    (new.id, 'contract_signed', 'Umowa podpisana', 5, 'won'),
    (new.id, 'deposit_paid', 'Zadatek wpłacony', 6, 'won'),
    (new.id, 'rejected', 'Odrzucony', 7, 'lost'),
    (new.id, 'spam', 'Spam', 8, 'lost');
  return new;
end;
$$;

-- ───────── Правка лида: новые поля участвуют в истории и «Cofnij» ─────────
create or replace function public.change_lead(p_organization uuid, p_lead uuid, p_version timestamptz, p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_before public.leads; v_after public.leads; v_event uuid; v_snapshot jsonb; v_kind text;
  v_keys text[] := array['client_name','phone_e164','email','event_type','event_date','event_city','venue','guests','budget_grosze','message','assigned_to','stage_key',
    'package_name','service_hours','client_full_name','client_address','next_contact_at','deposit_paid_at'];
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
    stage_key=v_after.stage_key, first_response_at=v_after.first_response_at,
    package_name=v_after.package_name, service_hours=v_after.service_hours, client_full_name=v_after.client_full_name,
    client_address=v_after.client_address, next_contact_at=v_after.next_contact_at, deposit_paid_at=v_after.deposit_paid_at
    where organization_id=p_organization and id=p_lead returning * into v_after;
  v_kind := case when p_patch ? 'stage_key' then 'stage_changed' else 'edited' end;
  insert into public.lead_events (organization_id,lead_id,type,actor_user_id,payload)
    values (p_organization,p_lead,v_kind,auth.uid(),jsonb_build_object('before',v_snapshot,'patch',p_patch,'version',v_after.updated_at)) returning id into v_event;
  return jsonb_build_object('event_id',v_event,'updated_at',v_after.updated_at);
end;
$$;

create or replace function public.undo_lead_change(p_organization uuid, p_event uuid)
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
    stage_key=v_before.stage_key,first_response_at=v_before.first_response_at,
    package_name=v_before.package_name, service_hours=v_before.service_hours, client_full_name=v_before.client_full_name,
    client_address=v_before.client_address, next_contact_at=v_before.next_contact_at, deposit_paid_at=v_before.deposit_paid_at
    where organization_id=p_organization and id=v_lead.id;
  insert into public.lead_events (organization_id,lead_id,type,actor_user_id,payload)
    values (p_organization,v_lead.id,'restored',auth.uid(),jsonb_build_object('event_id',p_event));
end;
$$;

-- ───────── Документы и их файлы (PDF/DOCX в базе: 50–300 КБ, бэкап вместе с данными) ─────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  kind text not null check (kind in ('offer','menu','contract')),
  number text not null check (char_length(number) between 1 and 40),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'generated' check (status in ('generated','sent','signed','cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, kind, number),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, created_by) references public.memberships(organization_id, user_id) on delete set null (created_by)
);
create index documents_lead_idx on public.documents (organization_id, lead_id, created_at desc);

create table public.document_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  format text not null check (format in ('pdf','docx')),
  filename text not null check (char_length(filename) between 1 and 200),
  content bytea not null check (octet_length(content) <= 10485760),
  created_at timestamptz not null default now(),
  unique (organization_id, document_id, format),
  foreign key (organization_id, document_id) references public.documents(organization_id, id) on delete cascade
);

-- Нумерация «N / ГГГГ», как в боте (сквозной счётчик; стартовое значение можно перенести из бота).
create table public.document_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('offer','menu','contract')),
  last_value integer not null default 0 check (last_value >= 0),
  primary key (organization_id, kind)
);

create function public.next_document_number(p_organization uuid, p_kind text) returns text
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  if not public.is_member(p_organization) and auth.uid() is not null then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into public.document_counters (organization_id, kind, last_value) values (p_organization, p_kind, 1)
  on conflict (organization_id, kind) do update set last_value = public.document_counters.last_value + 1
  returning last_value into v;
  return v || ' / ' || extract(year from now() at time zone 'Europe/Warsaw')::int;
end;
$$;
revoke all on function public.next_document_number(uuid, text) from public, anon;
grant execute on function public.next_document_number(uuid, text) to authenticated, service_role;

alter table public.documents enable row level security;
alter table public.document_files enable row level security;
alter table public.document_counters enable row level security;
create policy "members read" on public.documents for select to authenticated using (public.is_member(organization_id));
create policy "members insert" on public.documents for insert to authenticated
  with check (public.is_member(organization_id) and created_by = auth.uid());
create policy "members update" on public.documents for update to authenticated
  using (public.is_member(organization_id)) with check (public.is_member(organization_id));
create policy "members read" on public.document_files for select to authenticated using (public.is_member(organization_id));
create policy "members insert" on public.document_files for insert to authenticated with check (public.is_member(organization_id));
create policy "members read" on public.document_counters for select to authenticated using (public.is_member(organization_id));
revoke all on public.documents, public.document_files, public.document_counters from anon, authenticated;
grant select, insert on public.documents, public.document_files to authenticated;
grant update (status, sent_at) on public.documents to authenticated;
grant select on public.document_counters to authenticated;
grant all on public.documents, public.document_files, public.document_counters to service_role;
