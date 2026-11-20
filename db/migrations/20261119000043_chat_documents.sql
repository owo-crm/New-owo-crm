-- 0043 · Работа с клиентом через чат: документы, быстрые действия, шаблоны (решение 053).
--
-- 1. Шаблоны документов живут в mailing_templates рядом с шаблонами писем (purpose = 'document').
--    Кнопки «Szybkie działania» строятся из шаблонов (quick_label, quick_position), не из кода.
-- 2. Готовые PDF фирмы (прайс и т. п.) для шаблонов document_kind = 'file' — template_files
--    (тот же способ хранения, что у документов: bytea в базе).
-- 3. outbound_messages — outbox внешних отправок по D-20 (минимальная часть спецификации
--    OWO_WORKFLOW_ENGINE_SPEC §4.3): запись операции ДО вызова провайдера, unique step_key,
--    статусы queued/sending/sent/failed/unknown/cancelled; unknown автоматически не повторяется.
--    Пока используется отправкой из чата; автоматизации (M5–M6) пишут сюда же.
-- 4. documents.operation_key — повтор той же операции не создаёт второй документ.
-- 5. «Następny kontakt» убран из интерфейса: напоминания по next_contact_at больше не строятся.

-- ── 1. Шаблоны ─────────────────────────────────────────────────────────────
create table public.template_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 200 and filename !~ '[/\\]'),
  content_type text not null check (content_type = 'application/pdf'),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  content bytea not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
alter table public.template_files enable row level security;
create policy "members read" on public.template_files
  for select to authenticated using ((select public.is_member(organization_id)));
create policy "admins write" on public.template_files
  for insert to authenticated
  with check ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));
create policy "admins delete" on public.template_files
  for delete to authenticated
  using ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));
revoke all on public.template_files from anon, authenticated;
grant select, insert, delete on public.template_files to authenticated;
grant all on public.template_files to service_role;

alter table public.mailing_templates
  add column purpose text not null default 'mail' check (purpose in ('mail', 'document')),
  add column document_kind text check (document_kind in ('offer', 'contract', 'menu', 'file')),
  add column document_params jsonb not null default '{}'::jsonb check (jsonb_typeof(document_params) = 'object'),
  add column document_mode text check (document_mode in ('quick', 'form')),
  add column attachment_id uuid,
  add column quick_label text check (char_length(quick_label) between 1 and 40),
  add column quick_position smallint not null default 0,
  add column stage_after text check (stage_after ~ '^[a-z][a-z0-9_]{0,49}$'),
  add constraint mailing_templates_attachment_fk foreign key (organization_id, attachment_id)
    references public.template_files(organization_id, id) on delete restrict,
  -- Обычное письмо не несёт документных полей; документный шаблон обязан сказать, что прикладывать.
  add constraint mailing_templates_document_shape_check check (
    (purpose = 'mail' and document_kind is null and document_mode is null and attachment_id is null
       and stage_after is null and document_params = '{}'::jsonb)
    or (purpose = 'document' and document_kind is not null and (
          (document_kind = 'file' and attachment_id is not null and document_mode is null)
       or (document_kind <> 'file' and attachment_id is null and document_mode is not null))));
create index mailing_templates_quick_idx on public.mailing_templates (organization_id, quick_position)
  where quick_label is not null;

-- Обычные шаблоны писем по-прежнему правит любой участник; документные — только owner/admin.
drop policy "members write" on public.mailing_templates;
drop policy "members update" on public.mailing_templates;
create policy "members write" on public.mailing_templates
  for insert to authenticated
  with check ((select public.is_member(organization_id)) and (purpose = 'mail'
    or (select public.has_role(organization_id, array['owner', 'admin']::public.member_role[]))));
create policy "members update" on public.mailing_templates
  for update to authenticated
  using ((select public.is_member(organization_id)) and (purpose = 'mail'
    or (select public.has_role(organization_id, array['owner', 'admin']::public.member_role[]))))
  with check ((select public.is_member(organization_id)) and (purpose = 'mail'
    or (select public.has_role(organization_id, array['owner', 'admin']::public.member_role[]))));
grant update (quick_label, quick_position, stage_after) on public.mailing_templates to authenticated;

-- ── 2. Документы: идемпотентность операции ─────────────────────────────────
alter table public.documents add column operation_key text check (char_length(operation_key) <= 100);
create unique index documents_operation_uq on public.documents (organization_id, operation_key)
  where operation_key is not null;

-- ── 3. Outbox внешних отправок (D-20) ──────────────────────────────────────
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- ключ операции: «ui:<uuid>» для отправки из чата, «<run_id>:<step>» для автоматизаций
  step_key text not null unique check (char_length(step_key) between 3 and 200),
  channel text not null default 'email' check (channel in ('email', 'telegram', 'push', 'webhook')),
  -- только идентификаторы, без адресов и текстов (OWO_WORKFLOW_ENGINE_SPEC §4.6)
  target_ref text not null check (char_length(target_ref) <= 200),
  template_key text not null default '' check (char_length(template_key) <= 200),
  params jsonb not null default '{}'::jsonb,
  lead_id uuid,
  document_id uuid,
  template_id uuid,
  created_by uuid,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  finalized_at timestamptz,
  unique (organization_id, id)
);
create index outbound_messages_org_idx on public.outbound_messages (organization_id, created_at desc);
alter table public.outbound_messages enable row level security;
create policy "members read" on public.outbound_messages
  for select to authenticated using ((select public.is_member(organization_id)));
revoke all on public.outbound_messages from anon, authenticated;
grant select on public.outbound_messages to authenticated;
grant all on public.outbound_messages to service_role;

-- Письмо в переписке знает свою операцию и документ: повторная фиксация после сбоя не дублирует.
alter table public.mail_messages
  add column outbound_id uuid,
  add column document_id uuid;
create unique index mail_messages_outbound_uq on public.mail_messages (outbound_id)
  where outbound_id is not null;
grant select (outbound_id, document_id) on public.mail_messages to authenticated;

-- ── 5. Напоминания «Następny kontakt» больше не строятся ───────────────────
create or replace function public.work_queue(p_organization uuid, p_user uuid default null, p_now timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as (
    select l.*, s.kind from public.leads l
    join public.pipeline_stages s on s.organization_id = l.organization_id and s.key = l.stage_key
    where l.organization_id = p_organization and l.deleted_at is null
  ),
  -- «Не отвечен» = нет первого ответа; импортированные из бота с этапом выше «новый» считаются отвеченными.
  waiting as (
    select * from visible
    where kind = 'open' and first_response_at is null
      and not coalesce(legacy_uid like 'apps-script:%' and stage_key <> 'new', false)
  ),
  -- «Następny kontakt» убран (решение 053): next_contact_at больше не даёт напоминаний,
  -- данные в колонке сохраняются. Остаются только задачи lead_tasks.
  today_calls as (
    select l.id, l.client_name, l.phone_e164, t.due_at, t.title
    from public.lead_tasks t join visible l on l.organization_id = t.organization_id and l.id = t.lead_id
    where t.done_at is null and (t.due_at at time zone 'Europe/Warsaw')::date <= (p_now at time zone 'Europe/Warsaw')::date
  ),
  month as (
    select date_trunc('month', p_now at time zone 'Europe/Warsaw') at time zone 'Europe/Warsaw' as start
  )
  select jsonb_build_object(
    'now', p_now,
    'waiting_count', (select count(*) from waiting),
    'waiting', coalesce((select jsonb_agg(to_jsonb(w) - 'kind' order by w.created_at)
                         from (select * from waiting order by created_at limit 10) w), '[]'),
    'mine_count', (select count(*) from visible where kind = 'open' and assigned_to = p_user),
    'tasks_count', (select count(*) from today_calls),
    'tasks', coalesce((select jsonb_agg(to_jsonb(c) order by c.due_at) from (select * from today_calls order by due_at limit 8) c), '[]'),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object(
          'id', u.id, 'client_name', u.client_name, 'event_date', u.event_date,
          'event_type', u.event_type, 'event_city', u.event_city, 'confirmed', u.kind = 'won')
        order by u.event_date)
      from (select * from visible where kind <> 'lost' and event_date >= (p_now at time zone 'Europe/Warsaw')::date
            order by event_date limit 6) u), '[]'),
    'response_minutes', (select avg(greatest(extract(epoch from (first_response_at - created_at)) / 60, 0))
       from visible where first_response_at >= p_now - interval '30 days' and first_response_at <= p_now),
    'month_leads', (select count(*) from visible, month where created_at >= month.start and created_at <= p_now),
    'month_won', (select count(*) from visible, month
       where kind = 'won' and updated_at >= month.start and updated_at <= p_now),
    'form_connected', exists(select 1 from public.channels
       where organization_id = p_organization and type = 'website' and status = 'active' and last_received_at is not null)
  );
$$;
