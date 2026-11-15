-- 0037 · Реклама (решение 046): рекламные аккаунты бизнеса (Meta, Google или ручной ввод)
-- и расходы по кампаниям. Отчёт сопоставляет расходы с заявками CRM по utm_campaign:
-- стоимость заявки и стоимость клиента. Один бизнес — свои аккаунты (отдельный аккаунт на клиента).

create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in ('meta', 'google', 'manual')),
  -- ID рекламного аккаунта: Meta «act_123…» или «123…», Google «123-456-7890». Для ручного — пусто.
  external_id text check (char_length(external_id) <= 40),
  name text not null check (char_length(name) between 1 and 120),
  currency text not null default 'PLN' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active', 'paused')),
  last_synced_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, platform, external_id)
);

-- Расход по кампании за день. Ручной ввод — одна строка на кампанию за месяц (date = 1-е число).
create table public.ad_spend (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_account_id uuid not null,
  date date not null,
  campaign_id text not null check (char_length(campaign_id) between 1 and 100),
  campaign_name text not null check (char_length(campaign_name) between 1 and 200),
  spend_grosze bigint not null default 0 check (spend_grosze >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  -- Заявки по данным самой платформы (для сравнения с заявками, дошедшими до CRM).
  platform_leads integer not null default 0 check (platform_leads >= 0),
  updated_at timestamptz not null default now(),
  primary key (ad_account_id, date, campaign_id),
  foreign key (organization_id, ad_account_id) references public.ad_accounts(organization_id, id) on delete cascade
);
create index ad_spend_org_date_idx on public.ad_spend (organization_id, date);

do $$
declare t text;
begin
  foreach t in array array['ad_accounts','ad_spend'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('create policy "admins write" on public.%I for insert to authenticated with check (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('create policy "admins update" on public.%I for update to authenticated using (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[])) with check (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.has_role(organization_id, array[''owner'',''admin'']::public.member_role[]))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant update (name, external_id, status) on public.ad_accounts to authenticated;
grant update (campaign_name, spend_grosze, impressions, clicks, platform_leads, updated_at) on public.ad_spend to authenticated;

-- Отчёт за период: по кампаниям — расход, показы, клики, заявки платформы, заявки в CRM
-- (по utm_campaign = названию или ID кампании, без регистра), клиенты (этап kind = won).
create function public.ads_report(p_organization uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with spend as (
    select a.platform, s.campaign_id, max(s.campaign_name) as campaign_name,
           sum(s.spend_grosze) as spend, sum(s.impressions) as impressions, sum(s.clicks) as clicks,
           sum(s.platform_leads) as platform_leads
    from public.ad_spend s join public.ad_accounts a on a.id = s.ad_account_id
    where s.organization_id = p_organization and s.date >= p_from and s.date < p_to
    group by a.platform, s.campaign_id
  ),
  leads as (
    select lower(coalesce(nullif(l.utm->>'campaign', ''), '')) as campaign,
           count(*) as leads,
           count(*) filter (where st.kind = 'won') as won
    from public.leads l
    join public.pipeline_stages st on st.organization_id = l.organization_id and st.key = l.stage_key
    where l.organization_id = p_organization and l.deleted_at is null
      and l.created_at >= (p_from::timestamp at time zone 'Europe/Warsaw')
      and l.created_at < (p_to::timestamp at time zone 'Europe/Warsaw')
      and coalesce(l.utm->>'campaign', '') <> ''
    group by 1
  ),
  rows as (
    select s.*, coalesce(ln.leads, li.leads, 0) as crm_leads, coalesce(ln.won, li.won, 0) as won
    from spend s
    left join leads ln on ln.campaign = lower(s.campaign_name)
    left join leads li on ln.campaign is null and li.campaign = lower(s.campaign_id)
  )
  select jsonb_build_object(
    'spend_grosze', coalesce((select sum(spend) from rows), 0),
    'impressions', coalesce((select sum(impressions) from rows), 0),
    'clicks', coalesce((select sum(clicks) from rows), 0),
    'crm_leads', coalesce((select sum(crm_leads) from rows), 0),
    'won', coalesce((select sum(won) from rows), 0),
    -- Заявки с utm_campaign, для которых нет кампании с расходами (например, расход ещё не внесён).
    'unmatched_leads', coalesce((select sum(l.leads) from leads l
       where not exists (select 1 from spend s where lower(s.campaign_name) = l.campaign or lower(s.campaign_id) = l.campaign)), 0),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
        'platform', platform, 'campaign_id', campaign_id, 'campaign_name', campaign_name,
        'spend_grosze', spend, 'impressions', impressions, 'clicks', clicks,
        'platform_leads', platform_leads, 'crm_leads', crm_leads, 'won', won) order by spend desc)
      from rows), '[]')
  );
$$;
revoke all on function public.ads_report(uuid, date, date) from public, anon;
grant execute on function public.ads_report(uuid, date, date) to authenticated;
