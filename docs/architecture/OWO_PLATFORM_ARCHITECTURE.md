# OWO Platform — целевая архитектура

> Проектный документ. Ничего не реализовано. Основа — аудит `OWO_ARCHITECTURE_AUDIT.md`.
> Спецификации: `OWO_CONFIG_ENGINE_SPEC.md`, `OWO_WORKFLOW_ENGINE_SPEC.md`;
> решения: `OWO_ARCHITECTURE_DECISIONS.md`; план: `OWO_CRM_MIGRATION_PLAN.md`.

## 1. Принципы
1. **Один монолит, одна БД, одна установка** — изоляция через `organization_id` + RLS (D-01).
2. **Гибрид данных**: стандартные сущности — настоящие таблицы; специализированные и
   созданные OWO — типизированная универсальная таблица записей (D-04).
3. **Конфигурация — данные, а не код**: только валидированный JSON, рендер только из
   разрешённых компонентов, никакого SQL/JS из базы (D-06).
4. **OWO конструирует, клиент пользуется**: изменение конфигурации — только у сервисной роли
   платформы (D-07).
5. **Сложная логика — кодом в модулях**, конфигурация её подключает, а не заменяет.
6. **Финансы разделены**: платежи клиентов CRM, финансы агентства и подписки платформы —
   три независимых контура (D-09).

## 2. Слои

```mermaid
flowchart TB
  subgraph UI[Next.js UI]
    SHELL[App shell / навигация из конфигурации]
    RENDER[Config renderer: list / table / card / form / kanban / calendar / dashboard]
    CUSTOM[Страницы модулей — обычный React]
  end
  subgraph CFG[Configuration Engine]
    REG[Registry: модули, типы полей, виджеты, действия]
    CONF[organization_configs + config_versions]
    TPL[Industry Templates: templates + template_versions]
  end
  subgraph CRM[CRM Core]
    CONTACT[contacts / companies]
    REC[records + entity_types + entity_fields + record_links]
    PIPE[pipelines / stages / transitions]
    ACT[activities / tasks / notes / files / documents / payments]
    VIEWS[Query engine: фильтры, поиск, сортировка]
  end
  subgraph WF[Workflow & Automation]
    BUS[domain_events outbox]
    RULES[automation_rules]
    RUNNER[Worker: automation_runs]
  end
  subgraph MOD[Specialized Modules]
    EVENT[event_mgmt]
    AUTO[automotive]
    ESTATE[real_estate]
    DOCS[advanced_documents]
    ADS[ads_analytics]
    AG[agency_finance — Agency Domain]
  end
  subgraph CORE[Platform Core]
    ORG[organizations / memberships / roles / permissions]
    BILL[billing / modules]
    FILES[files] 
    NOTIF[notifications]
    AUDIT[audit_log]
    INTEG[integrations / webhooks / secrets]
  end
  UI --> CFG
  UI --> CRM
  UI --> MOD
  CRM --> CORE
  CFG --> CORE
  MOD --> CRM
  MOD --> CORE
  CRM --> BUS
  MOD --> BUS
  BUS --> RUNNER --> RULES
  RUNNER --> CRM & NOTIF & INTEG
```

Зависимости только вниз: Modules → CRM Core → Platform Core. Configuration Engine читают все слои;
пишет в него только админ-панель OWO.

## 3. Platform Core
| Компонент | Таблицы (существующие → целевые) | Ответственность |
|---|---|---|
| Организации | `organizations` (без `industry_preset` как логики; поле остаётся информационным) | рабочее пространство, реквизиты, локаль, валюта, часовой пояс |
| Участники и роли | `memberships`, `invitations`, **новые** `roles`, `role_permissions` | роли per организация (owner/admin/member — системные + роли шаблона) |
| Сервисный доступ OWO | **новая** `platform_staff` (user_id, level `operator`/`architect`) | отделён от `memberships`; даёт право конфигурировать (см. §8) |
| Биллинг | `organization_modules`, `organization_billing`, `billing_events`, **новый** реестр `platform_modules` | подписка платформы (контур №3) |
| Файлы | `lead_attachments`, `document_files` → **`files`** (record-agnostic) | хранение, скачивание с проверкой прав |
| Уведомления | `notification_settings`, `notification_deliveries`, push, telegram | доставка; события приходят из автоматизаций |
| Аудит | **новая** `audit_log` | кто/что/когда для конфигурации, прав, финансов |
| Интеграции | `channels`, `platform_secrets`, **новая** `integration_connections` | входящие каналы, исходящие вебхуки, OAuth/ключи (шифр) |

## 4. CRM Core
**Универсальные (настоящие таблицы)** — нужны почти каждой отрасли и участвуют в отчётах:

| Сущность | Таблица | Почему ядро |
|---|---|---|
| Контакт (человек) | **`contacts`** | дедупликация, рассылки, согласия RODO, отписки |
| Компания | **`companies`** | B2B (агентство, недвижимость) |
| Заявка | `leads` (сохраняется, без отраслевых колонок) | каналы, первый ответ, SLA, реклама (utm) |
| Активности | **`activities`** (заметка, звонок, e-mail, событие системы) ← обобщение `lead_events` | лента записи |
| Задачи | `lead_tasks` → **`tasks`** (ссылка на любую запись) | напоминания, «на сегодня» |
| Документы | `documents`, `document_files` (+ `record_ref`) | генерация, номера |
| Платежи | `lead_payments` → **`payments`** (+ `record_ref`) | графики, просрочки, статистика |
| Файлы | `files` | |

**Через движок записей (`records`)** — отраслевые и единичные: Мероприятие, Автомобиль,
Ремонтный заказ, Объект недвижимости, Просмотр, Запчасть и т.д.

**Специализированные таблицы модулей** — где нужна сложная логика/деньги: агентство
(`agency_*`), реклама (`ad_*`), договоры с финансовыми правилами.

Правило выбора (D-05): *таблица*, если сущность участвует в деньгах, массовых SQL-отчётах
или юридически значимых процессах; *records*, если это справочник/объект отрасли с
пользовательскими полями и обычными фильтрами.

## 5. Configuration Engine (кратко, подробно — CONFIG_ENGINE_SPEC)
- `templates` / `template_versions` — отраслевые шаблоны (неизменяемые версии).
- `organization_configs` (черновик) + `config_versions` (опубликованные снимки).
- Конфигурация = модули + сущности + поля + связи + процессы + представления + навигация +
  роли + автоматизации + настройки интеграций.
- Публикация: валидация → материализация (создание `entity_types/entity_fields/pipelines`,
  индексов) → новый `config_versions.id` становится активным атомарно.
- Обновление шаблона не трогает организации: OWO вручную «применяет» новую версию шаблона
  как трёхстороннее слияние (база шаблона ↔ новая версия ↔ локальные изменения).

## 6. Workflow & Automation (кратко, подробно — WORKFLOW_ENGINE_SPEC)
- `pipelines` (на сущность), `pipeline_stages` с `stage_role`, `pipeline_transitions`.
- Все изменения записей пишут `domain_events` (outbox в той же транзакции).
- Воркер читает события, сопоставляет `automation_rules`, исполняет действия из реестра
  (`automation_runs`, повторы, идемпотентность, лимиты, защита от циклов).
- **Воркер — отдельный процесс** (тот же образ, команда `worker`), D-08.

## 7. Specialized Modules
Модуль = каталог `modules/<key>/` с манифестом (TypeScript, проверяется при сборке):

```ts
// modules/event_mgmt/manifest.ts
export default defineModule({
  key: "event_mgmt",
  version: "1.0.0",
  dependsOn: ["crm_core", "documents", "payments"],
  entities: [eventEntity],            // записи в движке records или свои таблицы
  fields: { leads: [eventDateField] },// расширение стандартных сущностей
  permissions: ["event.read", "event.write", "event.generate_contract"],
  actions: [generateContractAction],  // доступны автоматизациям и кнопкам
  triggers: ["event.date_reached"],
  pages: [{ path: "/m/events/calendar", component: () => import("./pages/calendar") }],
  widgets: [occupancyWidget],
  migrations: "modules/event_mgmt/sql", // свои таблицы, только с organization_id + RLS
  onEnable, onDisable,                // идемпотентные; отключение не удаляет данные
});
```
Реестр собирается при сборке (`modules/index.ts`), в БД — `platform_modules` (ключ, версия).
Включение у организации — `organization_modules` + проверка зависимостей.
Отключение: модуль скрывается, автоматизации с его действиями ставятся на паузу, данные остаются.

Планируемые модули: `event_mgmt` (из Barowo), `automotive`, `real_estate`,
`advanced_documents`, `ads_analytics`, `mailing`, `agency_finance`.

## 8. Agency Domain
Модуль `agency_finance`, включается только организации-агентству (флаг в `platform_modules`
`restricted_to_platform: true`). Таблицы `agency_*` остаются как есть. Связь с клиентскими
организациями — только через явную таблицу **`platform_managed_orgs`** (агентство ↔ организация,
тип связи `service` / `client` — D-02), а не через неявный `linkBusinessesToAgency`.
Деньги клиентских CRM в агентство не попадают; абонементы платформы попадают в агентство только
через `billing_events` → заказ услуги `crm`.

## 9. Безопасность (сводка)
- Каждая таблица и каждая динамическая запись — `organization_id NOT NULL` + RLS.
- Связи между записями — составные FK `(organization_id, id)`: связь в чужую организацию
  невозможна на уровне ограничения БД.
- Права: роль → `role_permissions` (`entity:<key>:read|write|delete`, `field:<entity>.<field>:read|write`,
  `action:<key>`). Проверка в Server Action + RLS по чтению.
- Конфигурация пишется только функциями `config_*` `security definer` с проверкой
  `is_platform_staff('architect')`; клиент не имеет grant на таблицы конфигурации.
- Сервисный доступ OWO: `platform_staff` + `organization_service_grants` (срок, причина),
  все действия в `audit_log`.
- Автоматизации исполняются от имени системного актора с правами организации, не выше.
- Вебхуки: подпись HMAC, ключ per подключение, лимиты, журнал без персональных данных.

## 10. Проверка на сценариях

| | Barowo (event) | Автосервис | OWO Ads |
|---|---|---|---|
| Общие | contacts, leads, activities, tasks, files, documents, payments, pipelines, automations, mailing | contacts, activities, tasks, payments, pipelines, automations, notifications | contacts, companies, leads, activities, tasks |
| Специфичные | модуль `event_mgmt`: запись «Wydarzenie» (records), договор/оферта Barowo, календарь по дате события, план предоплат | модуль `automotive`: записи Vehicle, RepairOrder, ServiceHistory (records), Part; pipeline RepairOrder | модуль `agency_finance` (таблицы agency_*), `ads_analytics` |
| Несколько заявок у человека | `leads.contact_id` → один contact, у каждой заявки своя стадия | — | лиды агентства → company |
| Несколько объектов у контакта | Event N:1 Contact | Vehicle N:1 Contact; RepairOrder N:1 Vehicle | — |
| Деньги | `payments` (record_ref на лид/событие) — контур 1 | `payments` (record_ref на ремонт) — контур 1 | `agency_orders` — контур 2; подписки — контур 3 |
| Исключения | нет: всё через шаблон + модуль | нет: модуль `automotive` (или только шаблон без кода) | нет |

Автосервис **можно запустить без кода**, только шаблоном (records + pipeline + автоматизации
напоминаний). Код модуля нужен лишь для специфики (например, расчёт запчастей). Это
подтверждает, что архитектура не требует исключений на каждый бизнес.
