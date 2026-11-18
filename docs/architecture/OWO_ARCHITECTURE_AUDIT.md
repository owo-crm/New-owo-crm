# OWO — технический аудит архитектуры (2026-11-18)

> Проверено по коду ветки `main` (миграции `0000–0038`, 53 файла тестов). Код не менялся.
> **[Факт]** — подтверждено файлом; **[Предположение]**; **[Рекомендация]**.
> Предыдущий продуктовый аудит: `docs/audit/*`.

## 1. Фактическое состояние

### 1.1 Стек и выполнение [Факт]
| Компонент | Реализация | Файлы |
|---|---|---|
| Веб | Next.js 16 App Router, Server Components + Server Actions, один процесс | `app/`, `next.config.ts` |
| БД | PostgreSQL (Railway), миграции SQL при старте `npm start` | `db/migrations/*`, `scripts/migrate.ts` |
| Контекст пользователя | транзакция: `set local role authenticated` + `request.jwt.claim.sub` → `auth.uid()` | `lib/db/core.ts:41`, `lib/db/user.ts` (`withOrg`), `0000_platform.sql:31` |
| Сервисные операции | `asService` / `asServiceAs(actor)` — обход RLS | `lib/db/core.ts:51` |
| Фоновая работа | `setInterval` 60 с **внутри веб-процесса** (`instrumentation.ts` → `startNotificationWorker`) | `lib/notify/worker.ts`, `runner.ts` |
| Очередь | таблица `notification_deliveries` с `for update skip locked` | `0011_notifications.sql` |
| Живые обновления | LISTEN/NOTIFY → `/api/live` | `lib/db/listen.ts` |
| Документы | DOCX-шаблон + LibreOffice → PDF; код бота Barowo исполняется «как есть» | `lib/documents/barowo/*`, `docx-template.ts` |
| Биллинг | собственный клиент Stripe, webhook | `lib/billing/*`, `app/api/stripe/webhook` |
| i18n | один язык `messages/pl.json`, типизированные ключи | `lib/i18n.ts` |

### 1.2 Таблицы [Факт] — список из задания подтверждён
Все перечисленные в задании таблицы существуют. Дополнительно найдены: `profiles`,
`intake_log`, `telegram_links`, `push_subscriptions`, `notification_deliveries`,
`document_counters`, `organization_mail_settings`, `mail_send_log`, `mail_optouts`,
`mailing_recipients`, `organization_avatars`, `profile_avatars`, `platform_secrets`,
`module_requests`, `agency_setup_steps`, `agency_setup_marks`, `agency_ad_accounts`.

### 1.3 Права [Факт]
- `is_member(org)`, `has_role(org, roles)` — `security definer` (`0001_organizations.sql:67,75`).
- `is_platform_admin()`, `manages_organization(org)` (`0021_billing.sql:45`) — агентство
  «управляет» организацией, если она есть в его `agency_clients.client_org_id`.
- Роли: enum `member_role` = owner/admin/member + флаг `memberships.is_service`.
- 61 функция `security definer` по миграциям — каждая потенциальная точка обхода RLS.

## 2. Отношения организаций — расхождение с документацией

**[Факт]** `lib/db/bootstrap.ts:167` `linkBusinessesToAgency` при **каждом старте** делает
**каждую** организацию с `industry_preset <> 'agency'` клиентом первого кабинета агентства
(`agency_clients.client_org_id`), со статусом `active`. Следовательно, **Barowo в коде является
клиентом OWO Ads**, и от этого зависят:
- `manages_organization()` — права агентства менять модули Barowo (`set_organization_modules`);
- `agency_sync_service_access` — сервисный доступ команды агентства в Barowo (решение 038);
- оплаты абонемента Barowo → заказы «CRM (abonament)» в финансах агентства.

Задание требует не считать Barowo клиентом агентства автоматически. **Это противоречит
текущему коду** → решение D-02 в `OWO_ARCHITECTURE_DECISIONS.md`.

## 3. Жёстко прописанная отраслевая логика в ядре

| Область | Текущая реализация [Факт] | Ограничение | Целевое состояние | Сложность |
|---|---|---|---|---|
| Поля мероприятия в `leads` | `event_date, event_type, event_city, venue, guests, service_hours, package_name, client_full_name, client_address, deposit_paid_at` — колонки ядра (`0002`, `0015`) | Автосервис/недвижимость не нужны; новые поля = миграция ядра | Ядро `leads` без отраслевых полей; поля — `entity_fields` модуля Event | Высокая (их читают 10+ SQL-функций) |
| `change_lead` | Жёсткий список ключей и колонок (`0015:42-64`) | Любое новое поле = пересоздание функции | Общая запись изменений по метаданным полей | Средняя |
| `normalizeLead` / `ingest_lead` | Схема заявки с полями мероприятия (`lib/leads/ingest.ts:43-54`) | Форма другой отрасли не ложится | Маппинг канала → поля сущности из конфигурации | Средняя |
| Воронка | `seed_lead_stages()` по `industry_preset` в SQL (`0020:21`) + дубль в TS `lib/presets/index.ts` — **расходятся** (в TS нет `contract_signed`) | Два источника правды; одна воронка на организацию; только для лидов | `pipelines` per сущность из шаблона | Средняя |
| Ключи этапов в SQL | `clients_list` → `client_stage_position` = `'contract_sent'`; `stageForward(...,'contract_sent')`; агентский лид → клиент на `'client'`; 16 мест с `kind='won'`/ключами | Смысл привязан к ключам Barowo/агентства | Семантические роли этапа (`entry`, `won`, `lost`, `contract_sent` как `stage_role`) | Средняя |
| `isAgency(industry_preset)` | Меню, `/agencja`, Telegram, ссылки (`lib/presets`, `nav-items.ts`, `layout.tsx`, `powiadomienia`) | Вид бизнеса = строка пресета | Модуль `agency_finance` включён/выключен | Низкая |
| Документы | `document_engine = 'barowo'`, каталог пакетов Simple/Standard/Premium, договор с константами 600/1500 zł (`lib/documents/barowo/contract.ts`) | Только Barowo | Модуль Advanced Documents + шаблоны per организация | Средняя |
| Календарь | `calendar_events` = лиды по `event_date`; «подтверждено» = `kind='won'` (`0017`) | Одно событие на лид; нет другой сущности с датой | Представление `calendar` над любой сущностью с date-полем | Низкая–средняя |
| Pulpit | `work_queue`, `dashboard_charts` завязаны на лиды и `event_date` | Нельзя другой Pulpit | `dashboard_definitions` + виджеты модулей | Средняя |
| Klienci/Umowy | Вычисляемые взгляды на лиды (`0030`) | Нет сущности Contact/Contract | Contact — ядро; Contract — сущность модуля | Высокая (смысл данных) |
| Модули | 5 жёстких ключей + проверка `check` в БД (`0021`), `channels` нигде не проверяется | Добавить модуль = миграция | `platform_modules` (реестр) + `organization_modules` | Низкая |
| Навигация | TS-константы `NAV_GROUPS` (`components/app-shell/nav-items.ts`) | Одинаковое меню для всех | `organization_config.navigation` | Низкая |
| `custom_field_defs` | Таблица есть (`0002:91`), значения в `leads.custom_fields jsonb`, интерфейса нет | Нет типизации и индексов | Заменить на `entity_fields` | Низкая |
| Платежи | `lead_payments` привязаны только к лиду; график Barowo | Нельзя платёж по ремонту | `payments` с полиморфной ссылкой на запись | Средняя |
| Уведомления | События `new_lead`, `unanswered_*`, `payment_*` — enum в `check` (`0011`) | Новые события = миграция | События автоматизаций | Средняя |
| Агентство | Отдельные таблицы `agency_*` — **хорошо изолированы** | Лиды агентства используют общий `leads` + `agency_lead_details` | Оставить как Specialized Module | Низкая |

## 4. Технический долг и риски
1. **Воркер в веб-процессе** — при двух репликах Railway два воркера; защищает только
   `skip locked` в очереди уведомлений. Синхронизация рекламы и рассылки без явной
   блокировки — **[Предположение]** возможен двойной запуск.
2. **`linkBusinessesToAgency` при старте** — неявное изменение данных при деплое.
3. **Два источника правды для воронки** (SQL seed и TS presets).
4. **Две модели рекламы**: `ad_accounts/ad_spend` и `agency_ad_accounts`.
5. **Метаданные полей отсутствуют** — UI знает поля лида из TS-кода (`lead-editor.tsx` BLOCKS).
6. **`marketing_consent_at` не заполняется**, модуль `channels` не проверяется (см. `docs/audit`).
7. Нет общего аудита действий: история есть только у лидов (`lead_events`).
8. Тесты: хорошее покрытие БД (RLS, агентство, биллинг — `tests/db/*`), e2e 37 сценариев.
   Это сильная сторона для миграции.

## 5. Что сохраняем и переиспользуем [Рекомендация]
- Модель изоляции: `organization_id` + RLS + `withOrg`/`auth.uid()` — **ядро без изменений**.
- `memberships` + роли + `is_service` + приглашения.
- Очередь доставки уведомлений (`notification_deliveries`, skip locked) — образец для очереди автоматизаций.
- Каналы приёма (`channels`, вебхук с маппингом полей) — превратить в «входящие» любой сущности.
- `lead_events` — образец журнала; обобщить до `record_events`.
- Весь домен `agency_*` и расчёт 10/25/65 — переносится модулем без изменения формул.
- Биллинг Stripe и `organization_modules`.
- Документы: генератор DOCX/PDF как сервис модуля документов.
