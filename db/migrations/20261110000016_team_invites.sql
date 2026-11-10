-- 0016 · Команда и приглашения: ссылка-приглашение в бизнес (сотрудник или клиент OWO Ads).

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role public.member_role not null default 'member',
  note text check (char_length(note) <= 120),
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index invitations_org_idx on public.invitations (organization_id, created_at desc);
alter table public.invitations enable row level security;
create policy "admins read invitations" on public.invitations for select to authenticated
  using (public.has_role(organization_id, array['owner','admin']::public.member_role[]));
revoke all on public.invitations from anon, authenticated;
grant select (id, organization_id, role, note, created_at, expires_at, accepted_by, accepted_at, revoked_at)
  on public.invitations to authenticated;
grant all on public.invitations to service_role;

-- Приглашать может owner/admin; роль owner выдаёт только owner.
create function public.create_invitation(p_organization uuid, p_hash text, p_role public.member_role, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token hash' using errcode = '22023'; end if;
  if not public.has_role(p_organization, array['owner','admin']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role = 'owner' and not public.has_role(p_organization, array['owner']::public.member_role[]) then
    raise exception 'only owner invites owner' using errcode = '42501';
  end if;
  insert into public.invitations (organization_id, token_hash, role, note, created_by)
  values (p_organization, p_hash, p_role, nullif(trim(p_note), ''), auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_invitation(p_organization uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_organization, array['owner','admin']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now()
   where organization_id = p_organization and id = p_id and accepted_at is null and revoked_at is null;
  return found;
end;
$$;

-- Принять приглашение: одноразово, вошедший пользователь становится участником.
create function public.accept_invitation(p_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_inv public.invitations; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from public.invitations where token_hash = p_hash for update;
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'invitation invalid' using errcode = '22023';
  end if;
  insert into public.memberships (organization_id, user_id, role) values (v_inv.organization_id, v_user, v_inv.role)
  on conflict (organization_id, user_id) do nothing;
  update public.invitations set accepted_by = v_user, accepted_at = now() where id = v_inv.id;
  return v_inv.organization_id;
end;
$$;

revoke all on function public.create_invitation(uuid, text, public.member_role, text),
  public.revoke_invitation(uuid, uuid), public.accept_invitation(text) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.member_role, text),
  public.revoke_invitation(uuid, uuid), public.accept_invitation(text) to authenticated;

-- Роль участника меняет только owner; последнего владельца понизить нельзя.
create function public.set_member_role(p_organization uuid, p_user uuid, p_role public.member_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_organization, array['owner']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role <> 'owner' and (select count(*) from public.memberships where organization_id = p_organization and role = 'owner' and user_id <> p_user) = 0 then
    raise exception 'last owner' using errcode = '22023';
  end if;
  update public.memberships set role = p_role where organization_id = p_organization and user_id = p_user;
end;
$$;
revoke all on function public.set_member_role(uuid, uuid, public.member_role) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, public.member_role) to authenticated;

-- Имя в команде: логин/e-mail участника виден коллегам по фирме (для списка команды).
create function public.team_members(p_organization uuid)
returns table (user_id uuid, role public.member_role, name text, login text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role,
    coalesce(nullif(m.display_name, ''), nullif(p.full_name, ''), u.email) as name, u.email as login, m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.organization_id = p_organization and public.is_member(p_organization)
  order by m.created_at;
$$;
revoke all on function public.team_members(uuid) from public, anon;
grant execute on function public.team_members(uuid) to authenticated;

-- Админ платформы (OWO Ads): создаёт новые бизнесы. Первым становится самый ранний аккаунт.
update auth.users set is_platform_admin = true
 where id = (select id from auth.users order by created_at limit 1)
   and not exists (select 1 from auth.users where is_platform_admin);

-- Импорт из таблицы бота: поля мероприятия и заметка (только для только что вставленного лида).
create function public.import_legacy_extras(p_organization uuid, p_lead uuid, p_extras jsonb, p_note text, p_assigned_name text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_user uuid;
begin
  select m.user_id into v_user from public.team_members_raw(p_organization) m
   where lower(m.name) = lower(nullif(trim(p_assigned_name), '')) limit 1;
  update public.leads set
    package_name = nullif(left(p_extras->>'package_name', 60), ''),
    service_hours = nullif(left(p_extras->>'service_hours', 80), ''),
    client_full_name = nullif(left(p_extras->>'client_full_name', 500), ''),
    client_address = nullif(left(p_extras->>'client_address', 500), ''),
    assigned_to = v_user
  where organization_id = p_organization and id = p_lead;
  if nullif(trim(p_note), '') is not null then
    insert into public.lead_events (organization_id, lead_id, type, payload)
    values (p_organization, p_lead, 'note', jsonb_build_object('text', left(p_note, 5000), 'imported', true));
  end if;
end;
$$;
create function public.team_members_raw(p_organization uuid)
returns table (user_id uuid, name text) language sql stable security invoker set search_path = '' as $$
  select m.user_id, coalesce(nullif(m.display_name, ''), nullif(p.full_name, ''), u.email)
  from public.memberships m join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.organization_id = p_organization;
$$;
revoke all on function public.import_legacy_extras(uuid, uuid, jsonb, text, text), public.team_members_raw(uuid) from public, anon, authenticated;
grant execute on function public.import_legacy_extras(uuid, uuid, jsonb, text, text), public.team_members_raw(uuid) to service_role;
