-- 0007 · Manual intake is available to every member without configuring a channel.
create function public.seed_manual_channel() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.channels (organization_id,type,name) values (new.id,'manual','Ręcznie');
  return new;
end;
$$;
revoke all on function public.seed_manual_channel() from public,anon,authenticated;
create trigger organization_manual_channel after insert on public.organizations for each row execute function public.seed_manual_channel();
insert into public.channels (organization_id,type,name) select id,'manual','Ręcznie' from public.organizations o
  where not exists (select 1 from public.channels c where c.organization_id=o.id and c.type='manual');
