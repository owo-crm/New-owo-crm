# Adam / real-estate — отчёт фазы 0 и первый рабочий пакет

Источник задачи: `ADAM_OWO_CRM_PROPERTIES_ARCHITECTURE_FOR_CLAUDE.md` (кабинет Адама в OWO CRM).
Дата проверки `main`: 2026-11-25.

## 1. Ответы на открытые вопросы (§12 ТЗ)

| # | Вопрос | Факт на `main` |
|---|---|---|
| 1 | Влиты ли M2 (pipelines), M4.1 (entity registry), M3 contacts/files, M3.x S3? | **Нет.** Последние миграции до этого пакета: `0039_platform_core`, `0040_barowo_separate`, `0041–0043` (почта, чат-документы). Таблиц `pipelines`, `entity_types/entity_fields`, `records`, `contacts`, `files` нет. Воронка — `pipeline_stages` (key, label, position, kind open/won/lost), засеивается триггером `seed_lead_stages()` по `industry_preset`. |
| 2 | Текущий FileStorage и generic `files`? | `lib/platform/files/storage.ts` (M1.7): интерфейс + `PostgresStorage` (только чтение bytea из `lead_attachments`/`document_files`/`organization_templates`) + `S3Storage` (SigV4, приватный bucket, подписанные ссылки ≤ 5 мин). **Приложение на него не переключено; таблицы `files` нет; переменные `FILES_S3_*` в production не заданы.** |
| 3 | Где создаётся `agency_clients` и как использовать мастер CRM? | Запись создаёт кабинет агентства (`/agencja/klienci/nowy`, `lib/agency/actions.ts`). CRM клиента — `createClientCrmAction` (`lib/billing/actions.ts`): `create_organization(name, slug, preset)` → `mark_service_membership` (создатель = service admin) → `agency_clients.client_org_id` → триггер `agency_clients_sync_access` создаёт связь `platform_managed_orgs (relation='client')` и сервисный доступ. Пресет проверяется через `isPresetKey`, поэтому после добавления `real-estate` мастер умеет создавать такой кабинет без изменений. |
| 4 | Безопасный способ первого owner invite? | Общая `create_invitation` пускает owner-приглашение только от действующего owner — у нового кабинета клиента его нет. **Сделано:** отдельные функции `create_client_owner_invitation / revoke_client_owner_invitation / client_owner_status` (миграция `0044`): админ платформы + owner/admin агентства, явная связь `client`, нет владельца-человека, 7 дней, повторная выдача отзывает прежнюю ссылку, аудит create/revoke/accept без токена. Принятие — существующий `accept_invitation` (он уже снимает `is_service` с владельца). Общая функция не ослаблена (есть тест). |
| 5 | Семантические теги воронки (M2)? | Нет. Есть только `pipeline_stages.kind`. Код опирается на ключи `new` (значение по умолчанию, дашборд) и `spam` (рассылки, фильтры) — оба есть в воронке real-estate. Бизнес-логику на прочие ключи не завязываем. |
| 6 | Как сайт получит объекты без JS-only подгрузки и ручного rebuild? | Сейчас никак: `sites/adam` — статическая сборка, `offers = []` в `config.mjs`. План (фаза 4–5): публичный read-API в CRM + серверный рендер каталога и карточек в `sites/adam/server.mjs` с коротким кэшем и динамическим `sitemap.xml`. Не начато. |

## 2. Сделано в этом пакете (фаза 0 + часть фазы 1)

- Пресет `real-estate` (`lib/presets/index.ts`, `messages/pl.json`) и воронка в SQL (`0044`): `new → contacted → consultation → viewing → negotiation → contract → won`, `lost`, `spam`. Ветки `agency` и `event-services` скопированы без изменений (тест).
- Навигация: `NavContext.preset`, `NavItem.hideFor`; у `real-estate` скрыты «Umowy» (договоры мероприятий). Разделы агентства и так закрыты на сервере (`requireAgency` → `notFound` для не-agency).
- Карточка клиента агентства: блок «Właściciel kabinetu» (только админ платформы) — создать/перевыдать/отозвать одноразовую ссылку владельца; ссылка показывается один раз, в логи не пишется.
- Тесты: `tests/db/real-estate.test.ts` (8), `tests/unit/real-estate-nav.test.ts` (3).

**Пакет 2 (фаза 1, завершение):**
- `leads.topic` — тема обращения отдельным полем (миграция `0045`): приём (`topic`, а у старых форм — `custom_fields.temat`), правка в карточке, история и «Cofnij». Для всех пресетов, необязательное.
- Карточка лида `real-estate`: блоки «Kontakt», «Zapytanie» (тема, miejscowość, budżet), «Wiadomość» — без полей мероприятия, оферты и договора мероприятия.
- `/dzisiaj` для `real-estate`: «Czekają na odpowiedź», «Zadania na dziś», «Tematy zapytań — ten miesiąc» вместо календаря мероприятий; общие графики притока и источников остаются.
- Сайт `sites/adam` отправляет `topic` явно.
- Эталон M0 `work_queue` обновлён на одну строку (`"topic": null` — новая колонка в данных лида).

**Не сделано (осознанно):** production-организация Адама (нужна отдельная команда владельца); объекты недвижимости — ждут утверждения ADR и хранилища файлов.

## 3. Решение по модели объектов (ADR) — **УТВЕРЖДЕНО владельцем 2026-11-25**

**Контекст.** D-04/D-05: стандартные, массово фильтруемые сущности — типизированные таблицы; динамические `records` — для настраиваемых. Реестра сущностей (M4.1) и `files` (M3.x) на `main` нет.

**Решение (утверждено):**
1. `properties` — типизированная таблица (поля §3.2 ТЗ: публикация и статус продажи раздельно, цена в грошах, slug уникален в организации, приватный адрес отдельно от публичного). RLS, `organization_id`, составные FK `(organization_id, property_id)` для зависимых таблиц.
2. Регистрация в `entity_types/entity_fields` — **после** M4.1, отдельной миграцией без переноса данных. Не строить второй реестр.
3. `property_media` ссылается на общий реестр `files`. **Блокер:** `files` + переключение на `S3Storage` (M3.x) должны появиться раньше; отдельной системы хранения для фото объектов не делаем. Публичная выдача — только через allow-list маршрут `/api/public/sites/{site_key}/properties/{slug}/media/{id}` (D-22: bucket остаётся приватным).
4. Связь заявки с объектом — типизированная `lead_property_interests` (или `record_links`, если M4.2 появится раньше). `custom_fields` для связи не используем.
5. Журнал — `audit_log` (уже есть) для публикации/цены/статуса; отдельный `property_events` не заводим.

**Порядок дальше:** (а) утвердить ADR; (б) `files` + S3 в production (нужны `FILES_S3_*` — действие владельца в Railway); (в) `properties` + UI; (г) публичный API + серверный рендер сайта; (д) связь заявка ↔ объект.

## 4. Риски и откат

- Миграция `0044` только добавляет функции/триггер и заменяет `seed_lead_stages` (новая ветка; старые ветки идентичны). Откат: прежнее тело функции из `0020_agency.sql`, `drop function` трёх новых функций и триггера `invitations_owner_accept_audit`.
- Существующие организации не меняются: воронки засеваются только при создании организации.


## 5. Решения владельца 2026-11-25 и фаза 2

Утверждено: (1) ADR модели объектов (выше), с уточнениями — `lead_property_interests` сразу, без ожидания M4.2; история только в `audit_log`; (2) файловое хранилище — Cloudflare R2, приватный bucket `owo-files-prod`, переменные `FILES_S3_*`, ключ ограничен одним bucket (Object Read & Write); публичная выдача фото — только allow-list маршрут CRM; (3) production-кабинет Адама — через мастер CRM (`real-estate`, связь `client`, отдельный владелец), без связи с Barowo и кабинетом OWO Ads.

**Фактическая нумерация миграций (main + этот пакет):** 0044 real_estate, 0045 lead_topic (применена в production 2026-11-25, лог деплоя «Zastosowano migracji: 1»), **0046 entities (M4.1), 0047 files (M3, часть «файлы»), 0048 properties**. Номера из старого плана (0041 entities, 0044 files, 0045 records) не используются.

**Сделано в пакете фазы 2:**
- M4.1: `entity_types`, `entity_fields`, `record_counters`; регистрация `leads` (у всех) и `properties` (только real-estate) с `storage='table'`; триггер для новых организаций; запись в реестр — только миграциями/функциями (D-07). Не сделано: `roles/role_permissions/can()` (D-16) — отдельная миграция.
- M3 (часть «файлы»): `files` + перенос метаданных из `lead_attachments`, `document_files`, `organization_templates` (sha256 из bytea), синхронизация триггерами. Не сделано: `contacts`, `payments`, `tasks`, `activities` — денежная часть и склейка контактов требуют тестов идентичности до гроша и ручного отчёта склеек (D-11, D-15); отдельный пакет.
- M3.x: `fileContent()` с fallback на bytea; `npm run files:to-s3` (пробный запуск по умолчанию, `--apply` переносит с проверкой sha256/размера, отчёт по организациям). Инструкция: `FILES_R2_RUNBOOK.md`.
- `properties`, `property_media` (только файлы из bucket, JPEG/PNG/WebP по сигнатуре), `lead_property_interests`; публикация и архивация — только owner/admin, публикация требует обложку; аудит цены, статуса, публикации и фото; связь заявки по `property_slug` с опубликованным объектом.
- Не сделано (следующие пакеты): UI «Nieruchomości», публичный API и маршрут фото, серверный рендер сайта.
