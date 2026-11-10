-- 0009 · One-use Telegram linking. Bot access uses both private chat and Telegram user ID.
create table public.telegram_links (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  chat_id bigint unique,
  telegram_user_id bigint,
  link_token_hash text unique check(link_token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz,
  linked_at timestamptz,
  primary key (organization_id,user_id),
  foreign key (organization_id,user_id) references public.memberships(organization_id,user_id) on delete cascade
);
alter table public.telegram_links enable row level security;
create policy "read own telegram link" on public.telegram_links for select to authenticated using (user_id=auth.uid() and public.is_member(organization_id));
revoke all on public.telegram_links from anon,authenticated;
grant select(organization_id,user_id,chat_id,linked_at) on public.telegram_links to authenticated;
grant all on public.telegram_links to service_role;
create function public.create_telegram_link(p_organization uuid,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token hash';end if;
  if not public.is_member(p_organization) then raise exception 'not a member' using errcode='42501'; end if;
  insert into public.telegram_links(organization_id,user_id,link_token_hash,token_expires_at)
  values(p_organization,auth.uid(),p_hash,now()+interval '10 minutes')
  on conflict(organization_id,user_id) do update set link_token_hash=excluded.link_token_hash,token_expires_at=excluded.token_expires_at;
end;
$$;
create function public.redeem_telegram_link(p_hash text,p_chat bigint,p_user bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.telegram_links set chat_id=p_chat,telegram_user_id=p_user,link_token_hash=null,token_expires_at=null,linked_at=now()
  where link_token_hash=p_hash and token_expires_at>now();
  return found;
end;
$$;
create function public.telegram_ingest(p_chat bigint,p_user bigint,p_input jsonb,p_update bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_link public.telegram_links; v_channel public.channels; v_result jsonb; v_existing public.leads;
begin
  select * into v_link from public.telegram_links where chat_id=p_chat and telegram_user_id=p_user;
  if not found then raise exception 'not linked' using errcode='42501';end if;
  perform 1 from public.memberships where organization_id=v_link.organization_id and user_id=v_link.user_id;
  if not found then raise exception 'not a member' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_link.organization_id::text || ':telegram:' || p_update::text,2));
  select * into v_existing from public.leads where organization_id=v_link.organization_id and legacy_uid='telegram:'||p_update::text;
  if found then return jsonb_build_object('id',v_existing.id,'number',v_existing.number,'duplicate_ids','[]'::jsonb);end if;
  perform set_config('request.jwt.claim.sub',v_link.user_id::text,true);
  select * into v_channel from public.channels where organization_id=v_link.organization_id and type='manual' limit 1;
  v_result := public.ingest_lead(v_link.organization_id,v_channel.id,'Telegram',null,p_input);
  update public.leads set legacy_uid='telegram:'||p_update::text where id=(v_result->>'id')::uuid and organization_id=v_link.organization_id;
  return v_result;
end;
$$;
create function public.telegram_contact_lead(p_chat bigint,p_user bigint,p_lead uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_link public.telegram_links; v_lead public.leads;
begin
  select * into v_link from public.telegram_links where chat_id=p_chat and telegram_user_id=p_user;
  if not found then return false;end if;
  perform 1 from public.memberships where organization_id=v_link.organization_id and user_id=v_link.user_id;
  if not found then return false;end if;
  select * into v_lead from public.leads where organization_id=v_link.organization_id and id=p_lead and deleted_at is null for update;
  if not found then return false;end if;
  if v_lead.first_response_at is not null then return true;end if;
  perform set_config('request.jwt.claim.sub',v_link.user_id::text,true);
  perform public.change_lead(v_link.organization_id,v_lead.id,v_lead.updated_at,jsonb_build_object('stage_key',case when v_lead.stage_key='new' then 'contacted' else v_lead.stage_key end));
  return true;
end;
$$;
grant execute on function public.change_lead(uuid,uuid,timestamptz,jsonb) to service_role;
revoke all on function public.create_telegram_link(uuid,text) from public,anon;
grant execute on function public.create_telegram_link(uuid,text) to authenticated;
revoke all on function public.redeem_telegram_link(text,bigint,bigint),public.telegram_ingest(bigint,bigint,jsonb,bigint),public.telegram_contact_lead(bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.redeem_telegram_link(text,bigint,bigint),public.telegram_ingest(bigint,bigint,jsonb,bigint),public.telegram_contact_lead(bigint,bigint,uuid) to service_role;

grant select on public.memberships to service_role;
