-- 0041 · Переписка с клиентами внутри CRM (решение 051).
--
-- Входящие: Resend принимает почту домена фирмы (MX → Resend) и шлёт вебхук email.received
-- на /api/mail/inbound/<organization_id>. Подпись вебхука проверяется секретом фирмы
-- (inbound_secret_ciphertext, AES-GCM как пароль почты). Тело письма сервер забирает отдельно
-- по API Resend; пока не забрал — body_pending, фоновая очередь повторяет.
-- Исходящие из переписки пишутся сюда же, чтобы получился один чат с клиентом.
-- Внешний вид писем (тёмная/светлая тема, цвет кнопок, подпись) — настройки фирмы.

create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid,
  direction text not null check (direction in ('in', 'out')),
  -- адрес собеседника (клиента) в нижнем регистре: по нему строится переписка
  counterpart text not null check (char_length(counterpart) between 3 and 320),
  counterpart_name text check (char_length(counterpart_name) <= 200),
  subject text not null default '' check (char_length(subject) <= 500),
  body_text text not null default '' check (char_length(body_text) <= 200000),
  body_html text check (char_length(body_html) <= 500000),
  body_pending boolean not null default false,
  provider_id text,
  message_id text check (char_length(message_id) <= 998),
  in_reply_to text check (char_length(in_reply_to) <= 998),
  attachments jsonb not null default '[]'::jsonb,
  read_at timestamptz,
  sent_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id) on delete set null (lead_id)
);
-- Повтор вебхука от Resend не создаёт второе письмо.
create unique index mail_messages_provider_uq on public.mail_messages (organization_id, provider_id)
  where provider_id is not null;
create index mail_messages_thread_idx on public.mail_messages (organization_id, counterpart, created_at);
create index mail_messages_lead_idx on public.mail_messages (organization_id, lead_id, created_at);
create index mail_messages_pending_idx on public.mail_messages (created_at) where body_pending;

alter table public.mail_messages enable row level security;
create policy "members read" on public.mail_messages
  for select to authenticated using ((select public.is_member(organization_id)));
create policy "members insert out" on public.mail_messages
  for insert to authenticated
  with check ((select public.is_member(organization_id)) and direction = 'out');
create policy "members mark read" on public.mail_messages
  for update to authenticated
  using ((select public.is_member(organization_id)))
  with check ((select public.is_member(organization_id)));

revoke all on public.mail_messages from anon, authenticated;
grant select, insert on public.mail_messages to authenticated;
-- Сотрудник может только отметить прочитанным, но не править текст писем.
grant update (read_at) on public.mail_messages to authenticated;
grant all on public.mail_messages to service_role;

-- Настройки фирмы: приём почты и внешний вид писем.
alter table public.organization_mail_settings
  add column inbound_secret_ciphertext text,
  add column inbound_last_at timestamptz,
  add column letter_theme text not null default 'light' check (letter_theme in ('light', 'dark')),
  add column letter_accent text not null default '#e8000d' check (letter_accent ~ '^#[0-9a-fA-F]{6}$'),
  add column letter_signature text not null default '' check (char_length(letter_signature) <= 500);

-- Секрет вебхука, как и пароль почты, участнику не виден: только записать.
grant select (inbound_last_at, letter_theme, letter_accent, letter_signature)
  on public.organization_mail_settings to authenticated;
grant update (inbound_secret_ciphertext, letter_theme, letter_accent, letter_signature)
  on public.organization_mail_settings to authenticated;
grant update (inbound_last_at) on public.organization_mail_settings to service_role;

create function public.mail_inbound_is_set(p_organization uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_member(p_organization) and exists (
    select 1 from public.organization_mail_settings
     where organization_id = p_organization and inbound_secret_ciphertext is not null);
$$;
revoke all on function public.mail_inbound_is_set(uuid) from public, anon;
grant execute on function public.mail_inbound_is_set(uuid) to authenticated;

-- Ответы клиенту из переписки — свой вид в журнале отправки (дневной лимит общий).
alter table public.mail_send_log drop constraint mail_send_log_kind_check;
alter table public.mail_send_log add constraint mail_send_log_kind_check
  check (kind in ('test', 'document', 'auto_offer', 'follow_up', 'review', 'mailing', 'notification', 'reply'));
