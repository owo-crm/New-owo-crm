-- 0027 · Почта на уровне бизнеса (решение 035, TASK_2026-11-12 раздел 1).
-- У каждой фирмы свой способ отправки писем клиентам: свой SMTP (например, личный Gmail),
-- свой ключ Resend или выключено. Пароль/ключ хранится только зашифрованным (AES-256-GCM,
-- ключ в переменной окружения MAIL_SECRET_KEY) и НИКОГДА не читается пользователем из базы:
-- на колонку secret_ciphertext нет права select у роли authenticated.

create table public.organization_mail_settings (
  organization_id   uuid primary key references public.organizations (id) on delete cascade,
  transport         text not null default 'none' check (transport in ('none', 'smtp', 'resend')),
  from_name         text check (char_length(from_name) <= 120),
  from_email        text check (from_email is null or (char_length(from_email) <= 254 and from_email like '%_@_%')),
  reply_to          text check (reply_to is null or (char_length(reply_to) <= 254 and reply_to like '%_@_%')),
  smtp_host         text check (smtp_host is null or smtp_host ~ '^[A-Za-z0-9.-]{1,253}$'),
  smtp_port         integer check (smtp_port is null or smtp_port in (25, 465, 587, 2525)),
  smtp_user         text check (char_length(smtp_user) <= 254),
  secret_ciphertext text,
  daily_limit       integer not null default 450 check (daily_limit between 1 and 2000),
  last_test_at      timestamptz,
  last_test_ok      boolean,
  last_test_error   text,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null
);

create trigger organization_mail_settings_updated_at before update on public.organization_mail_settings
  for each row execute function public.set_updated_at();

alter table public.organization_mail_settings enable row level security;

-- Видят настройки все участники фирмы (кнопки «Wyślij» должны знать, включена ли почта),
-- меняют — только owner/admin.
create policy "members read mail settings" on public.organization_mail_settings
  for select to authenticated using ((select public.is_member(organization_id)));
create policy "admins insert mail settings" on public.organization_mail_settings
  for insert to authenticated
  with check ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));
create policy "admins update mail settings" on public.organization_mail_settings
  for update to authenticated
  using ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])))
  with check ((select public.has_role(organization_id, array['owner', 'admin']::public.member_role[])));

revoke all on public.organization_mail_settings from anon, authenticated;
-- select — все колонки, КРОМЕ secret_ciphertext.
grant select (organization_id, transport, from_name, from_email, reply_to, smtp_host, smtp_port,
              smtp_user, daily_limit, last_test_at, last_test_ok, last_test_error, updated_at,
              updated_by)
  on public.organization_mail_settings to authenticated;
-- Запись секрета разрешена (без права его прочитать): «ввести заново», но не «показать».
grant insert (organization_id, transport, from_name, from_email, reply_to, smtp_host, smtp_port,
              smtp_user, secret_ciphertext, daily_limit, updated_by)
  on public.organization_mail_settings to authenticated;
grant update (transport, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
              secret_ciphertext, daily_limit, last_test_at, last_test_ok, last_test_error,
              updated_by)
  on public.organization_mail_settings to authenticated;

-- Признак «секрет задан» без доступа к самому секрету.
create function public.mail_secret_is_set(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select public.is_member(org)) and exists (
    select 1 from public.organization_mail_settings s
    where s.organization_id = org and s.secret_ciphertext is not null
  );
$$;
revoke all on function public.mail_secret_is_set(uuid) from public, anon;
grant execute on function public.mail_secret_is_set(uuid) to authenticated;

-- Журнал отправок: дневной лимит считается по факту, а не по счётчику в памяти.
create table public.mail_send_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('test', 'document', 'auto_offer', 'follow_up', 'review', 'mailing', 'notification')),
  recipients       integer not null check (recipients between 1 and 100),
  ok               boolean not null,
  error            text,
  lead_id          uuid,
  sent_by          uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index mail_send_log_org_day on public.mail_send_log (organization_id, created_at desc);

alter table public.mail_send_log enable row level security;
create policy "members read mail log" on public.mail_send_log
  for select to authenticated using ((select public.is_member(organization_id)));
revoke all on public.mail_send_log from anon, authenticated;
grant select on public.mail_send_log to authenticated;
-- Записывает только сервер (владелец подключения), не пользователь напрямую.
grant select, insert on public.mail_send_log to service_role;
grant select on public.organization_mail_settings to service_role;
