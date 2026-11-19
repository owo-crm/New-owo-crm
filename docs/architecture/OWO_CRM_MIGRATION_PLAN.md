# OWO — план поэтапной миграции

> Без переписывания с нуля. Принцип «strangler»: новое рядом со старым, общие данные,
> перевод по одному модулю, удаление старого — только после проверки. Каждый этап — отдельные
> миграции `00NN_*.sql`, обратно совместимые (только `add`, без `drop` до этапа M9).
> Номера миграций — ориентировочные, порядок выполнения: 0039 (M1) → 0040 (M2) → 0041 (M4.1) → 0042–0044 (M3) → 0045 (M4.2) → 0046 (M5) → 0047 (M6).

## Обзор

```mermaid
gantt
  dateFormat X
  axisFormat %s
  section Основа
  M0 Подготовка и тесты-страховка :m0, 0, 1
  M1 Platform Core: аудит, staff, связи организаций, воркер (D-08) :m1, 1, 2
  M2 Семантика этапов и pipelines :m2, 2, 3
  section Данные
  M4.1 entity_types/entity_fields, роли :m41, 3, 4
  M3 Contacts + payments/tasks/files обобщённые :m3, 4, 5
  M3.x Перенос файлов в S3 :m3x, 5, 6
  M4.2 Движок records и безопасность полей :m42, 5, 7
  section Конфигурация
  M5 Config Engine + шаблоны (только чтение, Barowo/OWO как есть) :m5, 7, 9
  M6 Автоматизации (перенос напоминаний) :m6, 9, 11
  M7 Рендер интерфейса из конфигурации :m7, 11, 13
  section Отрасли
  M8 Модули: event_mgmt, agency_finance, ads; техтест automotive :m8, 13, 15
  M9 Уборка старого :m9, 15, 16
```

---

### M0 — Подготовка и страховочные тесты
| Параметр | Что требуется |
|---|---|
| Цель | Зафиксировать текущее поведение, чтобы ловить регрессии |
| Текущие | 53 файла тестов, e2e 37 сценариев (`tests/db`, `tests/unit`, `tests/e2e`) |
| Новые | **Статистика файлов** (D-22): количество, суммарный и максимальный объём, типы по `lead_attachments`, `document_files`, `organization_templates` на организацию (`scripts/report-files.ts`, только чтение). Снимки по каждой организации: количество и суммы `lead_payments` (всего / оплачено), заказы и выплаты агентства по месяцам (база для M1.5 и M3). Снимки результатов SQL-функций на фиксированном наборе данных: `work_queue`, `dashboard_charts`, `calendar_events`, `clients_list`, `contracts_list`, `finance_summary`, `ads_report`, `agency_order_split`, сводка агентства за месяц (`tests/db/golden/*.test.ts`) |
| Миграции БД | нет |
| Файлы | `tests/db/golden/`, `tests/fixtures/barowo-like.sql`, `agency-like.sql` |
| Совместимость | — |
| Риски | Неполные фикстуры → пропущенные регрессии |
| Проверки | Все golden-тесты зелёные на `main` |
| Откат | — |

### M1 — Platform Core: аудит, сервисный доступ, связи организаций, воркер
Порядок внутри этапа строгий: **M1.1 → M1.2 → [утверждение списка; S2 и вливание удаления Stripe] → M1.3 → [финансовый отчёт Barowo + согласование] → M1.5 → M1.6**; M1.7 (проект хранения файлов) — параллельно. M1 начинается только после M0.

**M1.1 Отключить автосвязь (до любой миграции отношений).**
`linkBusinessesToAgency()` (`lib/db/bootstrap.ts:167`) при каждом старте делает **каждую**
не-агентскую организацию клиентом агентства (`agency_clients`, status `active`). Пока она
работает, классификация бессмысленна — следующий деплой снова создаст связи. Изменение:
вызов в старте только при `AUTO_LINK_AGENCY_CLIENTS=true` (по умолчанию выключено); создание
связи — только явным действием («Nowy klient» / мастер «Utwórz CRM klienta»).
Поэтому **`agency_clients` не считается источником правды о коммерческих отношениях**.

**M1.2 Отчёт предварительной классификации (только чтение, до миграции).**
`scripts/report-org-relations.ts` выводит по каждой организации: `industry_preset`, есть ли
строка `agency_clients` и **кто её создал** (`created_by is null` + `started_at = дата создания
организации` → признак автосвязи), участники-владельцы, есть ли `organization_billing` /
Stripe-подписка, заказы `agency_orders` (кол-во, суммы, статусы, `stripe_invoice_id`), выплаты
`agency_payouts`, затронутые этими заказами. Предлагаемая классификация:
| Организация | Предложение | Основание |
|---|---|---|
| Barowo | `service` | утверждено владельцем: фирма Ивана, не клиент |
| Кабинет агентства (OWO Ads) | — | сама агентство |
| Организация, созданная OWO через «Nowy biznes» / мастер (связь `created_by` указан) | `client` | D-02: создание OWO — явное действие |
| Организация, привязанная старой автопривязкой (без `created_by`) | решает владелец | отдельная классификация |
| Прочие (тестовые, созданные автосвязью) | нет связи | по умолчанию |
**Критерии (D-02, пересмотрено):** новые бизнесы, созданные OWO («Nowy biznes», «Utwórz CRM
klienta»), — `client` автоматически, без дополнительного подтверждения. **Существующие**
организации, получившие строку `agency_clients` старой автопривязкой, классифицируются здесь,
отдельно, по утверждению владельца. Barowo — только `service`. Тестовые — без связи.
Stripe-подписка/оплата — не критерий (D-23). `agency_clients` — лишь один из входов отчёта, не источник истины. Отчёт содержит **все**
организации, способ создания связи, их заказы, исторические Stripe-события (`billing_events`, `organization_billing`) и выплаты.
**Шлюз:** владелец просматривает отчёт и утверждает конкретный список `client` — только после
этого M1.3. Утверждённый список — входной файл миграции (`data/org-relations.json`).

**M1.3 Миграция отношений.** `0039_platform_core.sql`: таблицы `audit_log`, `platform_staff`,
`platform_managed_orgs (agency_org_id, org_id, relation check in ('service','client'), approved_by,
approved_at, note, primary key (agency_org_id, org_id))`, `organization_service_grants`.
Заполнение — **только из утверждённого списка**, не из `agency_clients`. `platform_staff` ←
пользователи с `is_platform_admin`. `manages_organization()` и `agency_sync_service_access`
переписываются на `platform_managed_orgs` (оба типа связи дают сервисный доступ).

**M1.3 — также:** «Nowy biznes» (`lib/team/business-actions.ts`) и мастер «Utwórz CRM klienta»
(`createClientCrmAction`) продолжают создавать связь с агентством и **дополнительно** пишут
`platform_managed_orgs (relation = 'client')` в той же транзакции; связь с агентством берётся
явно по `agency_org_id` кабинета, в котором работает админ (D-21), без «первого найденного».

**M1.4 — окончательно отменён (D-23).** Stripe удалён из приложения (`STRIPE_DECOMMISSION_PLAN.md` §5):
вебхука и `recordInvoice()` больше нет, автоматических заказов агентства из платежей нет.
Абонемент «CRM (abonament)» — ручные заказы или «Powtórz abonamenty».

**M1.5 Исторические записи Barowo — корректировка, а не удаление.**
**Шлюз:** до M1.5 готовится финансовый отчёт по Barowo (`scripts/report-barowo-finance.ts`,
только чтение): все заказы агентства по Barowo (статус, суммы, `stripe_invoice_id`, месяц),
фактические Stripe-оплаты, участие в разделе 10/25/65 по месяцам, связанные выплаты
`agency_payouts`, закрытые периоды. Корректировки согласуются с владельцем **отдельно** по отчёту.

Правила (утверждены владельцем):
| Состояние заказа | Действие |
|---|---|
| `draft` (неоплаченный черновик) | статус `cancelled` + заметка «nie jest klientem agencji (decyzja właściciela)» + `audit_log` (до/после) |
| `invoiced` (выставлен, не оплачен) | проверить, был ли реальный внешний счёт (Stripe/фактура); если не было или он аннулирован — `cancelled` с заметкой и аудитом; если реальный счёт действует — отдельное решение владельца |
| `paid` | **исходные суммы и история сохраняются без изменений**; если заказ участвовал в распределении — при необходимости отдельная **компенсирующая запись** (новая строка с пометкой и ссылкой на исходный заказ) по согласованию |
| любые | уже выплаченные партнёрам суммы **не пересчитываются автоматически**, закрытые периоды не переписываются |
Строка `agency_clients` Barowo — `status = 'lost'` + заметка (не удаляется: на неё ссылаются заказы).

**M1.7 Интерфейс хранения файлов (только проектирование и код без переключения, D-22).**
`lib/platform/files/storage.ts`: `FileStorage { put(key, bytes, contentType, sha256) ; get(key) ;
signedUrl(key, ttlSeconds) ; delete(key) ; head(key) }` с двумя реализациями — `PostgresStorage`
(текущее `bytea`) и `S3Storage` (приватный bucket, S3-совместимый). Выбор реализации по метаданным
файла (`files.storage`), не глобально. Скачивание: маршрут приложения проверяет права → выдаёт
подписанную ссылку на ≤ 5 минут (S3) или отдаёт поток (Postgres). Публичных объектов нет.

**M1.6 Отдельный воркер (D-08, утверждено).** Выполняется после M0 и миграции отношений
(M1.3–M1.5), до M6. Условия: отдельный сервис Railway, тот же Docker-образ, команда
`npm run worker` (`scripts/worker.ts`), **одна реплика**, `pg_advisory_lock(hashtext('owo-worker'))`.
Переключение без одновременного исполнения:
1. Старый воркер в веб-процессе тоже начинает брать **тот же** advisory lock перед каждым проходом
   (деплой веб-версии с этим изменением).
2. Запуск сервиса `worker`: пока lock у веб-процесса, новый ждёт; одновременного исполнения нет.
3. Веб-процесс переводится на `NOTIFICATION_WORKER=off` → lock освобождается → работает только `worker`.
4. Проверка 24 ч: уведомления, напоминания, рассылки и синхронизация рекламы идут, дублей нет
   (`notification_deliveries`, `mailing_recipients`, логи).
5. Откат: `NOTIFICATION_WORKER` в веб-процессе включается, сервис `worker` останавливается.
На M1.6 воркер исполняет **существующие** задачи (уведомления, рассылки, синхронизация рекламы);
исполнителем движка автоматизаций он становится на M6.

| Параметр | Что требуется |
|---|---|
| Цель | Достоверные связи организаций, аудит, отделённый доступ OWO, отдельный воркер |
| Текущие | `is_platform_admin`, `memberships.is_service`, `manages_organization`, `agency_sync_service_access`, `linkBusinessesToAgency`, `recordInvoice`, воркер в `instrumentation.ts` |
| Новые | см. M1.1–M1.6 |
| Миграции БД | `0039_platform_core.sql` (+ данные из утверждённого списка) |
| Файлы | `lib/db/bootstrap.ts`, `lib/billing/sync.ts`, `lib/platform/{audit,staff}.ts`, `scripts/report-org-relations.ts`, `scripts/worker.ts`, миграции функций доступа |
| Совместимость | Сервисный доступ команды к Barowo и клиентам сохраняется (relation `service`/`client`); экраны «Agencja» читают `agency_clients` как раньше |
| Риски | Потеря доступа агентства, если организация не попала в список; ошибочная корректировка заказов Barowo; двойное исполнение при переключении воркера (закрыто advisory lock) |
| Проверки | Отчёт M1.2 и список `client` утверждены; финансовый отчёт Barowo согласован; `tests/db/admin-access`, `agency-access`, `service-membership`, `billing-sync` зелёные; новые тесты webhook; после деплоя `agency_clients` не растёт сам |
| Откат | Флаг `AUTO_LINK_AGENCY_CLIENTS=true`; функции доступа — прежние версии (`create or replace`); корректировки заказов откатываются по `audit_log` |

### M2 — Семантика этапов и pipelines
| Параметр | Что требуется |
|---|---|
| Цель | Убрать зависимость логики от ключей этапов |
| Текущие | `pipeline_stages(kind)`, `seed_lead_stages()`, `lib/presets/index.ts`, `client_stage_position`, `stageForward('contract_sent')`, агентское `'client'` |
| Новые | `pipelines`, колонки `pipeline_id`, `role`, `semantic_tags`, `requires`, `sla_minutes`; `pipeline_transitions`; функция `stage_change` |
| Миграции БД | `0040_pipelines.sql`: по одному `pipelines(entity_key='leads', key='default')` на организацию; `role` ← `kind` (+ `entry` для `new`); теги: `contract_sent` → `{contract_sent}`, `client` → `{client}`; `client_stage_position` и др. переписаны на теги (`create or replace`, тот же результат) |
| Файлы | `db/migrations`, `lib/documents/service.ts` (`stageForward` → по тегу), `lib/agency/*` (по тегу `client`), `lib/presets/index.ts` → данные шаблона (источник правды — SQL/шаблон) |
| Совместимость | `stage_key` у лидов не меняется; `change_lead` продолжает работать |
| Риски | Разные результаты `clients_list` | 
| Проверки | Golden-тесты M0 идентичны; новые: запрещённый переход, `requires` |
| Откат | Функции `create or replace` прежние; новые колонки не мешают |

### M3 — Contacts и обобщённые payments / tasks / files / activities
**Платежи (D-11, окончательно):** новая таблица **`payments` — источник истины**;
`lead_payments` становится **представлением совместимости** над ней.

```sql
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type_id uuid not null,              -- к какой сущности (leads, repair_order, wniosek…)
  record_id uuid not null,
  kind text not null check (kind in ('deposit','balance','other','commission')),
  label text not null check (char_length(label) between 1 and 120),
  amount_grosze bigint not null check (amount_grosze > 0 and amount_grosze <= 100000000),
  due_date date, paid_at timestamptz, position smallint not null default 0,
  created_at timestamptz not null default now(),
  legacy_lead_payment boolean not null default false,
  unique (organization_id, id),
  foreign key (organization_id, entity_type_id) references public.entity_types(organization_id, id)
);
-- перенос: тот же id, entity_type = leads, record_id = lead_id
insert into public.payments (id, organization_id, entity_type_id, record_id, kind, label, amount_grosze,
                             due_date, paid_at, position, created_at, legacy_lead_payment)
select p.id, p.organization_id, et.id, p.lead_id, p.kind, p.label, p.amount_grosze,
       p.due_date, p.paid_at, p.position, p.created_at, true
from public.lead_payments p join public.entity_types et
  on et.organization_id = p.organization_id and et.key = 'leads';
alter table public.lead_payments rename to lead_payments_legacy;   -- удаляется только в M9
create view public.lead_payments with (security_invoker = true) as
  select p.id, p.organization_id, p.record_id as lead_id, p.kind, p.label, p.amount_grosze,
         p.due_date, p.paid_at, p.position, p.created_at
  from public.payments p join public.entity_types et on et.id = p.entity_type_id and et.key = 'leads';
```
- **Чтение:** `finance_summary`, `contracts_list`, напоминания о платежах, `listPayments`,
  Statystyka читают `lead_payments` как раньше (view, `security_invoker` → RLS `payments`).
- **Запись:** `instead of insert` → `insert into payments` с `entity_type_id` лидов (проверка, что
  `lead_id` — лид той же организации); `set_contract_payments()` продолжает работать.
- **Обновление:** `instead of update` — только `paid_at`, `due_date`, `label`, `amount_grosze`
  (как текущие grant'ы); `markPayment()` не меняется.
- **Удаление:** `instead of delete` → `delete from payments where id = old.id`.
- Триггеры напоминаний (`payment_3d/today/overdue`, `0018`) переносятся с `lead_payments` на
  `payments` в той же миграции (иначе на view они не срабатывают).
- RLS `payments`: те же политики, что были у `lead_payments`.

**Тесты идентичности (до гроша):** для каждой организации до и после миграции совпадают
`count(*)`, `sum(amount_grosze)`, `sum(amount_grosze) filter (where paid_at is not null)`,
множество `id`; golden `finance_summary` за 12 месяцев, `contracts_list`; генерация договора на
тестовом лиде создаёт те же строки графика; отметка оплаты через view меняет `payments.paid_at`.

| Параметр | Что требуется |
|---|---|
| Цель | Сущность «человек» и денежные/задачные таблицы, не привязанные только к лиду |
| Текущие | `person_key()` склейка, `lead_payments`, `lead_tasks`, `lead_attachments` (`bytea`), `lead_events` |
| Новые | `contacts` (+ `leads.contact_id`), `payments`, `tasks`, `files`, `activities` (с `entity_type_id`, `record_id`) |
| Миграции БД | `0042_contacts.sql` (контакты из лидов по `person_key`, отчёт сомнительных склеек до записи); `0043_payments.sql` (выше); `0044_tasks_files_activities.sql` (тот же приём: новая таблица + view совместимости для `lead_tasks`, `lead_attachments`) |
| Файлы | старый код в `lib/leads/*`, `lib/finance/*`, `lib/documents/attachments.ts` не меняется |
| Совместимость | всё, что читает/пишет `lead_payments`, работает через view |
| Риски | **Высокий**: склейка разных людей с общим телефоном; деньги; триггеры напоминаний |
| Проверки | тесты идентичности выше; число лидов на контакт; ручная проверка отчёта склеек |
| Откат | `drop view lead_payments; alter table lead_payments_legacy rename to lead_payments;` + обратный перенос строк, созданных после миграции (`legacy_lead_payment = false`) |

**Файлы (D-22):** `0044_tasks_files_activities.sql` создаёт
`files (organization_id, id, filename, content_type, size_bytes, sha256 text not null,
storage text check in ('postgres','s3'), storage_key text, created_by, created_at, unique (organization_id, id))`.
Метаданные переносятся из `lead_attachments`/`document_files`/`organization_templates` с `storage='postgres'`
(`storage_key` = ссылка на исходную строку), содержимое пока остаётся в БД; `lead_attachments` → view совместимости.

**M3.x — перенос содержимого в S3-совместимое хранилище** (отдельный шаг после проверки M3):
1. резервная копия БД; 2. по каждому файлу: `put` в приватный bucket → `head` + сверка `sha256` и
размера → `files.storage = 's3'`; 3. сверка количества и сумм контрольных сумм по организации;
4. **fallback**: при ошибке чтения из S3 сервис читает старое `bytea` (флаг `FILES_FALLBACK_POSTGRES`)
и пишет предупреждение; 5. `bytea` в БД **не удаляется** до успешной проверки и резервной копии;
очистка — отдельная миграция в M9. Тесты: контрольные суммы до/после, скачивание через подписанную
ссылку только с правами, истёкшая ссылка → 403, прямой URL без подписи → 403.

> Примечание: `payments` ссылается на `entity_types`, поэтому M3 выполняется после создания
> `entity_types` с регистрацией стандартных сущностей — **первая часть M4 (M4.1) переносится перед
> M3**: таблицы `entity_types`/`entity_fields` и регистрация `leads`, `contacts`, `payments`,
> `tasks`. Движок `records` (M4.2) — после M3.

### M4 — Метаданные и движок записей
**M4.1 (выполняется перед M3):** `entity_types`, `entity_fields`, `record_counters`; регистрация
стандартных сущностей (`storage='table'`) и их колонок; `roles`, `role_permissions`
(+ `memberships.role_id`, системные роли = owner/admin/member); `can()`.
**M4.2 (после M3; D-10 утверждено — ограничения query engine см. CONFIG_ENGINE_SPEC §5.1):** `records`, `record_values`, `record_unique_keys`, `record_links`, `record_files`,
функции `record_read`, `records_query`, `record_write`, `record_link_add/remove`,
`record_file_add/remove`, `record_ref_check`, `sensitive_access_log` (CONFIG_ENGINE_SPEC §2–4).

| Параметр | Что требуется |
|---|---|
| Цель | Динамические сущности и поля с безопасностью на уровне БД |
| Миграции БД | `0041_entities.sql` (M4.1), `0045_records.sql` (M4.2); `custom_field_defs` → `entity_fields` (интерфейса не было, данных почти нет — отчёт перед переносом) |
| Файлы | `lib/platform/records/*` (тонкий сервис над функциями), `lib/platform/registry.ts` |
| Совместимость | старый код новые таблицы не читает |
| Риски | производительность `records_query` (100 тыс. записей); ошибка в `security definer` функции |
| Проверки | §6: RLS-обход, связи, типы, уникальность, sensitive-журнал |
| Откат | новые таблицы не используются старым кодом |

### M5 — Config Engine и шаблоны (без смены экранов)
| Параметр | Что требуется |
|---|---|
| Цель | Каждая организация получает опубликованную конфигурацию, описывающую **то, что уже есть** |
| Новые | `templates`, `template_versions`, `organization_configs`, `config_versions`, валидатор, `config_publish`, админка OWO `/platform/orgs/[id]/config` (только `platform_staff`) |
| Миграции БД | `0046_config.sql`; шаблоны `event_services@1` (Barowo сегодня), `agency@1` (OWO Ads сегодня); публикация v1 для всех организаций по их `industry_preset` + `organization_modules` |
| Файлы | `lib/platform/config/*`, `app/(platform)/platform/*` |
| Совместимость | Старые экраны не читают конфигурацию; меню — пока из `NAV_GROUPS` |
| Риски | Ошибка материализации ломает публикацию → только транзакция, тест отката |
| Проверки | Публикация/откат на копии продовой БД; `entity_fields` для leads совпадают с колонками |
| Откат | Удаление строк конфигурации не влияет на работу |

### M6 — Автоматизации
| Параметр | Что требуется |
|---|---|
| Цель | Перенести напоминания в движок, дать OWO настраивать правила |
| Текущие | `notification_deliveries` (new_lead, unanswered_15m/2h, payment_*), триггеры в SQL (`0011`, `0018`) |
| Новые | `domain_events`, `automation_rules`, `automation_runs` (+`locked_until`), `automation_run_steps`, `scheduled_triggers`, `outbound_messages`; колонка `source_step_key` (уникальная) в `tasks`, `records`, `documents`; запись событий в `change_lead`, `ingest_lead`, `stage_change`, платежах, документах |
| Миграции БД | `0047_automation.sql`; системные правила шаблонов = текущие напоминания, **в режиме `shadow`** (run пишется, действия не исполняются) |
| Файлы | `lib/platform/automation/*`, `scripts/worker.ts` |
| Совместимость | Старая отправка уведомлений работает, пока правило в shadow |
| Риски | Двойные уведомления при переключении |
| Проверки | Неделя shadow: каждое старое уведомление имеет run того же типа; затем переключение по организации (флаг) и отключение старого триггера |
| Откат | Правила → `enabled=false`, старые триггеры включаются |

### M7 — Интерфейс из конфигурации
| Параметр | Что требуется |
|---|---|
| Цель | Навигация, списки, карточки, формы, Pulpit из конфигурации |
| Новые | `components/platform/*`, маршруты `/r/*`, `/v/*`, `/m/*`; меню из `config.navigation` |
| Файлы | `app/(app)/layout.tsx`, `components/app-shell/nav*.ts(x)` |
| Совместимость | Старые адреса `/leady`, `/umowy`, `/kalendarz`… работают; новые экраны включаются флагом организации `ui_runtime = 'config'` |
| Риски | Потеря функций карточки лида (решения 047–049) |
| Проверки | e2e сценарии запускаются на обоих runtime; чек-лист функций из `docs/audit/OWO_CRM_UX_REQUIREMENTS.md` |
| Откат | `ui_runtime = 'legacy'` |

### M8 — Модули, технический тест, пилот
- `event_mgmt` (D-18): поля мероприятия **остаются колонками `leads`**; модуль только
  регистрирует их как `entity_fields` (`column_name`) и владеет ими; календарь — `EntityCalendar`
  над `leads.event_date`; документы Barowo — действия модуля. Физический перенос в отдельную
  сущность `event` — не в этом плане, требует отдельного решения.
- `agency_finance`: таблицы `agency_*` без изменений, страницы `/agencja` → `/m/agency/*`.
- `ads_analytics` (D-12, утверждено): единая модель — `ad_accounts` + `ad_spend`; данные
  принадлежат **организации клиента**, OWO Ads видит их через сервисный доступ
  (`platform_managed_orgs`). Бюджет клиента хранится отдельно от фактических расходов
  (`ad_budgets (organization_id, ad_account_id null, month, amount_grosze)` у организации клиента;
  сегодня — `agency_client_services.monthly_budget_grosze`) и не смешивается с выручкой агентства.
  **Шлюз:** до миграции — карта переноса `agency_ad_accounts` (см. §8) и проверка, что данные
  не теряются; удаление `agency_ad_accounts` — только в M9.
- - Технический тест: шаблон `automotive@1` на **тестовой** организации, без кода модуля —
  проверка records, связей, процесса, напоминаний.
- `mortgage_refi@1` — **отложен до разговора с клиентом** (сущности, этапы, комиссии, документы,
  автоматизации, чувствительные поля, роли, сроки хранения, RODO/KNF не утверждены); до M4.2 возможен лишь быстрый вариант в текущей
  системе (отдельный пресет), см. DECISIONS.
Проверки: сценарии §7 ниже. Откат: модуль выключается, старые страницы на месте.

### M9 — Уборка
Только после 4+ недель работы всех организаций на новом runtime: удалить `lib/presets`
стадии, старые триггеры уведомлений, `custom_field_defs`, старое меню; перевести
`lead_payments` в чистый view или удалить. Удалить `agency_ad_accounts` (после карты переноса) и содержимое `bytea` файлов (после M3.x, проверки sha256 и резервной копии). Каждое удаление — отдельная миграция с
предварительной проверкой «нет чтений» (логирование обращений на этапе M7).

## 7a. Зависимости этапов от решений
| Этап | Требует утверждённых решений / шлюзов |
|---|---|
| M0 | — (включая статистику файлов, D-22) |
| M1 | D-02 (+ отчёт классификации до M1.3, финансовый отчёт Barowo до M1.5), D-08 (M1.6), D-21, D-22 (M1.7 проект) |
| M2 | D-14 |
| M4.1 | D-03, D-04, D-16 |
| M3 | D-09, D-11, D-15 (ручная проверка неоднозначных склеек), D-22 (`files`) |
| M3.x | D-22 + резервная копия |
| M4.2 | D-04, D-10, D-19 |
| M5 | D-06, D-07, D-13, D-17 |
| M6 | D-08 (воркер уже отдельный), D-20 |
| M7 | D-06 |
| M8 | D-12 (+ карта переноса рекламы), D-18; mortgage_refi — только после интервью |
| M9 | все шлюзы закрыты, 4+ недели на новом runtime |

## 8. Карта переноса `agency_ad_accounts` → `ad_accounts` (черновик, уточняется отчётом)
Готовится скриптом `scripts/report-agency-ad-accounts.ts` (только чтение) **до** миграции рекламы.
| `agency_ad_accounts` | Куда | Правило |
|---|---|---|
| `client_id` → `agency_clients.client_org_id` | `ad_accounts.organization_id` | организация клиента; если `client_org_id` пуст — строка не переносится, попадает в отчёт «нет CRM клиента» |
| `platform` (`google`/`meta`) | `ad_accounts.platform` | 1:1 |
| `external_id` | `ad_accounts.external_id` | нормализация (`act_` префикс Meta); дубль с уже существующим `ad_accounts` → не создаём, связываем |
| `label` | `ad_accounts.name` | пустой → «Konto {platform}» |
| `connected_at` | `ad_accounts.created_at` | |
| `spend_mtd_grosze`, `spend_month`, `spend_synced_at` | — (не переносится как расход) | импорт статистики в старой модели не работал (`0027`); если найдены непустые значения — перечисляются в отчёте, фактические расходы берутся синхронизацией `ad_spend` |
| `agency_client_services.monthly_budget_grosze` (услуга `ads`) | `ad_budgets` организации клиента | отдельно от расходов, не выручка |
Проверка «без потерь»: число строк, пары (`platform`, `external_id`) и бюджеты до/после совпадают
или перечислены в отчёте с причиной.

## Самые рискованные места
1. **M1: связи организаций и заказы Barowo** — только по утверждённому отчёту, корректировки с аудитом.
2. **M3: склейка контактов** и перенос платежей во view совместимости (деньги, RODO).
3. **M2/M3: SQL-функции отчётов** (`finance_summary`, `contracts_list`, `clients_list`,
   `ads_report`, `work_queue`) — менять только с golden-тестами.
4. **M6: двойные/пропавшие уведомления** при переключении на движок.
5. **M7: регрессии карточки лида** — основной рабочий экран.

## 6. Тесты (обязательный набор)
| Группа | Тест | Где |
|---|---|---|
| RLS | участник org A не читает `records/record_values/record_links/config_*` org B; `record_link_add` с `to_id` из org B → ошибка | `tests/db/platform-rls.test.ts` |
| Обход интерфейса | прямой `select` из `record_values/record_links/record_files` → 0 строк; фильтр по скрытому полю → ошибка; `record_read` с чужим `p_org` → ошибка; запись запрещённого поля → ошибка; чтение `sensitive` пишет журнал | `tests/db/field-security.test.ts` |
| Организации | автосвязь при старте выключена: перезапуск не создаёт `agency_clients`; «Nowy biznes» и мастер создают `client` (и `agency_clients`, и `platform_managed_orgs`); Barowo — `service` | `tests/db/org-relations.test.ts`, `billing-sync.test.ts` |
| Платежи | идентичность сумм/количества/id до и после M3 по каждой организации; запись/обновление/удаление через view | `tests/db/payments-compat.test.ts` |
| Сущности | создать сущность в черновике → публикация → запись создаётся; обязательное поле пустое → ошибка; `number` в поле money → ошибка; дубль `plate` → ошибка уникальности | `tests/db/records.test.ts` |
| Связи | many_to_one не позволяет 2 связи; `onDelete restrict` блокирует удаление; фильтр по пути `vehicle.owner` | `records-links.test.ts` |
| Конфигурация | публикация создаёт `config_versions`; разрушающее изменение без плана отклоняется; откат возвращает архивное поле с данными; клиент (owner) не может вызвать `config_publish` | `config.test.ts` |
| Автоматизации | событие → run; повтор события → нет второго run; цикл A→B→A → `skipped loop_guard` на depth 6; выключенное правило не запускается; ошибка шага → 5 повторов → failed; таймаут | `automation.test.ts` |
| Модули | отключение модуля скрывает навигацию и ставит правила на паузу, данные остаются | `modules.test.ts` |
| Финансы | golden: `agency_order_split`, сводка агентства, `finance_summary`, `contracts_list` до/после M2–M3 идентичны | `tests/db/golden/*` |
| Миграции | прогон всех миграций на копии продовой схемы + проверка сумм платежей и количества лидов | `scripts/verify-migration.ts` |
| Регрессия | e2e 37 сценариев на legacy и config runtime | `tests/e2e` |
| Вложенные связи (D-10) | путь из 3 связей отклоняется; путь через поле без права/`sensitive` без права → ошибка; путь через запись другой организации → пусто; > 10 условий → ошибка | `tests/db/records-query-limits.test.ts` |
| Журнал чувствительных данных (D-19) | строка на каждое поле с `result`, `request_id`; отказ тоже пишется; значения не пишутся; очистка удаляет только просроченные без `legal_hold` | `tests/db/sensitive-log.test.ts` |
| Файлы (D-22) | sha256 до/после переноса; подписанная ссылка только после проверки прав; истёкшая → 403; fallback на Postgres | `tests/db/files-storage.test.ts` |
| Нагрузка | 100 тыс. records, фильтр по 2 полям + сортировка < 200 мс; путь из 2 связей + фильтр + сортировка < 300 мс; `ads_report` и `finance_summary` на 50 тыс. лидов | `tests/perf` (ручной запуск) |

## 7. Проверка сценариев после M8
- **Barowo:** несколько заявок у одного контакта со своими этапами; мероприятия в календаре;
  договор генерируется; график платежей по плану; рассылка исключает отписавшихся (по контакту);
  напоминания идут через движок.
- **Автосервис (технический тест):** контакт с 2 автомобилями; ремонт связан с автомобилем; история
  обслуживания = related list ремонтов автомобиля; задачи механикам; платежи по ремонту;
  напоминание о техосмотре.
- **OWO Ads:** продажи, клиенты, услуги, заказы, несколько исполнителей, расходы, 10/25/65,
  фонд, абонементы клиентских CRM (ручные заказы «CRM (abonament)»); суммы месяца совпадают с golden.
