# Cloudflare R2: подключение и перенос файлов (M3.x) — инструкция для владельца

Решение владельца 2026-11-25: провайдер Cloudflare R2, production bucket `owo-files-prod`, приватный.
Код: `lib/platform/files/*`, `scripts/files-to-s3.ts`, миграции `0047_files`, `0048_properties`, `0049_template_files_media_audit`.

## 0. Что уже сделано в коде

- `files` — общий реестр метаданных (sha256, размер, место хранения). Старые файлы занесены туда с `storage='postgres'`; новые файлы старых таблиц попадают триггером.
- Источники bytea: `lead_attachments`, `document_files`, `organization_templates`, `template_files` (PDF шаблонов чата, с 0049).
- Чтение (вложения лидов, документы, шаблоны договоров, PDF в письмах и PDF шаблонов чата) идёт через `fileContent()`: если файл уже в bucket — читаем оттуда и сверяем размер; при ошибке и `FILES_FALLBACK_POSTGRES≠false` — отдаём старый bytea и пишем предупреждение.
- `npm run files:to-s3` — перенос: чтение bytea → сверка sha256 → put → head (размер + sha256) → отметка `storage='s3'`. **bytea не удаляется** (очистка — M9, после резервной копии). По умолчанию пробный запуск.
- Фото объектов пишутся сразу в bucket (`org/<org>/<file>`), только JPEG/PNG/WebP по сигнатуре, ≤ 15 МБ.

## 1. Cloudflare (делает владелец)

1. R2 → Create bucket: `owo-files-staging` (для проверки) и `owo-files-prod`. Location — EU (jurisdiction EU, если доступно). **Public access: выключен** (не включать r2.dev и custom domain).
2. R2 → Manage API tokens → Create token: *Object Read & Write*, **Apply to specific buckets only** → отдельный токен на `owo-files-staging` и отдельный на `owo-files-prod`.
3. Запомнить: Account ID (endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), Access Key ID, Secret Access Key (показывается один раз).

## 2. Проверка на staging — ОБЯЗАТЕЛЬНОЕ условие до production-переноса

Без успешного выполнения обоих пунктов ниже шаги 3.4–3.9 не начинать.

1. Автотест на staging-бакете (с любого компьютера с Node 22 и копией репозитория):

   ```bash
   FILES_S3_TEST_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
   FILES_S3_TEST_BUCKET=owo-files-staging \
   FILES_S3_TEST_ACCESS_KEY_ID=... FILES_S3_TEST_SECRET_ACCESS_KEY=... \
   npx vitest run tests/db/files-s3.test.ts
   ```

   Ожидается 4 passed: put/head/get/delete и подписанная ссылка; перенос с проверкой sha256; чтение из bucket и fallback; фото объекта. Тест пишет только под `org/<случайный uuid>/` и удаляет за собой.
2. **Прямой URL без подписи должен быть отклонён.** Загрузить любой файл в `owo-files-staging` и открыть `https://<ACCOUNT_ID>.r2.cloudflarestorage.com/owo-files-staging/<ключ>` без параметров подписи — ожидается отказ (400/401/403), а не содержимое файла. Если файл открылся — bucket не приватный: остановиться и исправить настройки.

## 3. Production — строго по порядку

| # | Шаг | Готово, когда |
|---|---|---|
| 1 | **Резервная копия БД** (Railway → Postgres → Backups → Create) | бэкап виден в списке |
| 2 | **Слияние рабочей ветки в `main`.** Railway собирает и при старте применяет миграции `0046–0049` | деплой в статусе SUCCESS |
| 3 | **Проверка миграций:** в логах деплоя `Zastosowano migracji: 4`; в базе `select count(*) from public.files` > 0 и есть таблицы `entity_types`, `properties` | обе проверки сошлись; приложение открывается, вложения лидов скачиваются (пока из БД) |
| 4 | **Конфигурация хранилища:** в Railway заданы `FILES_S3_ENDPOINT`, `FILES_S3_REGION=auto`, `FILES_S3_BUCKET=owo-files-prod`, `FILES_S3_ACCESS_KEY_ID`, `FILES_S3_SECRET_ACCESS_KEY` (токен только на prod-bucket, Object Read & Write); `FILES_FALLBACK_POSTGRES` не задан. Сервис перезапущен | `railway run node -e "…"` не нужен — проверка в шаге 6 |
| 5 | **Повторная резервная копия БД** непосредственно перед переносом | второй бэкап виден в списке |
| 6 | **Dry-run:** `railway run npm run files:to-s3` | в отчёте `dryRun: true`, `failed: []`, `scanned` = числу файлов; сохранить `checksum` по каждой организации |
| 7 | **Перенос:** `railway run npm run files:to-s3 -- --apply` | `failed: []` |
| 8 | **Проверка отчёта по каждой организации:** `in_postgres: 0`, `total` и `checksum` совпадают с dry-run; выборочно скачать в CRM вложение лида, сгенерированный PDF, шаблон договора и PDF шаблона чата | всё скачивается, содержимое верное |
| 9 | **Только после шага 8** перенос считается завершённым | — |

Замечания:
- Повторный `--apply` безопасен (переносит только оставшиеся файлы). Новые вложения/документы пока пишутся в bytea и переносятся следующим запуском — переключение записи на bucket отдельным шагом.
- bytea не удаляется; очистка — только миграцией M9 после ещё одной резервной копии и проверки.

Откат: убрать `FILES_S3_*` из Railway — чтение файлов, отмеченных как `s3`, перейдёт на fallback (bytea на месте). Полный откат метки: `update public.files set storage='postgres', storage_key='pg:'||source_table||':'||source_id, migrated_at=null where storage='s3' and source_table is not null;`
