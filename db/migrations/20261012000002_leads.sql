-- 0002 · Leads, stages, channels and intake audit. All tenant relations use composite FKs.
create table public.pipeline_stages (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  label_pl text not null check (char_length(label_pl) between 1 and 100),
  position integer not null check (position >= 0),
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  primary key (organization_id, key)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('website','meta_lead_ads','google_ads','email_inbound','webhook','manual')),
  name text not null check (char_length(name) between 1 and 120),
  public_key uuid not null unique default gen_random_uuid(),
  secret_hash text,
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  status text not null default 'active' check (status in ('active','paused','error')),
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number bigint generated always as identity unique,
  stage_key text not null default 'new',
  source_channel_id uuid,
  source_label text not null default '',
  client_name text not null check (char_length(client_name) between 1 and 200),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email = lower(email) and char_length(email) <= 254),
  event_type text,
  event_date date,
  event_city text,
  venue text,
  guests integer check (guests between 0 and 100000),
  budget_grosze integer check (budget_grosze >= 0),
  message text not null default '' check (char_length(message) <= 10000),
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  assigned_to uuid,
  first_response_at timestamptz,
  utm jsonb not null default '{}' check (jsonb_typeof(utm) = 'object'),
  page_url text,
  referrer text,
  consent_at timestamptz,
  raw_payload jsonb not null default '{}' check (jsonb_typeof(raw_payload) = 'object'),
  legacy_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, legacy_uid),
  foreign key (organization_id, stage_key) references public.pipeline_stages(organization_id, key),
  foreign key (organization_id, source_channel_id) references public.channels(organization_id, id),
  foreign key (organization_id, assigned_to) references public.memberships(organization_id, user_id)
);
create index leads_recent_idx on public.leads (organization_id, created_at desc) where deleted_at is null;
create index leads_phone_idx on public.leads (organization_id, phone_e164, created_at desc) where deleted_at is null;
create index leads_email_idx on public.leads (organization_id, email, created_at desc) where deleted_at is null;
create index leads_event_date_idx on public.leads (organization_id, event_date) where deleted_at is null;
create trigger leads_updated_at before update on public.leads for each row execute function public.set_updated_at();

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  type text not null check (type in ('created','possible_duplicate','stage_changed','note','call','email_sent','document_generated','offer_viewed','offer_accepted','edited','contacted','restored')),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, actor_user_id) references public.memberships(organization_id, user_id)
);
create index lead_events_lead_idx on public.lead_events (organization_id, lead_id, created_at);

create table public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  due_at timestamptz not null,
  title text not null check (char_length(title) between 1 and 300),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade
);
create index lead_tasks_due_idx on public.lead_tasks (organization_id, due_at) where done_at is null;

create table public.custom_field_defs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  label_pl text not null check (char_length(label_pl) between 1 and 120),
  type text not null check (type in ('text','number','boolean','date','select')),
  options jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  primary key (organization_id, key)
);

create table public.intake_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  received_at timestamptz not null default now(),
  ok boolean not null,
  error text,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  foreign key (organization_id, channel_id) references public.channels(organization_id, id) on delete cascade
);
create index intake_log_received_idx on public.intake_log (organization_id, received_at desc);

-- Provision stages for existing organizations and all future registrations.
create function public.seed_lead_stages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pipeline_stages (organization_id, key, label_pl, position, kind) values
    (new.id, 'new', 'Nowy', 0, 'open'),
    (new.id, 'contacted', 'Skontaktowano', 1, 'open'),
    (new.id, 'offer_sent', 'Oferta wysłana', 2, 'open'),
    (new.id, 'offer_accepted', 'Oferta zaakceptowana', 3, 'open'),
    (new.id, 'contract_sent', 'Umowa wysłana', 4, 'open'),
    (new.id, 'deposit_paid', 'Zadatek wpłacony', 5, 'won'),
    (new.id, 'rejected', 'Odrzucony', 6, 'lost'),
    (new.id, 'spam', 'Spam', 7, 'lost');
  return new;
end;
$$;
revoke all on function public.seed_lead_stages() from public, anon, authenticated;
create trigger organization_lead_stages after insert on public.organizations for each row execute function public.seed_lead_stages();
insert into public.pipeline_stages (organization_id, key, label_pl, position, kind)
select o.id, s.key, s.label, s.position, s.kind from public.organizations o cross join
  (values ('new','Nowy',0,'open'), ('contacted','Skontaktowano',1,'open'),
    ('offer_sent','Oferta wysłana',2,'open'), ('offer_accepted','Oferta zaakceptowana',3,'open'),
    ('contract_sent','Umowa wysłana',4,'open'), ('deposit_paid','Zadatek wpłacony',5,'won'),
    ('rejected','Odrzucony',6,'lost'), ('spam','Spam',7,'lost')) s(key,label,position,kind);

-- Read: every member. Configuration: owner/admin. Tenant keys cannot be updated.
do $$
declare t text;
begin
  foreach t in array array['pipeline_stages','channels','leads','lead_events','lead_tasks','custom_field_defs','intake_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if t <> 'channels' then execute format('grant select on public.%I to authenticated', t); end if;
  end loop;
  foreach t in array array['pipeline_stages','channels','custom_field_defs'] loop
    execute format('create policy "admins insert" on public.%I for insert to authenticated with check (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('create policy "admins update" on public.%I for update to authenticated using (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[])) with check (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('grant insert, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant select (id, organization_id, type, name, public_key, config, status, last_received_at, created_at) on public.channels to authenticated;
grant update (label_pl, position, kind) on public.pipeline_stages to authenticated;
grant update (name, config, status) on public.channels to authenticated;
grant update (label_pl, type, options) on public.custom_field_defs to authenticated;

create policy "members insert leads" on public.leads for insert to authenticated with check (public.is_member(organization_id));
create policy "members update leads" on public.leads for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id));
create policy "members append events" on public.lead_events for insert to authenticated with check (public.is_member(organization_id) and actor_user_id = auth.uid());
create policy "members insert tasks" on public.lead_tasks for insert to authenticated with check (public.is_member(organization_id));
create policy "members update tasks" on public.lead_tasks for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id));
create policy "admins delete tasks" on public.lead_tasks for delete to authenticated using (public.has_role(organization_id, array['owner','admin']::public.member_role[]));
grant insert on public.leads, public.lead_events, public.lead_tasks to authenticated;
grant update (stage_key, client_name, phone_e164, email, event_type, event_date, event_city, venue,
  guests, budget_grosze, message, custom_fields, assigned_to, first_response_at, deleted_at) on public.leads to authenticated;
grant update (due_at, title, done_at) on public.lead_tasks to authenticated;
grant delete on public.lead_tasks to authenticated;
grant usage, select on sequence public.leads_number_seq to authenticated, service_role;

-- Hosted Supabase has this publication; the offline test harness does not.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
