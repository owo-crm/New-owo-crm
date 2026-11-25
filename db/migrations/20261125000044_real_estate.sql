-- Вертикаль «nieruchomości» (кабинет агента недвижимости, первый клиент — Adam).
-- docs/architecture/ADAM_REAL_ESTATE_PHASE0.md. Только новое поведение: event-services и agency
-- не меняются (их ветки скопированы из 20261111000020_agency.sql без правок).

-- ───────────────────────── Воронка по пресету ─────────────────────────
-- Тип обращения (zakup / sprzedaż / refinansowanie / oferta) — не этап: он хранится в теме заявки.
create or replace function public.seed_lead_stages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.industry_preset = 'agency' then
    insert into public.pipeline_stages (organization_id, key, label_pl, position, kind) values
      (new.id, 'new', 'Nowy', 0, 'open'),
      (new.id, 'contacted', 'Kontakt', 1, 'open'),
      (new.id, 'meeting', 'Spotkanie', 2, 'open'),
      (new.id, 'offer_sent', 'Oferta', 3, 'open'),
      (new.id, 'client', 'Klient', 4, 'won'),
      (new.id, 'rejected', 'Odrzucony', 5, 'lost'),
      (new.id, 'spam', 'Spam', 6, 'lost');
    return new;
  end if;
  if new.industry_preset = 'real-estate' then
    insert into public.pipeline_stages (organization_id, key, label_pl, position, kind) values
      (new.id, 'new', 'Nowe zapytanie', 0, 'open'),
      (new.id, 'contacted', 'Skontaktowano', 1, 'open'),
      (new.id, 'consultation', 'Konsultacja', 2, 'open'),
      (new.id, 'viewing', 'Prezentacja nieruchomości', 3, 'open'),
      (new.id, 'negotiation', 'Negocjacje', 4, 'open'),
      (new.id, 'contract', 'Umowa / formalności', 5, 'open'),
      (new.id, 'won', 'Zakończone sukcesem', 6, 'won'),
      (new.id, 'lost', 'Utracone', 7, 'lost'),
      (new.id, 'spam', 'Spam', 8, 'lost');
    return new;
  end if;
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

-- ───────────────────────── Первый владелец кабинета клиента ─────────────────────────
-- Общая create_invitation разрешает приглашение owner только действующему owner, а кабинет клиента
-- создаёт сотрудник OWO (service admin). Отдельная узкая функция, общую не ослабляем:
--   • только админ платформы, являющийся owner/admin агентства;
--   • организация связана с этим агентством явной связью client (platform_managed_orgs);
--   • у организации ещё нет владельца-человека (сервисные admin не считаются);
--   • прежние неиспользованные приглашения владельца отзываются (повторная выдача);
--   • срок 7 дней; каждое действие — в audit_log (без токена).
create function public.create_client_owner_invitation(p_agency uuid, p_organization uuid, p_hash text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token hash' using errcode = '22023'; end if;
  if not public.is_platform_admin()
     or not public.has_role(p_agency, array['owner','admin']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_managed_orgs
                  where agency_org_id = p_agency and org_id = p_organization and relation = 'client') then
    raise exception 'not a client organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships
              where organization_id = p_organization and role = 'owner' and not is_service) then
    raise exception 'owner exists' using errcode = '22023';
  end if;
  update public.invitations set revoked_at = now()
   where organization_id = p_organization and role = 'owner' and accepted_at is null and revoked_at is null;
  insert into public.invitations (organization_id, token_hash, role, note, created_by, expires_at)
  values (p_organization, p_hash, 'owner', nullif(trim(p_note), ''), auth.uid(), now() + interval '7 days')
  returning id into v_id;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, note)
  values (p_organization, auth.uid(), 'owner_invitation.create', 'invitations', v_id::text, 'agency ' || p_agency);
  return v_id;
end;
$$;

create function public.revoke_client_owner_invitation(p_agency uuid, p_organization uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not public.is_platform_admin()
     or not public.has_role(p_agency, array['owner','admin']::public.member_role[])
     or not exists (select 1 from public.platform_managed_orgs
                     where agency_org_id = p_agency and org_id = p_organization and relation = 'client') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now()
   where organization_id = p_organization and role = 'owner' and accepted_at is null and revoked_at is null;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_log (organization_id, actor_id, action, entity, note)
    values (p_organization, auth.uid(), 'owner_invitation.revoke', 'invitations', v_count || ' revoked');
  end if;
  return v_count;
end;
$$;

-- Состояние для кабинета агентства: есть ли владелец и действующее приглашение (без токенов).
create function public.client_owner_status(p_agency uuid, p_organization uuid)
returns table (has_owner boolean, pending_expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role(p_agency, array['owner','admin']::public.member_role[])
     or not exists (select 1 from public.platform_managed_orgs
                     where agency_org_id = p_agency and org_id = p_organization and relation = 'client') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select
    exists (select 1 from public.memberships m where m.organization_id = p_organization and m.role = 'owner' and not m.is_service),
    (select max(i.expires_at) from public.invitations i
      where i.organization_id = p_organization and i.role = 'owner'
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now());
end;
$$;

revoke all on function public.create_client_owner_invitation(uuid, uuid, text, text),
  public.revoke_client_owner_invitation(uuid, uuid), public.client_owner_status(uuid, uuid) from public, anon;
grant execute on function public.create_client_owner_invitation(uuid, uuid, text, text),
  public.revoke_client_owner_invitation(uuid, uuid), public.client_owner_status(uuid, uuid) to authenticated;

-- Принятие приглашения владельца — в журнал (сам механизм accept_invitation не меняется).
create function public.audit_owner_invitation_accept() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id)
  values (new.organization_id, new.accepted_by, 'owner_invitation.accept', 'invitations', new.id::text);
  return new;
end;
$$;
create trigger invitations_owner_accept_audit
  after update of accepted_at on public.invitations
  for each row when (old.accepted_at is null and new.accepted_at is not null and new.role = 'owner')
  execute function public.audit_owner_invitation_accept();
