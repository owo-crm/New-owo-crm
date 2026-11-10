-- 0001 · Фирмы, участники, профили + RLS
-- Каждая фирма видит только свои данные. Проверка — функция is_member().
-- Описание: docs/02-data-model.md

-- ───────────────────────── Типы ─────────────────────────
create type public.member_role as enum ('owner', 'admin', 'member');

-- ───────────────────────── Таблицы ─────────────────────────
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 120),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  industry_preset  text not null default 'event-services',
  legal_name       text,
  nip              text,
  address          text,
  phone            text,
  email            text,
  website          text,
  bank_account     text,
  logo_path        text,
  brand_color      text not null default '#e8000d' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  brand_fonts      jsonb not null default '{}'::jsonb,
  timezone         text not null default 'Europe/Warsaw',
  plan             text not null default 'trial',
  trial_ends_at    timestamptz not null default (now() + interval '14 days'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.memberships (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.member_role not null default 'member',
  display_name     text,
  phone            text,
  created_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  locale       text not null default 'pl',
  quiet_hours  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ───────────────────────── updated_at ─────────────────────────
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────────────────────── Проверки доступа ─────────────────────────
-- security definer: читают memberships в обход RLS (иначе политика ссылалась бы сама на себя).
create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create function public.has_role(org uuid, roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

-- Состоят ли два пользователя в общей фирме (чтобы видеть профили коллег).
create function public.shares_organization(other_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other_user
  );
$$;

-- ───────────────────────── Профиль при регистрации ─────────────────────────
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Создание фирмы ─────────────────────────
-- Пользователь не может сам вставить строку в memberships (RLS), поэтому фирма
-- и роль владельца создаются одной безопасной функцией.
create function public.create_organization(p_name text, p_slug text, p_preset text default 'event-services')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_slug text := p_slug;
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid slug' using errcode = '22023';
  end if;

  -- Если адрес занят — добавляем короткий случайный хвост.
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_slug := p_slug || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into public.organizations (name, slug, industry_preset)
  values (trim(p_name), v_slug, coalesce(p_preset, 'event-services'))
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  return v_org;
end;
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.profiles      enable row level security;

create policy "members read organization" on public.organizations
  for select to authenticated using ((select public.is_member(id)));
create policy "admins update organization" on public.organizations
  for update to authenticated
  using ((select public.has_role(id, array['owner', 'admin']::public.member_role[])))
  with check ((select public.has_role(id, array['owner', 'admin']::public.member_role[])));

create policy "members read memberships" on public.memberships
  for select to authenticated using ((select public.is_member(organization_id)));
create policy "admins manage memberships" on public.memberships
  for update to authenticated
  using ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])))
  with check ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));
-- Владельца удалить нельзя (передача владения — отдельной функцией позже).
create policy "admins remove memberships" on public.memberships
  for delete to authenticated
  using (
    role <> 'owner'
    and (select public.has_role(organization_id, array['owner', 'admin']::public.member_role[]))
  );

create policy "read own or teammate profile" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.shares_organization(user_id)));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── Права ─────────────────────────
-- Гости (anon) не получают доступа к этим таблицам вообще.
revoke all on public.organizations, public.memberships, public.profiles from anon;
revoke all on public.organizations, public.memberships, public.profiles from authenticated;
-- Обновлять можно только перечисленные колонки: план и пробный период клиент менять не может,
-- роли меняются отдельной функцией (задача 4.2).
grant select on public.organizations to authenticated;
grant update (name, industry_preset, legal_name, nip, address, phone, email, website,
              bank_account, logo_path, brand_color, brand_fonts, timezone)
  on public.organizations to authenticated;
grant select, delete on public.memberships to authenticated;
grant update (display_name, phone) on public.memberships to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, locale, quiet_hours) on public.profiles to authenticated;

revoke all on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
