-- 0010 · Push subscriptions belong to an organization and a specific member.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint)<=2048),
  keys jsonb not null check (jsonb_typeof(keys)='object' and keys ? 'p256dh' and keys ? 'auth'),
  user_agent text,
  created_at timestamptz not null default now(),
  foreign key (organization_id,user_id) references public.memberships(organization_id,user_id) on delete cascade
);
alter table public.push_subscriptions enable row level security;
create policy "own push read" on public.push_subscriptions for select to authenticated using(user_id=auth.uid() and public.is_member(organization_id));
create policy "own push insert" on public.push_subscriptions for insert to authenticated with check(user_id=auth.uid() and public.is_member(organization_id));
create policy "own push update" on public.push_subscriptions for update to authenticated using(user_id=auth.uid() and public.is_member(organization_id)) with check(user_id=auth.uid() and public.is_member(organization_id));
create policy "own push delete" on public.push_subscriptions for delete to authenticated using(user_id=auth.uid() and public.is_member(organization_id));
revoke all on public.push_subscriptions from anon,authenticated;
grant select,insert,delete on public.push_subscriptions to authenticated;
grant update(keys,user_agent) on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
