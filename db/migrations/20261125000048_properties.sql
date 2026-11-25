-- Nieruchomości (ADR approved 2026-11-25, docs/architecture/ADAM_REAL_ESTATE_PHASE0.md §3).
-- Типизированная таблица; публикация и статус продажи раздельно; цена в грошах; публичный адрес
-- отдельно от приватного; slug уникален в организации. Фото — property_media → files (только s3).
-- Связь заявка ↔ объект — lead_property_interests. История — audit_log (без property_events).

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 120),
  title text not null check (char_length(title) between 3 and 160),
  excerpt text check (char_length(excerpt) <= 300),
  description text check (char_length(description) <= 20000),
  property_type text not null default 'apartment' check (property_type in ('apartment','house','land','commercial','other')),
  offer_type text not null default 'sale' check (offer_type in ('sale')),
  city text check (char_length(city) <= 120),
  district text check (char_length(district) <= 120),
  voivodeship text check (char_length(voivodeship) <= 60),
  public_address text check (char_length(public_address) <= 200),
  street_address_private text check (char_length(street_address_private) <= 200),
  address_visibility text not null default 'district_only' check (address_visibility in ('full','district_only','hidden')),
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  price_grosze bigint check (price_grosze > 0 and price_grosze <= 100000000000),
  currency text not null default 'PLN' check (currency = 'PLN'),
  area_m2 numeric(8,2) check (area_m2 > 0 and area_m2 <= 100000),
  rooms smallint check (rooms between 0 and 50),
  floor smallint check (floor between -5 and 200),
  building_floors smallint check (building_floors between 0 and 200),
  market_type text check (market_type in ('primary','secondary')),
  build_year smallint check (build_year between 1800 and 2100),
  features text[] not null default '{}' check (cardinality(features) <= 40),
  publication_status text not null default 'draft' check (publication_status in ('draft','published','unpublished')),
  listing_status text not null default 'active' check (listing_status in ('active','reserved','sold','withdrawn')),
  seo_title text check (char_length(seo_title) <= 70),
  seo_description text check (char_length(seo_description) <= 170),
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, slug),
  -- Ключи характеристик — короткие безопасные идентификаторы, не HTML.
  check (features <@ array['balcony','terrace','garden','parking','garage','elevator','basement','furnished','sea_view','air_conditioning']::text[]),
  check (publication_status <> 'published' or published_at is not null)
);
create index properties_list_idx on public.properties (organization_id, publication_status, listing_status, published_at desc) where deleted_at is null;
create index properties_city_idx on public.properties (organization_id, city, district) where deleted_at is null;
create index properties_price_idx on public.properties (organization_id, price_grosze) where deleted_at is null;
create index properties_area_idx on public.properties (organization_id, area_m2) where deleted_at is null;

create table public.property_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  property_id uuid not null,
  file_id uuid not null,
  alt_text text check (char_length(alt_text) <= 200),
  position smallint not null default 0 check (position between 0 and 200),
  is_cover boolean not null default false,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, file_id),
  foreign key (organization_id, property_id) references public.properties(organization_id, id) on delete cascade,
  foreign key (organization_id, file_id) references public.files(organization_id, id)
);
create unique index property_media_one_cover on public.property_media (organization_id, property_id) where is_cover;
create index property_media_order on public.property_media (organization_id, property_id, position);

create table public.lead_property_interests (
  organization_id uuid not null,
  lead_id uuid not null,
  property_id uuid not null,
  interest_type text not null default 'inquiry' check (interest_type in ('inquiry','viewing','offer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, lead_id, property_id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, property_id) references public.properties(organization_id, id) on delete cascade
);
create index lead_property_interests_property on public.lead_property_interests (organization_id, property_id);

-- Фото объекта — только файлы этой организации, назначения property_media и уже в bucket.
create function public.property_media_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.files f
                  where f.organization_id = new.organization_id and f.id = new.file_id
                    and f.purpose = 'property_media' and f.storage = 's3' and f.deleted_at is null
                    and f.content_type in ('image/jpeg','image/png','image/webp')) then
    raise exception 'invalid property media file' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger property_media_check before insert or update of file_id on public.property_media
  for each row execute function public.property_media_check();

-- ───────────────────────── RLS ─────────────────────────
-- Читают участники; создают и правят owner/admin/member; публикуют и удаляют — owner/admin
-- (публикация — отдельной функцией ниже; столбцы публикации клиенту напрямую не выдаются).
alter table public.properties enable row level security;
alter table public.property_media enable row level security;
alter table public.lead_property_interests enable row level security;

create policy "members read" on public.properties for select to authenticated
  using (public.is_member(organization_id) and deleted_at is null);
create policy "members insert" on public.properties for insert to authenticated
  with check (public.is_member(organization_id) and publication_status = 'draft');
create policy "members update" on public.properties for update to authenticated
  using (public.is_member(organization_id) and deleted_at is null)
  with check (public.is_member(organization_id));

create policy "members read" on public.property_media for select to authenticated using (public.is_member(organization_id));
create policy "members write" on public.property_media for all to authenticated
  using (public.is_member(organization_id)) with check (public.is_member(organization_id));

create policy "members read" on public.lead_property_interests for select to authenticated using (public.is_member(organization_id));
create policy "members write" on public.lead_property_interests for insert to authenticated with check (public.is_member(organization_id));

revoke all on public.properties, public.property_media, public.lead_property_interests from anon, authenticated;
grant select on public.properties, public.property_media, public.lead_property_interests to authenticated;
grant insert (organization_id, slug, title, excerpt, description, property_type, city, district, voivodeship,
              public_address, street_address_private, address_visibility, latitude, longitude, price_grosze,
              area_m2, rooms, floor, building_floors, market_type, build_year, features, listing_status,
              seo_title, seo_description, created_by, updated_by)
  on public.properties to authenticated;
grant update (slug, title, excerpt, description, property_type, city, district, voivodeship,
              public_address, street_address_private, address_visibility, latitude, longitude, price_grosze,
              area_m2, rooms, floor, building_floors, market_type, build_year, features, listing_status,
              seo_title, seo_description, updated_by, updated_at)
  on public.properties to authenticated;
grant insert, update (alt_text, position, is_cover, is_public), delete on public.property_media to authenticated;
grant insert on public.lead_property_interests to authenticated;

-- ───────────────────────── Аудит: цена, статус продажи ─────────────────────────
create function public.properties_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.price_grosze is distinct from old.price_grosze then
      insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, before, after)
      values (new.organization_id, auth.uid(), 'property.price', 'properties', new.id::text,
              jsonb_build_object('price_grosze', old.price_grosze), jsonb_build_object('price_grosze', new.price_grosze));
    end if;
    if new.listing_status is distinct from old.listing_status then
      insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, before, after)
      values (new.organization_id, auth.uid(), 'property.listing_status', 'properties', new.id::text,
              jsonb_build_object('listing_status', old.listing_status), jsonb_build_object('listing_status', new.listing_status));
    end if;
  else
    insert into public.audit_log (organization_id, actor_id, action, entity, entity_id)
    values (new.organization_id, auth.uid(), 'property.create', 'properties', new.id::text);
  end if;
  return new;
end;
$$;
create trigger properties_audit before insert or update on public.properties
  for each row execute function public.properties_audit();

create function public.property_media_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, after)
  values (r.organization_id, auth.uid(), case when tg_op = 'DELETE' then 'property.media_remove' else 'property.media_add' end,
          'properties', r.property_id::text, jsonb_build_object('media_id', r.id));
  return null;
end;
$$;
create trigger property_media_audit after insert or delete on public.property_media
  for each row execute function public.property_media_audit();

-- ───────────────────────── Публикация (owner/admin) ─────────────────────────
-- Публикация не автоматическая: только явным вызовом. Требует обложку (фото с is_cover и is_public).
create function public.property_set_publication(p_organization uuid, p_property uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.properties;
begin
  if p_status not in ('draft','published','unpublished') then raise exception 'invalid status' using errcode = '22023'; end if;
  if not public.has_role(p_organization, array['owner','admin']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v from public.properties where organization_id = p_organization and id = p_property and deleted_at is null for update;
  if not found then raise exception 'property not found' using errcode = '42501'; end if;
  if p_status = 'published' and not exists (
       select 1 from public.property_media m where m.organization_id = p_organization and m.property_id = p_property
          and m.is_cover and m.is_public) then
    raise exception 'cover required' using errcode = '22023';
  end if;
  update public.properties
     set publication_status = p_status,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
         unpublished_at = case when p_status = 'unpublished' then now() else unpublished_at end,
         updated_by = auth.uid()
   where organization_id = p_organization and id = p_property;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, before, after)
  values (p_organization, auth.uid(), 'property.publication', 'properties', p_property::text,
          jsonb_build_object('publication_status', v.publication_status), jsonb_build_object('publication_status', p_status));
end;
$$;

-- Архивация (soft delete) — owner/admin; публичная страница сразу исчезает.
create function public.property_archive(p_organization uuid, p_property uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_organization, array['owner','admin']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.properties set deleted_at = now(), publication_status = 'unpublished', unpublished_at = now(), updated_by = auth.uid()
   where organization_id = p_organization and id = p_property and deleted_at is null;
  if not found then raise exception 'property not found' using errcode = '42501'; end if;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id)
  values (p_organization, auth.uid(), 'property.archive', 'properties', p_property::text);
end;
$$;

revoke all on function public.property_set_publication(uuid, uuid, text), public.property_archive(uuid, uuid) from public, anon;
grant execute on function public.property_set_publication(uuid, uuid, text), public.property_archive(uuid, uuid) to authenticated;
revoke all on function public.properties_audit(), public.property_media_audit(), public.property_media_check() from public, anon, authenticated;

-- ───────────────────────── Регистрация загруженного фото ─────────────────────────
-- Сервер уже записал объект в приватный bucket по ключу org/<org>/<id> и проверил формат,
-- размер и sha256; здесь — только метаданные. Ключ строится функцией, а не принимается от клиента.
create function public.file_register_s3(p_organization uuid, p_id uuid, p_filename text, p_content_type text,
                                        p_size bigint, p_sha256 text, p_purpose text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_organization) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_purpose <> 'property_media' or p_content_type not in ('image/jpeg','image/png','image/webp')
     or p_size is null or p_size <= 0 or p_size > 15728640 then
    raise exception 'invalid file' using errcode = '22023';
  end if;
  insert into public.files (id, organization_id, filename, content_type, size_bytes, sha256, storage, storage_key, purpose, created_by)
  values (p_id, p_organization, p_filename, p_content_type, p_size, p_sha256, 's3',
          'org/' || p_organization || '/' || p_id, p_purpose, auth.uid());
  return p_id;
end;
$$;
revoke all on function public.file_register_s3(uuid, uuid, text, text, bigint, text, text) from public, anon;
grant execute on function public.file_register_s3(uuid, uuid, text, text, bigint, text, text) to authenticated;

-- ───────────────────────── Заявка со страницы объекта ─────────────────────────
-- Вызывает только сервер приёма заявок (организация уже определена каналом). Объект ищется
-- по slug внутри той же организации и должен быть опубликован; иначе связь не создаётся.
create function public.link_lead_property(p_organization uuid, p_lead uuid, p_slug text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_property uuid;
begin
  select id into v_property from public.properties
   where organization_id = p_organization and slug = p_slug
     and publication_status = 'published' and deleted_at is null;
  if v_property is null or not exists (select 1 from public.leads where organization_id = p_organization and id = p_lead) then
    return false;
  end if;
  insert into public.lead_property_interests (organization_id, lead_id, property_id)
  values (p_organization, p_lead, v_property) on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.link_lead_property(uuid, uuid, text) from public, anon, authenticated;
