-- M4.1 — реестр сущностей (OWO_CONFIG_ENGINE_SPEC §2, OWO_CRM_MIGRATION_PLAN M4.1).
-- Номер по фактическому main (0044 real_estate, 0045 lead_topic уже заняты; в старом плане M4.1 = «0041»).
--
-- В этом шаге: entity_types, entity_fields, record_counters и регистрация стандартных сущностей
-- (storage='table'). Не в этом шаге: roles/role_permissions/can() (D-16) — отдельная миграция;
-- движок records (M4.2). Старый код новые таблицы не читает.

create table public.entity_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  storage text not null check (storage in ('records','table')),
  table_name text check ((storage = 'table') = (table_name is not null)),
  module_key text,
  label text not null,
  label_plural text not null,
  icon text check (icon in ('car','user','calendar','home','file','wrench','tag','bank')),
  title_template text not null default '{{name}}',
  config_version_id uuid,
  archived_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, key)
);

create table public.entity_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entity_type_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  type text not null check (type in ('text','long_text','number','money','date','datetime',
        'boolean','select','multiselect','email','phone','url','file','relation','json')),
  label text not null,
  required boolean not null default false,
  is_unique boolean not null default false
    check (not is_unique or type in ('text','email','phone','url','number')),
  searchable boolean not null default false,
  filterable boolean not null default true,
  sensitive boolean not null default false,
  default_value jsonb,
  validation jsonb not null default '{}',
  options jsonb,
  relation jsonb,
  json_schema_key text,
  position int not null default 0,
  column_name text,
  archived_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, entity_type_id, key),
  foreign key (organization_id, entity_type_id) references public.entity_types(organization_id, id) on delete cascade,
  check ((type = 'relation') = (relation is not null)),
  check ((type = 'json') = (json_schema_key is not null))
);

create table public.record_counters (
  organization_id uuid not null,
  entity_type_id uuid not null,
  last bigint not null default 0 check (last >= 0),
  primary key (organization_id, entity_type_id),
  foreign key (organization_id, entity_type_id) references public.entity_types(organization_id, id) on delete cascade
);

-- Чтение — участникам организации; запись — только миграциями и функциями платформы (D-07).
do $$
declare t text;
begin
  foreach t in array array['entity_types','entity_fields','record_counters'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ───────────────────────── Регистрация стандартных сущностей ─────────────────────────
-- Идемпотентно: существующие типы и поля не меняются (поля «никогда не удаляются», spec §6.2).
create function public.register_standard_entities(p_organization uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_preset text; v_leads uuid; v_props uuid;
begin
  select industry_preset into v_preset from public.organizations where id = p_organization;
  if not found then return; end if;

  insert into public.entity_types (organization_id, key, storage, table_name, label, label_plural, icon, title_template)
  values (p_organization, 'leads', 'table', 'leads', 'Lead', 'Leady', 'user', '{{client_name}}')
  on conflict (organization_id, key) do nothing;
  select id into v_leads from public.entity_types where organization_id = p_organization and key = 'leads';

  insert into public.entity_fields (organization_id, entity_type_id, key, type, label, required, searchable, position, column_name)
  values
    (p_organization, v_leads, 'client_name', 'text', 'Imię i nazwisko', true, true, 0, 'client_name'),
    (p_organization, v_leads, 'phone', 'phone', 'Telefon', false, true, 1, 'phone_e164'),
    (p_organization, v_leads, 'email', 'email', 'E-mail', false, true, 2, 'email'),
    (p_organization, v_leads, 'topic', 'text', 'Temat zapytania', false, false, 3, 'topic'),
    (p_organization, v_leads, 'city', 'text', 'Miejscowość', false, false, 4, 'event_city'),
    (p_organization, v_leads, 'budget', 'money', 'Budżet', false, false, 5, 'budget_grosze'),
    (p_organization, v_leads, 'message', 'long_text', 'Wiadomość', false, false, 6, 'message')
  on conflict (organization_id, entity_type_id, key) do nothing;

  if v_preset <> 'real-estate' then
    -- Поля мероприятия — только у тех, у кого они используются.
    insert into public.entity_fields (organization_id, entity_type_id, key, type, label, position, column_name)
    values
      (p_organization, v_leads, 'event_type', 'text', 'Rodzaj wydarzenia', 10, 'event_type'),
      (p_organization, v_leads, 'event_date', 'date', 'Data wydarzenia', 11, 'event_date'),
      (p_organization, v_leads, 'venue', 'text', 'Miejsce', 12, 'venue'),
      (p_organization, v_leads, 'guests', 'number', 'Liczba gości', 13, 'guests')
    on conflict (organization_id, entity_type_id, key) do nothing;
  end if;

  -- Nieruchomości: tabela properties (migracja 0048). Rejestrujemy tylko w kabinetach real-estate.
  if v_preset = 'real-estate' then
    insert into public.entity_types (organization_id, key, storage, table_name, module_key, label, label_plural, icon, title_template)
    values (p_organization, 'properties', 'table', 'properties', 'real-estate', 'Nieruchomość', 'Nieruchomości', 'home', '{{title}}')
    on conflict (organization_id, key) do nothing;
    select id into v_props from public.entity_types where organization_id = p_organization and key = 'properties';
    insert into public.entity_fields (organization_id, entity_type_id, key, type, label, required, searchable, position, column_name, options)
    values
      (p_organization, v_props, 'title', 'text', 'Tytuł', true, true, 0, 'title', null),
      (p_organization, v_props, 'slug', 'text', 'Adres strony (slug)', true, true, 1, 'slug', null),
      (p_organization, v_props, 'property_type', 'select', 'Rodzaj', true, false, 2, 'property_type',
        '[{"key":"apartment","label":"Mieszkanie"},{"key":"house","label":"Dom"},{"key":"land","label":"Działka"},{"key":"commercial","label":"Lokal użytkowy"},{"key":"other","label":"Inne"}]'),
      (p_organization, v_props, 'city', 'text', 'Miasto', false, false, 3, 'city', null),
      (p_organization, v_props, 'district', 'text', 'Dzielnica', false, false, 4, 'district', null),
      (p_organization, v_props, 'price', 'money', 'Cena', false, false, 5, 'price_grosze', null),
      (p_organization, v_props, 'area_m2', 'number', 'Powierzchnia (m²)', false, false, 6, 'area_m2', null),
      (p_organization, v_props, 'rooms', 'number', 'Pokoje', false, false, 7, 'rooms', null),
      (p_organization, v_props, 'listing_status', 'select', 'Status oferty', true, false, 8, 'listing_status',
        '[{"key":"active","label":"Aktywna"},{"key":"reserved","label":"Rezerwacja"},{"key":"sold","label":"Sprzedana"},{"key":"withdrawn","label":"Wycofana"}]'),
      (p_organization, v_props, 'publication_status', 'select', 'Publikacja', true, false, 9, 'publication_status',
        '[{"key":"draft","label":"Szkic"},{"key":"published","label":"Opublikowana"},{"key":"unpublished","label":"Zdjęta ze strony"}]'),
      (p_organization, v_props, 'description', 'long_text', 'Opis', false, false, 10, 'description', null)
    on conflict (organization_id, entity_type_id, key) do nothing;
  end if;
end;
$$;
revoke all on function public.register_standard_entities(uuid) from public, anon, authenticated;

create function public.organizations_register_entities() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.register_standard_entities(new.id);
  return new;
end;
$$;
create trigger organizations_register_entities
  after insert or update of industry_preset on public.organizations
  for each row execute function public.organizations_register_entities();

-- Существующие организации.
do $$
declare o uuid;
begin
  for o in select id from public.organizations loop
    perform public.register_standard_entities(o);
  end loop;
end $$;
