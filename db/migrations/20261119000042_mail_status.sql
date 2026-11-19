-- 0042 · Статусы отправленных писем, как в мессенджере (решение 052).
--
-- Resend сообщает о судьбе письма вебхуком на тот же адрес, что и входящие:
-- email.delivered → «Dostarczono», email.opened → «Otwarto», email.bounced → «Nie dostarczono»,
-- email.complained → «Oznaczono jako spam». Статус только растёт (открытое не станет снова
-- доставленным); отказ доставки перекрывает всё. «Otwarto» — подсказка, не гарантия:
-- Apple Mail сам открывает картинки, а у части клиентов картинки выключены.

alter table public.mail_messages
  add column status text check (status in ('sent', 'delayed', 'delivered', 'opened', 'bounced', 'complained')),
  add column status_at timestamptz,
  add column opened_at timestamptz,
  add column status_detail text check (char_length(status_detail) <= 500);

-- Исходящие, записанные до этой миграции, считаем отправленными.
update public.mail_messages set status = 'sent', status_at = created_at where direction = 'out';

grant select (status, status_at, opened_at, status_detail) on public.mail_messages to authenticated;
