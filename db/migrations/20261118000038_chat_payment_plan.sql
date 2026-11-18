-- 0038 · Ссылка на чат с клиентом и план предоплат бизнеса (решение 049).
-- chat_url: клиент пишет где угодно (WhatsApp, Messenger, Instagram) — кнопка «Czat» открывает этот чат.
alter table public.leads
  add column chat_url text check (chat_url is null or (char_length(chat_url) <= 500 and chat_url ~ '^https://'));
grant update (chat_url) on public.leads to authenticated;

-- План предоплат: суммы по порядку в грошах, остаток — «до полной цены». Barowo: 500 + 1000.
alter table public.organizations
  add column payment_plan jsonb not null default '[50000, 100000]'::jsonb
    check (jsonb_typeof(payment_plan) = 'array' and jsonb_array_length(payment_plan) <= 5);
grant update (payment_plan) on public.organizations to authenticated;
