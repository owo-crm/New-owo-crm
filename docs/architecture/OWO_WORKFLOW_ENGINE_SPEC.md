# OWO — спецификация процессов (Pipelines) и автоматизаций

> Проект, ничего не реализовано. Различаем:
> **Pipeline** — набор этапов записи; **Workflow (automation rule)** — правило «триггер → условия →
> действия»; **Run** — одно исполнение правила (workflow instance).

## 1. Pipelines

```sql
create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entity_key text not null,                 -- 'leads', 'repair_order', 'wniosek' (ключ entity_types;
                                            -- текстом, т.к. pipelines создаются в M2 до entity_types/M4.1)
  key text not null, label text not null,
  is_default boolean not null default false,
  archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, entity_key, key)
);

-- существующая таблица pipeline_stages расширяется (не заменяется):
alter table public.pipeline_stages
  add column pipeline_id uuid,               -- null = старая воронка лидов (совместимость)
  add column role text not null default 'open'
    check (role in ('entry','open','won','lost')),   -- семантика, а не название
  add column semantic_tags text[] not null default '{}', -- ['contract_sent','client'] — для модулей
  add column sla_minutes int,                -- «ждёт ответа» дольше → событие stage.sla_breached
  add column requires jsonb not null default '[]';     -- условия входа, см. §1.2

create table public.pipeline_transitions (
  organization_id uuid not null,
  pipeline_id uuid not null,
  from_stage text not null,                  -- '*' = из любого
  to_stage text not null,
  allowed_roles text[],                      -- null = все с правом write
  conditions jsonb not null default '[]',
  primary key (pipeline_id, from_stage, to_stage)
);
```
- `kind` (open/won/lost) существующих этапов маппится в `role`; бизнес-смысл в коде и SQL
  читается только из `role` и `semantic_tags`, **никогда из `key` или польского названия**.
  Пример: `client_stage_position()` → «первый этап с тегом `contract_sent`, иначе первый `won`».
- Если у пайплайна нет строк переходов — разрешены все (поведение сегодня).
- Терминальные: `role in ('won','lost')`; выход из терминального — только ролям из
  `pipeline_transitions.allowed_roles` (например, admin «восстанавливает»).

### 1.1 Пример: Barowo и автосервис
```json
{"pipelines":[
 {"key":"lead_flow","entity":"leads","stages":[
   {"key":"new","label":"Nowy","role":"entry","slaMinutes":10},
   {"key":"contacted","label":"Skontaktowano","role":"open"},
   {"key":"offer_sent","label":"Oferta wysłana","role":"open"},
   {"key":"contract_sent","label":"Umowa wysłana","role":"open","tags":["contract_sent"]},
   {"key":"contract_signed","label":"Umowa podpisana","role":"won",
    "requires":[{"field":"client_full_name","op":"filled"},{"field":"client_address","op":"filled"}]},
   {"key":"rejected","label":"Odrzucony","role":"lost"},
   {"key":"spam","label":"Spam","role":"lost"}]},
 {"key":"repair_flow","entity":"repair_order","stages":[
   {"key":"intake","label":"Przyjęcie","role":"entry"},
   {"key":"diagnosis","label":"Diagnoza","role":"open"},
   {"key":"approval","label":"Akceptacja klienta","role":"open"},
   {"key":"repair","label":"Naprawa","role":"open","requires":[{"field":"estimate","op":"filled"}]},
   {"key":"handover","label":"Wydanie","role":"won"},
   {"key":"cancelled","label":"Anulowane","role":"lost"}],
  "transitions":[
   {"from":"intake","to":"diagnosis"},{"from":"diagnosis","to":"approval"},
   {"from":"approval","to":"repair"},{"from":"repair","to":"handover"},
   {"from":"*","to":"cancelled"}]}
]}
```

### 1.2 Смена этапа — одна функция
`stage_change(org, entity_key, record_id, to_stage, version)` (security invoker):
1. проверка версии (как `change_lead` сегодня);
2. переход разрешён `pipeline_transitions` и ролью;
3. условия `requires` выполнены (те же операторы, что в автоматизациях);
4. запись этапа, `activities('stage_changed')`, `domain_events('record.stage_changed')`;
5. для лидов — сохраняет текущую логику `first_response_at`.
Ошибка возвращает список невыполненных условий — UI показывает их у кнопки.

## 2. События

```sql
create table public.domain_events (           -- outbox: пишется в той же транзакции, что изменение
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  type text not null,                          -- 'record.created', 'record.updated', 'record.stage_changed',
                                               -- 'link.created', 'document.created', 'payment.received',
                                               -- 'webhook.received', 'schedule.tick', 'module.<key>.<event>'
  entity_key text, record_id uuid,
  payload jsonb not null,                      -- {"changed":["stage"],"from":"new","to":"contacted"}
  actor_id uuid,                               -- null = система
  causation_run_id uuid,                       -- если событие вызвано автоматизацией (циклы)
  depth smallint not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index domain_events_pending on public.domain_events (id) where processed_at is null;
```
События по времени («наступила дата», «прошло N часов») порождает планировщик:
`scheduled_triggers(org, rule_id, record_id, fire_at, fired_at)` — строка создаётся при
изменении записи (например, `fire_at = due_at - 24h`) и пересчитывается при изменении поля.

## 3. Правила автоматизаций

```sql
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  key text not null, label text not null,
  trigger jsonb not null,       -- {"type":"record.stage_changed","entity":"leads","to":"contract_signed"}
  conditions jsonb not null default '{"all":[]}',
  actions jsonb not null,       -- массив шагов
  enabled boolean not null default true,
  paused_reason text,           -- 'module_disabled', 'error_rate', 'manual'
  max_runs_per_hour int not null default 500,
  config_version_id uuid not null,
  unique (organization_id, id), unique (organization_id, key)
);

create table public.automation_runs (           -- workflow instance
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  rule_id uuid not null,
  event_id bigint not null,
  record_id uuid,
  status text not null check (status in ('queued','running','waiting','succeeded','failed','skipped','cancelled')),
  locked_until timestamptz,
  step int not null default 0,
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  wait_until timestamptz,                         -- шаг «delay»
  error text,
  idempotency_key text not null,                  -- rule_id + event_id
  started_at timestamptz, finished_at timestamptz,
  unique (organization_id, idempotency_key)
);
create table public.automation_run_steps (
  run_id uuid not null, step int not null, action text not null,
  status text not null, input jsonb, output jsonb, error text, duration_ms int,
  primary key (run_id, step)
);
```

### 3.1 Каталог (реестр `lib/platform/automation/registry.ts`)
**Триггеры:** `record.created`, `record.updated` (+ `fields`), `record.stage_changed`
(+ `from/to/toRole`), `link.created`, `date.reached` (поле + смещение), `time.elapsed`
(с события, если условие ещё верно), `document.created`, `payment.received`, `payment.overdue`,
`webhook.received` (канал), `schedule.cron` (ежедневно HH:MM в часовом поясе организации).

**Условия:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `filled`, `empty`, `in`, `contains`,
`stage.role`, `related.exists` (путь связи), `elapsed` (минуты с поля); группы `all`/`any`
(вложенность ≤ 3).

**Действия:** `set_field`, `set_stage`, `create_record`, `create_task`, `assign_owner`
(конкретный / по кругу / владелец связанной записи), `notify_internal` (push/e-mail/Telegram
участникам), `send_email` (шаблон, только на e-mail записи/контакта, с проверкой отписки),
`send_telegram`, `create_document` (действие модуля документов), `call_webhook` (только
подключение из `integration_connections`), `delay` (ожидание), `module.<key>.<action>`.

Все параметры — значения или шаблоны `{{record.field}}`, `{{contact.first_name}}`
(безопасная подстановка, без выражений).

### 3.2 Примеры правил
```json
[
 {"key":"lead_unanswered_15m","label":"Zapytanie czeka 15 min",
  "trigger":{"type":"time.elapsed","entity":"leads","since":"created_at","minutes":15},
  "conditions":{"all":[{"field":"stage.role","op":"eq","value":"entry"},
                       {"field":"first_response_at","op":"empty"}]},
  "actions":[{"type":"notify_internal","to":"owner_or_all","channels":["push","telegram"],
              "template":"lead_waiting"}]},

 {"key":"contract_signed_payments","label":"Po podpisaniu: zadanie o zaliczce",
  "trigger":{"type":"record.stage_changed","entity":"leads","toTag":"won"},
  "actions":[{"type":"create_task","title":"Sprawdź wpłatę zaliczki","dueInDays":3,"assignTo":"record.owner"}]},

 {"key":"service_reminder","label":"Przypomnienie o przeglądzie",
  "trigger":{"type":"date.reached","entity":"vehicle","field":"next_service_date","offsetDays":-14},
  "actions":[{"type":"send_email","to":"vehicle.owner.email","template":"service_reminder"},
             {"type":"create_task","title":"Zadzwoń: przegląd {{record.plate}}","assignTo":"role:reception"}]},

 {"key":"repair_ready_notify","trigger":{"type":"record.stage_changed","entity":"repair_order","to":"handover"},
  "conditions":{"all":[{"field":"vehicle.owner.phone","op":"filled"}]},
  "actions":[{"type":"send_email","to":"vehicle.owner.email","template":"car_ready"}]}
]
```
Сегодняшние напоминания (`unanswered_15m/2h`, `payment_3d/today/overdue`) становятся
**системными правилами шаблона** — тем же механизмом (этап миграции M5).

## 4. Исполнение

Гарантия движка — **at-least-once** для внутренних шагов с идемпотентностью и
**at-least-once (возможен дубль) для внешних отправок**. Exactly-once для e-mail, Telegram,
push и вебхуков **не обещается**: провайдеры (SMTP, Resend, Telegram Bot API, Web Push) не дают
подтверждённой дедупликации; где провайдер принимает ключ идемпотентности (Resend
`Idempotency-Key`, внешний вебхук с заголовком), он передаётся — это снижает, но не исключает дубли.

### 4.1 Атомарная обработка события
Один проход воркера по событиям — **одна транзакция**:
```sql
begin;
  select * from public.domain_events
   where processed_at is null order by id limit 100 for update skip locked;   -- захват
  -- для каждого события и каждого подходящего enabled-правила:
  insert into public.automation_runs (..., idempotency_key) values (..., rule_id || ':' || event_id)
    on conflict (organization_id, idempotency_key) do nothing;
  update public.domain_events set processed_at = now() where id = any(:ids);
commit;
```
- **Сбой до `commit`** (падение процесса, обрыв соединения): транзакция откатывается целиком —
  ни запусков, ни отметки `processed_at`; событие захватит следующий проход.
- **Сбой после `commit`**: запуски уже созданы и событие отмечено; исполнение запусков —
  отдельная фаза (4.2), она подхватит их по статусу `queued`.
- Повторная обработка того же события (например, ручной сброс `processed_at`) не создаёт
  второго запуска благодаря `unique (organization_id, idempotency_key)`.

### 4.2 Исполнение запуска и шагов
- Захват: `select … from automation_runs where status in ('queued','waiting') and next_attempt_at <= now()
  for update skip locked limit 20`, статус → `running`, `locked_until = now() + 5 min`.
- Условия правила перепроверяются на **текущих** данных записи (между событием и запуском
  запись могла измениться); не выполнены → `skipped`.
- Каждый шаг имеет ключ `step_key = run_id || ':' || step` и строку в `automation_run_steps`
  (`primary key (run_id, step)`):
  - **внутренние шаги** (`set_field`, `set_stage`, `create_record`, `create_task`, `assign_owner`,
    `create_document`) выполняются в одной транзакции **вместе** с записью
    `automation_run_steps.status = 'succeeded'` — шаг либо применён и отмечен, либо не применён;
    повтор после сбоя видит отметку и пропускает шаг. Шаги создания несут `source_step_key`
    (уникальный индекс в `tasks`, `records`, `documents`) — второе создание невозможно;
  - **внешние шаги** (`send_email`, `send_telegram`, `notify_internal`, `call_webhook`) **не
    отправляют ничего сами**: в той же транзакции они пишут строку в outbox (4.3) с
    `unique (step_key)` и отмечают шаг как `succeeded` («поставлено в очередь»).
- Зависший `running` (`locked_until < now()`) возвращается в `queued`.

### 4.3 Outbox внешних отправок
```sql
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  step_key text not null unique,               -- run_id:step — дубль постановки невозможен
  channel text not null check (channel in ('email','telegram','push','webhook')),
  target_ref text not null,                    -- id получателя/подключения, не адрес и не текст
  template_key text not null, params jsonb not null default '{}',  -- только id и ключи полей
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','unknown','cancelled')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text, last_error text,
  created_at timestamptz not null default now(), sent_at timestamptz
);
```
Существующая `notification_deliveries` — частный случай этой таблицы; в M6 она остаётся, новый
outbox используется для правил автоматизаций, объединение — решение M9.

**Отправитель** (отдельная фаза воркера): захват `queued` (`skip locked`) → `sending` →
вызов провайдера с таймаутом → результат:
| Результат провайдера | Статус | Повтор |
|---|---|---|
| 2xx / принято | `sent` + `provider_message_id` | нет |
| 4xx постоянная ошибка (неверный адрес, 410 push, отписка) | `failed` | нет |
| 429 / 5xx / сетевая ошибка **до** отправки запроса | `queued`, `next_attempt_at` по экспоненте | да, до 5 попыток (1, 2, 4, 8, 16 мин) |
| **Таймаут после отправки запроса** (ответ не получен) | `unknown` | **автоматически не повторяется** для e-mail/Telegram (повтор = вероятный дубль клиенту); для вебхука с `Idempotency-Key` — повтор разрешён; для push — повтор разрешён (дубль безвреден) |
`unknown` показывается OWO в журнале с кнопкой «Wyślij ponownie» (ручное решение).
Отписка (`mail_optouts`) проверяется **в момент отправки**, а не только при постановке.

### 4.4 Повторы внутренних шагов
Ошибки БД-сериализации/блокировки — до 5 повторов шага (экспонента); ошибка данных (поле
удалено, запись удалена, валидация) — сразу `failed` без повторов, правило получает счётчик
ошибок; > 20 ошибок за час → `paused_reason = 'error_rate'`.

### 4.5 Прочие правила надёжности
- **Никаких автоматизаций в HTTP-запросе**: пользовательская транзакция только пишет событие.
- **Таймауты:** внутренний шаг 10 с (`statement_timeout`), вебхук 5 с, SMTP 15 с.
- **Циклы:** событие от run получает `depth+1` и `causation_run_id`; при `depth > 5` правила не
  запускаются (`skipped`, `loop_guard`); одно правило не чаще 1 раза в 60 с на одну запись.
- **Частота:** `max_runs_per_hour` на правило, 5000/ч на организацию → пауза + уведомление OWO.
- **Отключение:** `enabled=false` — новые события игнорируются, `queued`-запуски и связанные
  `queued`-сообщения outbox → `cancelled`; отключение модуля ставит его правила на паузу.
- **Права:** действие выполняется от системного актора организации (роль `automation` с правами
  из конфигурации, через те же функции `record_write`/`record_link_add`); чужие записи
  недоступны по RLS; `call_webhook` — только в заранее подключённые `integration_connections`.

### 4.6 Аудит и минимизация данных
- `automation_runs`, `automation_run_steps`, `outbound_messages` хранят **идентификаторы и ключи
  полей**, не значения: в `input/output/params` нет e-mail, телефонов, текстов писем, сумм
  чувствительных полей. Текст письма собирается в момент отправки из шаблона и текущих данных.
- Срок хранения: запуски и шаги — 90 дней, outbox `sent/failed` — 30 дней (затем удаляются
  заданием очистки), агрегированная статистика правил — бессрочно.
- Изменения правил (создание, включение/выключение, публикация) — в `audit_log` через
  публикацию конфигурации.

## 5. Задачи и напоминания
`tasks (organization_id, id, entity_type_id, record_id, title, due_at, assignee_id, done_at,
source_step_key)` — замена `lead_tasks`. Напоминание о задаче = системное правило
`date.reached` по `tasks.due_at`. «На сегодня» на Pulpit — представление над `tasks` и
`leads.next_contact_at` (сохраняем поле).

## 6. Тесты движка
См. `OWO_CRM_MIGRATION_PLAN.md` §6, плюс: повтор события не создаёт второй run; падение
между захватом события и `commit` → событие обработано один раз при следующем проходе;
повтор шага `create_task` после сбоя не создаёт вторую задачу (`source_step_key`); таймаут
провайдера e-mail → статус `unknown`, автоповтора нет; 5xx до отправки → 5 повторов → `failed`;
отписанный адрес → `cancelled` в момент отправки; цикл A→B→A останавливается на depth 5;
отключённое правило отменяет очередь; запрещённый переход отклоняется с перечнем условий;
правило другой организации не видит записи; в `automation_run_steps` нет персональных данных.
