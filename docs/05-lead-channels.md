# 05 — Каналы заявок

Все каналы сходятся в одну точку: `lib/channels/<type>.ts` превращает входящие данные в `NormalizedLead`, дальше общий конвейер `lib/leads/ingest.ts`:

```
адаптер канала → zod-валидация → нормализация (телефон E.164, e-mail) → антиспам
→ insert leads + lead_events('created') → проверка даты (bookings) → дубликаты
→ уведомления (сразу, `EdgeRuntime.waitUntil`) → ответ 200
```

Правило: **ответить каналу быстро (< 2 c)**, тяжёлое — в фоне. Каждая попытка пишется в `intake_log`, чтобы пользователь в настройках видел «Ostatnie zgłoszenie: 2 min temu ✅».

## Каналы по этапам

| # | Канал | Сложность | Этап | Как подключается пользователем |
|---|---|---|---|---|
| 1 | Форма на сайте | низкая | MVP | копирует URL или JS-сниппет, или готовую форму-iframe |
| 2 | Ручной ввод + Telegram `/nowylead` | низкая | MVP | — |
| 3 | Универсальный вебхук (Zapier/Make/свой код) | низкая | MVP | URL + секрет |
| 4 | Google Ads lead form | низкая | этап 3 | вставляет URL и ключ в Google Ads |
| 5 | Входящая почта (порталы, «Formularz kontaktowy» и т.п.) | средняя | этап 3 | пересылает письма на `<slug>@leady.barowo.com` |
| 6 | Meta Lead Ads (Facebook/Instagram формы) | средняя + ожидание проверки Meta | этап 3 | кнопка «Połącz z Facebookiem», выбор страницы |
| 7 | CSV-импорт | низкая | этап 4 | загрузка файла |
| 8 | Messenger / Instagram Direct / WhatsApp | высокая | позже | — |

## 1. Форма на сайте

- Endpoint: `POST https://<project-ref>.supabase.co/functions/v1/intake/{channelPublicKey}` (решение 009; напрямую в Edge Function) (JSON или form-data, CORS для доменов из настроек канала).
- Поля: `name, phone, email, event_type, event_date, city, guests, message, consent` + любые доп. поля → `custom_fields`.
- Автоматически: `utm_*`, `page_url`, `referrer` (сниппет сам их собирает).
- Антиспам: honeypot-поле, rate limit по IP (10/час), Cloudflare Turnstile по желанию.
- Обязательное согласие RODO (`consent`) — без него 422.
- Для Barowo: текущая форма barowo.com шлёт на Apps Script. На время перехода — **двойная отправка** (см. `09-migration.md`).

## 4. Google Ads lead form

Google Ads позволяет указать webhook URL + key. Endpoint `POST /api/webhooks/google-ads/{channelPublicKey}`, сверяем `google_key`. Тестовые лиды Google (`is_test: true`) помечаем, не уведомляем клиента-фирму push'ем, только показываем «Test działa ✅».

## 5. Входящая почта

- Каждой фирме адрес `<slug>@leady.barowo.com` (Postmark Inbound → `POST /api/webhooks/email`).
- Разбор: сначала известные шаблоны (регулярки по отправителю), иначе ИИ-извлечение (Claude API → JSON: имя, телефон, e-mail, дата, место, гости, сообщение). Исходное письмо сохраняется в `raw_payload`.
- Если ничего не извлечено — лид всё равно создаётся с текстом письма (лучше лишний лид, чем потерянный).

## 6. Meta Lead Ads

- Meta-приложение (одно на продукт), разрешения: `leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `business_management`.
- **Нужны Business Verification и App Review — это недели. Подать заявку в начале этапа 1**, параллельно с разработкой.
- Поток: Facebook Login for Business → пользователь выбирает страницу → подписываем страницу на `leadgen` webhook → на событие получаем `leadgen_id` → запрос в Graph API за полями → `ingest`.
- Пока нет одобрения: временно — через Zapier/Make → универсальный вебхук (инструкция в интерфейсе).
- Токены страниц хранить зашифрованными (`integration_tokens`), обновлять до истечения.

## Сопоставление полей

Каждый канал имеет `config.fieldMap` — какое поле источника куда идёт. Интерфейс: «Pole w formularzu → Pole w CRM» с выпадающими списками и предпросмотром последней заявки.

## Проверка даты

При создании лида с `event_date`: если в `bookings` на эту дату есть `confirmed` — в уведомлении и карточке метка **«⚠️ Termin zajęty»**. Для фирм с несколькими командами — лимит событий в день в настройках.

### Реализовано в 1.3

`lib/channels/website.ts` — общий тестируемый обработчик; `supabase/functions/intake/index.ts` — тонкий Deno-вход. Tenant берётся только из активного website-канала. CORS — точные `config.allowedOrigins`, honeypot `website`, согласие RODO, тело максимум 32 KiB. `reserve_intake` атомарно резервирует попытку в `intake_log` (10/час на фирму + HMAC IP), работает между экземплярами Edge. Журнал содержит только хеш и код результата, а не текст/телефон клиента. Успех обновляет `channels.last_received_at`. Неизвестный канал нельзя записать в фирменный журнал, preflight не считается заявкой. Очистку 30-дневного журнала добавляем в cron в 1.11.

## Подключение формы на сайте клиента (решение 034)

Одинаково для Barowo и любого клиента OWO Ads — ничего не делается «под клиента», кроме ключа и домена.

1. В CRM клиента: «Źródła leadów» → канал «Strona» → скопировать адрес приёма `https://<crm>/api/intake/<ключ>` и вписать домен сайта в разрешённые.
2. На сайте — одна строка перед `</body>`:
   ```html
   <script src="https://cdn.jsdelivr.net/gh/owo-crm/new-owo-crm@embed-v1/public/embed/v1.js" defer></script>
   ```
3. Форма: `action` = адрес приёма, атрибут `data-owo`. Поля: `name`, `phone`, `email`, `event_type`, `event_date`, `city`, `guests`, `message`, `consent` (обязательно), скрытое `return_url` — куда перейти после отправки. Без `return_url` форма заменяется текстом из `data-owo-success`.
   ```html
   <form data-owo action="https://<crm>/api/intake/<ключ>" method="POST"
         data-owo-success="Dziękujemy! Odezwiemy się wkrótce.">
   ```
4. Если у сайта своя обработка формы на JS — вместо `fetch` вызвать `OWO.send(form.action, new FormData(form))`: результат `{ok, queued}`, при отказе — ошибка с `code`.
5. Проверка: отправить тестовую заявку; в «Źródła leadów» должна появиться «Ostatnie zgłoszenie».

Обновление скрипта: изменить `public/embed/v1.js` → тест → новый тег (`embed-v1` переставить или выпустить `embed-v1.1`) → jsDelivr отдаёт новый файл. Несовместимые изменения — только как `v2.js`, чтобы не сломать сайты, где стоит v1.
