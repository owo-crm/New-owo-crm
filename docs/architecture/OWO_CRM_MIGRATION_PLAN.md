# OWO — план поэтапной миграции

> Без переписывания с нуля. Принцип «strangler»: новое рядом со старым, общие данные,
> перевод по одному модулю, удаление старого — только после проверки. Каждый этап — отдельные
> миграции `00NN_*.sql`, обратно совместимые (только `add`, без `drop` до этапа M9).
> Номера миграций — ориентировочные.

## Обзор

```mermaid
gantt
  dateFormat X
  axisFormat %s
  section Основа
  M0 Подготовка и тесты-страховка :m0, 0, 1
  M1 Platform Core: аудит, staff, отдельный воркер :m1, 1, 2
  M2 Семантика этапов и pipelines :m2, 2, 3
  section Данные
  M3 Contacts + payments/tasks/files обобщённые :m3, 3, 5
  M4 Метаданные и движок records :m4, 5, 7
  section Конфигурация
  M5 Config Engine + шаблоны (только чтение, Barowo/OWO как есть) :m5, 7, 9
  M6 Автоматизации (перенос напоминаний) :m6, 9, 11
  M7 Рендер интерфейса из конфигурации :m7, 11, 13
  section Отрасли
  M8 Модули: event_mgmt, agency_finance, ads; пилот автосервиса :m8, 13, 15
  M9 Уборка старого :m9, 15, 16
```

---

### M0 — Подготовка и страховочные тесты
| Параметр | Что требуется |
|---|---|
| Цель | Зафиксировать текущее поведение, чтобы ловить регрессии |
| Текущие | 53 файла тестов, e2e 37 сценариев (`tests/db`, `tests/unit`, `tests/e2e`) |
| Новые | Снимки результатов SQL-функций на фиксированном наборе данных: `work_queue`, `dashboard_charts`, `calendar_events`, `clients_list`, `contracts_list`, `finance_summary`, `ads_report`, `agency_order_split`, сводка агентства за месяц (`tests/db/golden/*.test.ts`) |
| Миграции БД | нет |
| Файлы | `tests/db/golden/`, `tests/fixtures/barowo-like.sql`, `agency-like.sql` |
| Совместимость | — |
| Риски | Неполные фикстуры → пропущенные регрессии |
| Проверки | Все golden-тесты зелёные на `main` |
| Откат | — |

### M1 — Platform Core: аудит, сервисный доступ, отдельный воркер, явные связи организаций
| Параметр | Что требуется |
|---|---|
| Цель | Основа безопасности до любых конструкторов |
| Текущие | `is_platform_admin`, `memberships.is_service`, `manages_organization`, `linkBusinessesToAgency`, воркер в `instrumentation.ts` |
| Новые | `audit_log`; `platform_staff(user_id, level)`; `platform_managed_orgs(agency_org_id, org_id, relation 'service'/'client', created_by)`; команда `npm run worker` (тот же образ, отдельный сервис Railway) с advisory-lock `pg_try_advisory_lock(hash('owo-worker'))` |
| Миграции БД | `0039_platform_core.sql`: таблицы выше; перенос: `platform_managed_orgs` ← `agency_clients.client_org_id` (relation = 'client' — как сейчас); `platform_staff` ← пользователи с `is_platform_admin` |
| Файлы | `lib/platform/audit.ts`, `lib/platform/staff.ts`, `scripts/worker.ts`, `lib/db/bootstrap.ts` (`linkBusinessesToAgency` → только по флагу `AUTO_LINK_AGENCY_CLIENTS`, по умолчанию выключено после подтверждения D-02), `manages_organization` читает `platform_managed_orgs` |
| Совместимость | `is_platform_admin()` остаётся синонимом `platform_staff` уровня architect |
| Риски | Двойной воркер на переходе → только advisory-lock; потеря доступа агентства к Barowo, если relation не перенесён |
| Проверки | `tests/db/admin-access`, `agency-access`, `service-membership` зелёные; e2e агентства; два воркера одновременно — один ждёт |
| Откат | Переменная `WORKER_IN_WEB=true` возвращает воркер в веб; функции `manages_organization` — `create or replace` прежней версии |

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
| Параметр | Что требуется |
|---|---|
| Цель | Сущность «человек» и денежные/задачные таблицы, не привязанные только к лиду |
| Текущие | `person_key()` склейка, `lead_payments`, `lead_tasks`, `lead_attachments`, `lead_events` |
| Новые | `contacts` (+ `leads.contact_id`), `payments`, `tasks`, `files`, `activities` с полями `record_entity`, `record_id` |
| Миграции БД | `0041_contacts.sql`: создать контакты из лидов по `person_key` (телефон → e-mail), проставить `leads.contact_id`; `marketing_consent_at`, отписка — на контакте. `0042_records_generic.sql`: **представления совместимости** — `lead_payments` становится view над `payments where record_entity='leads'` с `instead of` триггерами (или наоборот: новые таблицы — сначала view над старыми, решение в D-11) |
| Файлы | `lib/leads/*`, `lib/finance/*`, `lib/documents/attachments.ts`, `components/leads/*` не меняются на этом этапе |
| Совместимость | `finance_summary`, `contracts_list`, напоминания о платежах, Statystyka — читают через view |
| Риски | **Высокий**: склейка контактов может объединить разных людей с общим телефоном; деньги |
| Проверки | Сумма платежей до/после до гроша по каждой организации; число лидов на контакт; golden `finance_summary` |
| Откат | View/триггеры удаляются, старые таблицы остаются источником |

### M4 — Метаданные и движок записей
| Параметр | Что требуется |
|---|---|
| Цель | Динамические сущности и поля |
| Новые | `entity_types`, `entity_fields`, `records`, `record_values`, `record_unique_keys`, `record_links`, функции `record_link_add`, `next_record_number`, `can()`; `roles`, `role_permissions` (+ `memberships.role_id`, системные роли = текущие owner/admin/member) |
| Миграции БД | `0043_records.sql`; регистрация стандартных сущностей (`storage='table'`: leads, contacts, payments, tasks) с полями-колонками; `custom_field_defs` → `entity_fields` (их нет в интерфейсе — данных почти нет); значения `leads.custom_fields` → `record_values`? — **нет**: для `storage=table` пользовательские поля храним в `record_values` с `record_id = leads.id` (тот же механизм) |
| Файлы | `lib/platform/records/*` (service, validate, query), `lib/platform/registry.ts` |
| Совместимость | Ничего из старого не читает новые таблицы |
| Риски | Производительность фильтров по `record_values` — проверить на 100 тыс. записей |
| Проверки | Тесты §6: RLS, связь в чужую организацию, типы, уникальность, onDelete |
| Откат | Таблицы не используются старым кодом — достаточно выключить флаг |

### M5 — Config Engine и шаблоны (без смены экранов)
| Параметр | Что требуется |
|---|---|
| Цель | Каждая организация получает опубликованную конфигурацию, описывающую **то, что уже есть** |
| Новые | `templates`, `template_versions`, `organization_configs`, `config_versions`, валидатор, `config_publish`, админка OWO `/platform/orgs/[id]/config` (только `platform_staff`) |
| Миграции БД | `0044_config.sql`; шаблоны `event_services@1` (Barowo сегодня), `agency@1` (OWO Ads сегодня); публикация v1 для всех организаций по их `industry_preset` + `organization_modules` |
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
| Новые | `domain_events`, `automation_rules`, `automation_runs`, `automation_run_steps`, `scheduled_triggers`; запись событий в `change_lead`, `ingest_lead`, `stage_change`, платежах, документах |
| Миграции БД | `0045_automation.sql`; системные правила шаблонов = текущие напоминания, **в режиме `shadow`** (run пишется, действия не исполняются) |
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

### M8 — Модули и пилот новой отрасли
- `event_mgmt`: перенос полей мероприятия из `leads` в поля модуля (`entity_fields` с
  `column_name` — колонки **остаются**, меняется только принадлежность), календарь как
  `EntityCalendar`, документы Barowo как действия модуля.
- `agency_finance`: таблицы `agency_*` без изменений, страницы `/agencja` → `/m/agency/*`.
- `ads_analytics`: `ad_accounts/ad_spend` + решение о `agency_ad_accounts` (D-12).
- Пилот: шаблон `automotive@1` на тестовой организации, без кода модуля.
Проверки: сценарии §7 ниже. Откат: модуль выключается, старые страницы на месте.

### M9 — Уборка
Только после 4+ недель работы всех организаций на новом runtime: удалить `lib/presets`
стадии, старые триггеры уведомлений, `custom_field_defs`, старое меню; перевести
`lead_payments` в чистый view или удалить. Каждое удаление — отдельная миграция с
предварительной проверкой «нет чтений» (логирование обращений на этапе M7).

## Самые рискованные места
1. **M3: склейка контактов** и обобщение платежей (деньги, RODO) — только с отчётом
   «сомнительные склейки» на ручную проверку.
2. **M2/M3: SQL-функции отчётов** (`finance_summary`, `contracts_list`, `clients_list`,
   `ads_report`, `work_queue`) — менять только с golden-тестами.
3. **M6: двойные/пропавшие уведомления** при переключении на движок.
4. **M1: связь агентство ↔ организации** (решение D-02) — от неё зависят права и финансы.
5. **M7: регрессии карточки лида** — основной рабочий экран.

## 6. Тесты (обязательный набор)
| Группа | Тест | Где |
|---|---|---|
| RLS | участник org A не читает `records/record_values/record_links/config_*` org B; `record_link_add` с `to_id` из org B → ошибка | `tests/db/platform-rls.test.ts` |
| Сущности | создать сущность в черновике → публикация → запись создаётся; обязательное поле пустое → ошибка; `number` в поле money → ошибка; дубль `plate` → ошибка уникальности | `tests/db/records.test.ts` |
| Связи | many_to_one не позволяет 2 связи; `onDelete restrict` блокирует удаление; фильтр по пути `vehicle.owner` | `records-links.test.ts` |
| Конфигурация | публикация создаёт `config_versions`; разрушающее изменение без плана отклоняется; откат возвращает архивное поле с данными; клиент (owner) не может вызвать `config_publish` | `config.test.ts` |
| Автоматизации | событие → run; повтор события → нет второго run; цикл A→B→A → `skipped loop_guard` на depth 6; выключенное правило не запускается; ошибка шага → 5 повторов → failed; таймаут | `automation.test.ts` |
| Модули | отключение модуля скрывает навигацию и ставит правила на паузу, данные остаются | `modules.test.ts` |
| Финансы | golden: `agency_order_split`, сводка агентства, `finance_summary`, `contracts_list` до/после M2–M3 идентичны | `tests/db/golden/*` |
| Миграции | прогон всех миграций на копии продовой схемы + проверка сумм платежей и количества лидов | `scripts/verify-migration.ts` |
| Регрессия | e2e 37 сценариев на legacy и config runtime | `tests/e2e` |
| Нагрузка | 100 тыс. records, фильтр по 2 полям + сортировка < 200 мс; `ads_report` и `finance_summary` на 50 тыс. лидов | `tests/perf` (ручной запуск) |

## 7. Проверка сценариев после M8
- **Barowo:** несколько заявок у одного контакта со своими этапами; мероприятия в календаре;
  договор генерируется; график платежей по плану; рассылка исключает отписавшихся (по контакту);
  напоминания идут через движок.
- **Автосервис (пилот):** контакт с 2 автомобилями; ремонт связан с автомобилем; история
  обслуживания = related list ремонтов автомобиля; задачи механикам; платежи по ремонту;
  напоминание о техосмотре.
- **OWO Ads:** продажи, клиенты, услуги, заказы, несколько исполнителей, расходы, 10/25/65,
  фонд, подписки клиентских CRM; суммы месяца совпадают с golden.
