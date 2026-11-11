# 02 — Модель данных

Источник правды — SQL-миграции в `supabase/migrations/`. Этот файл — понятное описание. При изменении схемы обновлять оба.

## Мультиарендность (разделение фирм)

- Одна фирма = одна строка в `organizations`. Пользователь может состоять в нескольких фирмах (`memberships`).
- **Во всех таблицах есть `organization_id`** и включён RLS:

```sql
create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where organization_id = org and user_id = auth.uid()
  );
$$;

-- шаблон политики для каждой таблицы
alter table leads enable row level security;
create policy "members read"   on leads for select using (is_member(organization_id));
create policy "members write"  on leads for insert with check (is_member(organization_id));
create policy "members update" on leads for update using (is_member(organization_id));
-- delete — только owner/admin (через has_role(org, 'admin'))
```

- Тест на RLS обязателен: пользователь фирмы A не видит ничего из фирмы B (`tests/db/rls.test.ts`, запускается в PGlite без Docker). **Каждая новая таблица → новые проверки в этом тесте.**
- Фирма создаётся только функцией `create_organization(name, slug, preset)` — она же делает создателя владельцем.
- Обновление разрешено только перечисленным колонкам (`grant update (…)`), чтобы клиент не мог сам поменять план или роль.

Реализовано (миграция `20261012000001_organizations.sql`): `organizations`, `memberships`, `profiles`, функции `is_member`, `has_role`, `shares_organization`, `create_organization`, триггер профиля при регистрации.

Реализовано (миграция `20261012000002_leads.sql`): семь таблиц этапа 1. Этапы автоматически создаются для существующих и новых фирм. `leads.number` — глобальный последовательный номер (пропуски допустимы), UUID остаётся ключом. Все ссылки между фирменными таблицами составные `(organization_id, id/key/user_id)` — нельзя связать строки разных фирм даже в серверном коде.

Участники читают данные, создают/редактируют лиды и задачи; настройки этапов, каналов и доп. полей меняют owner/admin. История событий дописывается, автор совпадает с вошедшим пользователем. `intake_log` пишет только сервер; `channels.secret_hash` участникам недоступен. Ключи фирмы, номер и источник лида защищены правами на колонки. Лиды удаляются только мягко; окончательное удаление — будущая серверная очистка. `leads` подключена к `supabase_realtime`, если публикация существует.

## Таблицы

### Организация и люди
| Таблица | Ключевые поля |
|---|---|
| `organizations` | id, name, slug (уникальный, создаётся из названия), industry_preset, plan, trial_ends_at (+14 дней), legal_name, nip, address, phone, email, website, bank_account, logo_path, brand_color, brand_fonts jsonb, timezone (`Europe/Warsaw`), plan, created_at |
| `memberships` | organization_id, user_id, role (`owner`/`admin`/`member`), display_name, phone |
| `profiles` | user_id, full_name, quiet_hours jsonb, locale |

### Лиды
| Таблица | Ключевые поля |
|---|---|
| `pipeline_stages` | organization_id, key, label_pl, position, kind (`open`/`won`/`lost`) — из пресета, можно менять |
| `leads` | id, organization_id, number (короткий человекочитаемый, как `lead_id` в Apps Script), stage_key, source_channel_id, source_label, client_name, phone_e164, email, event_type, event_date, event_city, venue, guests, budget_grosze, message, custom_fields jsonb, assigned_to, first_response_at, utm jsonb, page_url, referrer, consent_at, raw_payload jsonb, legacy_uid, created_at, updated_at, deleted_at |
| `lead_events` | lead_id, organization_id, type (`created`, `stage_changed`, `note`, `call`, `email_sent`, `document_generated`, `offer_viewed`, `offer_accepted`, `edited`...), payload jsonb, actor_user_id, created_at — история карточки |
| `lead_tasks` | organization_id, lead_id, due_at, title, done_at — напоминания (follow-up) |
| `custom_field_defs` | organization_id, key, label_pl, type, options — поля отрасли (напр. «fontanna czekoladowa») |

### Каналы и интеграции
| Таблица | Ключевые поля |
|---|---|
| `channels` | id, organization_id, type (`website`/`meta_lead_ads`/`google_ads`/`email_inbound`/`webhook`/`manual`), name, public_key (для URL), secret_hash, config jsonb, status, last_received_at |
| `integration_tokens` | organization_id, provider, encrypted_token, expires_at (Meta page tokens) |
| `intake_log` | organization_id, channel_id, received_at, ok, error, payload (хранить 30 дней) |

### Документы
| Таблица | Ключевые поля |
|---|---|
| `document_templates` | id, organization_id (null = системный), kind (`contract`/`offer`), name, body jsonb (блоки + переменные), version, is_default |
| `offer_packages` | organization_id, name, description, items jsonb, base_price_grosze (только подсказка, цена всегда ручная) |
| `documents` | id, organization_id, lead_id, kind, number (`UM/2026/014`), design_id, template_id, content jsonb (снимок данных), status (`draft`/`generated`/`sent`/`viewed`/`accepted`/`signed`/`void`), total_grosze, public_token, pdf_path, docx_path, version, parent_document_id, created_by, created_at |
| `document_counters` | organization_id, kind, year, last_number — нумерация через `select ... for update` |

### Уведомления
| Таблица | Ключевые поля |
|---|---|
| `notification_settings` | organization_id, user_id, channel (`telegram`/`push`/`email`/`sms`), enabled, events text[] |
| `telegram_links` | user_id, organization_id, chat_id, link_token, linked_at |
| `push_subscriptions` | user_id, endpoint, keys jsonb, user_agent |
| `notification_deliveries` | lead_id, user_id, channel, status, attempts, sent_at, error |

### Прочее
| Таблица | Ключевые поля |
|---|---|
| `bookings` | organization_id, lead_id, event_date, status (`hold`/`confirmed`) — проверка «дата свободна?» |
| `jobs` | type, payload, run_at, attempts, locked_at, done_at — фоновые задачи |
| `audit_log` | organization_id, user_id, action, entity, entity_id, created_at |
| `subscriptions` | organization_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end |

### Agencja (пресет `agency`, миграция `20261111000020_agency.sql`)
Кабинет самого OWO Ads. С `lead_payments` не смешивается: там деньги клиентов Barowo, здесь — деньги агентства.

| Таблица | Ключевые поля |
|---|---|
| `agency_clients` | organization_id (= OWO Ads), name, nip, contact_name, phone, email, city, **client_org_id** (организация клиента в этой установке — мост в его CRM), lead_id (лид, из которого завели), status `lead/active/paused/lost`, started_at, note |
| `agency_orders` | client_id, title, kind `retainer/project`, amount_grosze (netto), direct_costs_grosze, ad_budget_grosze (только отчёт), sold_by, **period_month** (месяц учёта, есть у всех заказов), status `draft/invoiced/paid/cancelled`, due_date, paid_at (есть ⇔ status = paid), repeated_from |
| `agency_order_work` | order_id, user_id, hours (0 < h ≤ 500), note; одна строка на исполнителя |
| `agency_setup_steps` | справочник шагов (key, position, auto) — общий, без organization_id; названия в `messages/pl.json` |
| `agency_setup_marks` | ручные отметки: client_id, step_key (только auto = false), done_at, done_by, note |
| `organizations.agency_share_*_bp` | доли раздела в базисных пунктах (1000/2500/6500), сумма = 10 000 |

Функции:
- `agency_order_split(org, order)` — **единственное место формулы раздела** (TS-копия для формы: `lib/agency/split.ts`, тест сверяет обе). База = сумма − прямые расходы; продажа → sold_by, работа → по часам, компания → остаток (включая остатки округления). Нет часов/продавца → строка с `user_id = null` («nierozdzielone»).
- `agency_setup_status(org, client?)` — чек-лист: шаги `org_created, service_member, intake_channel, form_connected, owner_invited, owner_joined` отмечаются по фактам в организации клиента (security definer, наружу — только дата), остальные — ручными отметками.
- `agency_summary(org, month)` — плитки, раздел по заказам, оплаченным в месяце (раздел + прямые расходы = Получено), просрочки, клиенты.
- `agency_repeat_retainers(org, month)` — копирует абонементы прошлого месяца черновиками (с часами), без дублей.
- `agency_client_from_lead(org, lead)` — клиент агентства из лида на этапе «Klient».
- Продавец и исполнители — только участники агентства (триггер). Привязать `client_org_id` можно только к фирме, где ты сам участник.

### Абонемент (миграция `20261111000021_billing.sql`, решение 022)
| Таблица | Ключевые поля |
|---|---|
| `organization_modules` | organization_id, module (`leads/channels/documents/payments/calendar`), enabled_at, enabled_by. Читают участники и обслуживающее агентство; меняет только `set_organization_modules` |
| `module_requests` | заявка клиента «Poproś o moduł»: module, requested_by, handled_at (закрывается при включении) |
| `organization_billing` | ad_client, discount_bp, billing_email, stripe_customer_id, stripe_subscription_id, status, monthly_net_grosze, billed_seats, current_period_end, last_error. Пишет только сервер |
| `billing_events` | журнал вебхуков Stripe (id события — ключ): повтор не обрабатывается |
| `agency_orders.stripe_invoice_id` | оплаченный счёт Stripe → заказ агентства, без дублей |

Функции: `has_module(org, module)`, `manages_organization(org)`, `billable_seats(org)` (без обслуживающих аккаунтов). Шаг чек-листа с `agency_setup_steps.module` показывается, только если модуль включён; шаг `subscription` отмечается сам при активной подписке.

## Правила

- Телефон храним в E.164 (`+48...`), e-mail в нижнем регистре — для дедупликации.
- Дубликат лида (тот же телефон/e-mail за 30 дней) не теряем: создаём лид и связываем через событие `possible_duplicate`, показываем подсказку «Ten klient już pisał».
- Удаление лида — мягкое (`deleted_at`), окончательное — через 30 дней (RODO).
- Документы неизменяемы: правка = новая версия (`parent_document_id`).

Миграция `20261012000003_ingest.sql`: `ingest_lead` (security invoker) атомарно создаёт лид, `created` и двусторонние `possible_duplicate`. Поиск дубликатов по телефону ИЛИ e-mail за 30 дней, только в своей фирме, без мягко удалённых. Блокировка на фирму защищает от одновременных запросов. Нужен хотя бы один контакт (телефон/e-mail).

Миграция `20261012000004_intake.sql`: серверная `reserve_intake` резервирует попытку под транзакционной блокировкой, индекс по HMAC IP и времени. При успешном завершении журнал обновляет время последней заявки канала. Пользователи функции и записи журнала не меняют.

Миграция `20261012000005_search_leads.sql`: `search_leads` — параметризованный поиск/фильтры под RLS, без удалённых строк; телефон ищется по цифрам, `%`/`_` — буквальный текст, не маска. Пагинация по 50 строк и точное количество через PostgREST.

Миграция `20261013000006_lead_changes.sql`: `change_lead` блокирует строку, сверяет `updated_at`, меняет разрешённые поля и дописывает историю атомарно. Этап после `new` (кроме lost) ставит первый ответ один раз. `undo_lead_change` разрешает отменить свою правку 8 секунд, только если версия ещё не менялась; дописывает `restored`.

Миграция `20261013000007_manual_channel.sql`: всем существующим и новым фирмам автоматически добавляется канал `manual` («Ręcznie»). Ручной лид использует его через общий `ingest_lead`; создание доступно сотруднику, настройки канала остаются за администратором.

Миграция `20261013000008_dashboard.sql`: `lead_dashboard` (security invoker/RLS) возвращает счётчики, среднюю реакцию за 30 дней, 12 старейших бонов без ответа, даты inquiry, новые лиды/выигранные запросы месяца, незавершённые follow-up на сегодня и раньше. Закрытые/удалённые лиды исключены из очереди; lost не создают inquiry. Границы месяца/дня — Europe/Warsaw.

Миграция `20261013000009_telegram.sql`: `telegram_links` (RLS, составной FK участника). Участник видит только свою привязку без хеша кода. `create_telegram_link` выдаёт срок 10 минут; код в базе хранится как SHA-256, погашается один раз сервером. Bot RPC сверяют private chat + Telegram user, фирму и действующее членство; команды повторяемы по `legacy_uid=telegram:<update_id>`, автор истории — привязанный пользователь.

Миграция `20261013000010_push.sql`: `push_subscriptions` с фирмой и участником, уникальным endpoint, ключами и RLS только на собственные устройства. Фирму/пользователя нельзя обновить. Общий sender повторно проверяет HTTPS endpoint известных push-провайдеров; 404/410 означает истекшую подписку.

Миграция `20261013000011_notifications.sql`: настройки трёх каналов автоматически создаются участнику; он меняет только свои enabled/events. Доставки пишутся триггером вместе с лидом. Ключ `(organization_id,lead_id,user_id,channel,kind)` различает первое уведомление и два напоминания. Очередь читает адресат и администратор своей фирмы; пишет только сервер. Claim использует SKIP LOCKED + lease на 5 минут, finish проверяет lease. До 5 попыток, интервалы 1/2/4/8 минут, затем dead. Исторический импорт с legacy_uid при вставке не уведомляет.

Миграция `20261013000012_legacy_import.sql`: серверная `import_legacy_lead` сохраняет нормализованные поля, исходную строку, оригинальную дату, этап и legacy_uid (`apps-script:<uid>`). Повтор не меняет существующий лид. Канал импорта создаётся автоматически. Outbox и cron не уведомляют о такой истории. Если исторический этап уже после new, контакт известен, но его время не придумано: лид не показывается ожидающим, неизвестная реакция не участвует в среднем времени.

Миграция `20261013000013_lead_integrity_fixes.sql`: телефонная часть поиска применяется только к строке, похожей на номер. Цифры в имени/e-mail не расширяют выдачу по телефону. При удалении membership поля assigned_to и actor_user_id становятся null только в этой фирме; organization_id и история остаются, доступ участника снимается. Фирма, где тот же человек остаётся участником, не затрагивается.
