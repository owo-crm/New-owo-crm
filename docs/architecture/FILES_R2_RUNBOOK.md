# Cloudflare R2: подключение и перенос файлов (M3.x) — инструкция для владельца

Решение владельца 2026-11-25: провайдер Cloudflare R2, production bucket `owo-files-prod`, приватный.
Код: `lib/platform/files/*`, `scripts/files-to-s3.ts`, миграции `0047_files`, `0048_properties`.

## 0. Что уже сделано в коде

- `files` — общий реестр метаданных (sha256, размер, место хранения). Старые файлы занесены туда с `storage='postgres'`; новые файлы старых таблиц попадают триггером.
- Чтение (вложения лидов, документы, шаблоны договоров, PDF в письмах) идёт через `fileContent()`: если файл уже в bucket — читаем оттуда и сверяем размер; при ошибке и `FILES_FALLBACK_POSTGRES≠false` — отдаём старый bytea и пишем предупреждение.
- `npm run files:to-s3` — перенос: чтение bytea → сверка sha256 → put → head (размер + sha256) → отметка `storage='s3'`. **bytea не удаляется** (очистка — M9, после резервной копии). По умолчанию пробный запуск.
- Фото объектов пишутся сразу в bucket (`org/<org>/<file>`), только JPEG/PNG/WebP по сигнатуре, ≤ 15 МБ.

## 1. Cloudflare (делает владелец)

1. R2 → Create bucket: `owo-files-staging` (для проверки) и `owo-files-prod`. Location — EU (jurisdiction EU, если доступно). **Public access: выключен** (не включать r2.dev и custom domain).
2. R2 → Manage API tokens → Create token: *Object Read & Write*, **Apply to specific buckets only** → отдельный токен на `owo-files-staging` и отдельный на `owo-files-prod`.
3. Запомнить: Account ID (endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), Access Key ID, Secret Access Key (показывается один раз).

## 2. Проверка на staging (до production)

С любого компьютера с Node 22 и копией репозитория:

```bash
FILES_S3_TEST_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
FILES_S3_TEST_BUCKET=owo-files-staging \
FILES_S3_TEST_ACCESS_KEY_ID=... FILES_S3_TEST_SECRET_ACCESS_KEY=... \
npx vitest run tests/db/files-s3.test.ts
```

Ожидается 4 passed: put/head/get/delete и подписанная ссылка; перенос с проверкой sha256; чтение из bucket и fallback; фото объекта. Тест пишет только под `org/<случайный uuid>/` и удаляет за собой.
Дополнительно в браузере: прямой URL объекта без подписи (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com/owo-files-staging/<ключ>`) должен вернуть 400/403.

## 3. Production

Порядок строго такой:

1. Деплой кода с миграциями `0046–0048` (пуш в `main` → Railway применит их при старте). Миграции только добавляют таблицы и функции; `0047` один раз считает sha256 всех существующих файлов (объём сейчас небольшой).
2. Railway → сервис CRM → Variables:
   - `FILES_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `FILES_S3_REGION=auto`
   - `FILES_S3_BUCKET=owo-files-prod`
   - `FILES_S3_ACCESS_KEY_ID=…` / `FILES_S3_SECRET_ACCESS_KEY=…` (токен prod-bucket)
   - `FILES_FALLBACK_POSTGRES` — не задавать (по умолчанию fallback включён).
3. **Резервная копия БД** (Railway → Postgres → Backups → Create).
4. Пробный перенос (ничего не пишет):
   `railway run npm run files:to-s3` → в отчёте `failed: []`, `scanned` = числу файлов.
5. Перенос: `railway run npm run files:to-s3 -- --apply`. Проверить в отчёте: `failed: []`, по каждой организации `in_postgres: 0`, `checksum` такой же, как в пробном запуске.
6. Открыть в CRM вложение лида, документ PDF и шаблон договора — скачиваются.
7. Повторный запуск `--apply` безопасен (переносит только новые файлы). Новые вложения/документы пока пишутся в bytea и переносятся следующим запуском — переключение записи на bucket — отдельный шаг.
8. Удаление bytea — только миграцией M9 после ещё одной резервной копии и проверки.

Откат: убрать `FILES_S3_*` из Railway — чтение файлов, уже отмеченных как `s3`, перейдёт на fallback (bytea на месте). Полный откат метки: `update public.files set storage='postgres', storage_key='pg:'||source_table||':'||source_id, migrated_at=null where storage='s3' and source_table is not null;`
