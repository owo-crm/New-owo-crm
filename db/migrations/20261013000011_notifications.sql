-- 0011 · Durable outbox, user preferences, leased retries and unanswered reminders.
create table public.notification_settings (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null,
 channel text not null check(channel in ('telegram','push','email')),
 enabled boolean not null default true,
 events text[] not null default array['new_lead','unanswered_15m','unanswered_2h']
   check(events <@ array['new_lead','unanswered_15m','unanswered_2h']::text[]),
 primary key(organization_id,user_id,channel),
 foreign key(organization_id,user_id) references public.memberships(organization_id,user_id) on delete cascade
);
create table public.notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 lead_id uuid not null,
 user_id uuid not null,
 channel text not null check(channel in ('telegram','push','email')),
 kind text not null check(kind in ('new_lead','unanswered_15m','unanswered_2h')),
 status text not null default 'queued' check(status in ('queued','processing','failed','sent','skipped','dead')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 next_attempt_at timestamptz not null default now(),
 locked_at timestamptz,
 lease_token uuid,
 sent_at timestamptz,
 error text,
 created_at timestamptz not null default now(),
 unique(organization_id,lead_id,user_id,channel,kind),
 foreign key(organization_id,lead_id) references public.leads(organization_id,id) on delete cascade,
 foreign key(organization_id,user_id) references public.memberships(organization_id,user_id) on delete cascade
);
create index notification_due_idx on public.notification_deliveries(next_attempt_at) where status in ('queued','failed','processing');
alter table public.notification_settings enable row level security;
alter table public.notification_deliveries enable row level security;
create policy "own notification preferences" on public.notification_settings for select to authenticated using(user_id=auth.uid() and public.is_member(organization_id));
create policy "update own preferences" on public.notification_settings for update to authenticated using(user_id=auth.uid() and public.is_member(organization_id)) with check(user_id=auth.uid() and public.is_member(organization_id));
create policy "read deliveries" on public.notification_deliveries for select to authenticated using(public.is_member(organization_id) and (user_id=auth.uid() or public.has_role(organization_id,array['owner','admin']::public.member_role[])));
revoke all on public.notification_settings,public.notification_deliveries from anon,authenticated;
grant select on public.notification_settings,public.notification_deliveries to authenticated;
grant update(enabled,events) on public.notification_settings to authenticated;
grant all on public.notification_settings,public.notification_deliveries to service_role;
create function public.seed_notification_settings() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.notification_settings(organization_id,user_id,channel) select new.organization_id,new.user_id,c from unnest(array['telegram','push','email']) c;
 return new;
end;
$$;
revoke all on function public.seed_notification_settings() from public,anon,authenticated;
create trigger member_notification_settings after insert on public.memberships for each row execute function public.seed_notification_settings();
insert into public.notification_settings(organization_id,user_id,channel) select m.organization_id,m.user_id,c from public.memberships m cross join unnest(array['telegram','push','email']) c;

create function public.enqueue_lead_notifications() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- History imports are explicitly silent; Telegram commands set their legacy UID after ingestion.
 if new.legacy_uid is not null then return new;end if;
 insert into public.notification_deliveries(organization_id,lead_id,user_id,channel,kind)
 select new.organization_id,new.id,s.user_id,s.channel,'new_lead' from public.notification_settings s
 where s.organization_id=new.organization_id and s.enabled and 'new_lead'=any(s.events)
 and (s.channel='email' or (s.channel='telegram' and exists(select 1 from public.telegram_links t where t.organization_id=s.organization_id and t.user_id=s.user_id and t.chat_id is not null))
 or (s.channel='push' and exists(select 1 from public.push_subscriptions p where p.organization_id=s.organization_id and p.user_id=s.user_id))) on conflict do nothing;
 return new;
end;
$$;
revoke all on function public.enqueue_lead_notifications() from public,anon,authenticated;
create trigger lead_notification_outbox after insert on public.leads for each row execute function public.enqueue_lead_notifications();

create function public.prepare_notification_jobs() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.notification_deliveries d set status='skipped',error=null
 where d.kind<>'new_lead' and d.status in ('queued','failed') and exists(
  select 1 from public.leads l join public.pipeline_stages s on s.organization_id=l.organization_id and s.key=l.stage_key
  where l.organization_id=d.organization_id and l.id=d.lead_id and (l.deleted_at is not null or l.first_response_at is not null or s.kind<>'open'));
 update public.notification_deliveries set status='dead',error='worker_timeout',lease_token=null,locked_at=null
 where status='processing' and attempts>=5 and locked_at<now()-interval '5 minutes';
 insert into public.notification_deliveries(organization_id,lead_id,user_id,channel,kind)
 select l.organization_id,l.id,s.user_id,s.channel,k.kind from public.leads l
 join public.pipeline_stages st on st.organization_id=l.organization_id and st.key=l.stage_key
 join public.notification_settings s on s.organization_id=l.organization_id
 join public.memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
 cross join (values ('unanswered_15m'),('unanswered_2h')) k(kind)
 where l.deleted_at is null and l.first_response_at is null and st.kind='open' and s.enabled and k.kind=any(s.events)
 and l.created_at>=now()-interval '7 days'
 and ((k.kind='unanswered_15m' and l.created_at<=now()-interval '15 minutes' and l.created_at>now()-interval '2 hours')
 or (k.kind='unanswered_2h' and l.created_at<=now()-interval '2 hours' and m.role in ('owner','admin')))
 and (s.channel='email' or (s.channel='telegram' and exists(select 1 from public.telegram_links t where t.organization_id=s.organization_id and t.user_id=s.user_id and t.chat_id is not null))
 or (s.channel='push' and exists(select 1 from public.push_subscriptions p where p.organization_id=s.organization_id and p.user_id=s.user_id))) on conflict do nothing;
 delete from public.intake_log where received_at<now()-interval '30 days';
end;
$$;
create function public.claim_notification_jobs(p_lead uuid default null,p_limit integer default 50)
returns setof public.notification_deliveries language sql volatile security invoker set search_path='' as $$
 with pending as (
  select id from public.notification_deliveries where (p_lead is null or lead_id=p_lead) and attempts<5 and next_attempt_at<=now()
  and (status in ('queued','failed') or (status='processing' and locked_at<now()-interval '5 minutes'))
  order by next_attempt_at,id for update skip locked limit greatest(1,least(p_limit,100))
 ) update public.notification_deliveries d set status='processing',attempts=d.attempts+1,locked_at=now(),lease_token=gen_random_uuid()
 from pending p where d.id=p.id returning d.*;
$$;
create function public.finish_notification_job(p_id uuid,p_lease uuid,p_outcome text,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_outcome not in ('sent','skipped','failed') then raise exception 'invalid outcome';end if;
 update public.notification_deliveries set
 status=case when p_outcome='failed' and attempts>=5 then 'dead' else p_outcome end,
 next_attempt_at=case when p_outcome='failed' then now()+make_interval(mins=>power(2,attempts-1)::integer) else next_attempt_at end,
 sent_at=case when p_outcome='sent' then now() else null end,
 error=left(p_error,300),locked_at=null,lease_token=null
 where id=p_id and lease_token=p_lease and status='processing';
 return found;
end;
$$;
revoke all on function public.prepare_notification_jobs(),public.claim_notification_jobs(uuid,integer),public.finish_notification_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_notification_jobs(),public.claim_notification_jobs(uuid,integer),public.finish_notification_job(uuid,uuid,text,text) to service_role;
