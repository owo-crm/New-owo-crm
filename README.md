# OWO CRM

CRM для Barowo и клиентов OWO Ads: заявки с сайта, мгновенные уведомления (Telegram, push, e-mail), карточки лидов, этапы, сезон суббот.
**Монолит:** одно приложение Next.js + одна база Postgres. Код на GitHub, работает на Railway. Без Google Sheets, Apps Script и Supabase (решение 017 в `docs/decisions.md`).

## Как устроено

```
 Сайт клиента ──POST /api/intake/<ключ канала>──┐
 Telegram ─────POST /api/telegram───────────────┤
                                                ▼
                     Next.js (Railway, 1 сервис)
                     ├─ интерфейс: /dzisiaj /leady /leady/[id] /ustawienia
                     ├─ /api/live (SSE) — список лидов обновляется сам
                     └─ воркер раз в минуту: напоминания 15 мин / 2 ч, повторы
                                                │
                                                ▼
                     Postgres (Railway) — db/migrations/*.sql
                     RLS: каждая фирма видит только свои данные
```

| Папка | Что там |
|---|---|
| `app/` | страницы и API |
| `lib/db/` | подключение к базе, `withOrg()` (запрос от имени пользователя), мигратор, LISTEN |
| `lib/auth/` | вход, сессии, сброс пароля |
| `lib/leads/`, `lib/channels/` | лиды, приём заявок |
| `lib/notify/` | Telegram, push, e-mail, очередь, воркер |
| `db/migrations/` | схема базы. **Только добавлять новые файлы, старые не менять** |
| `scripts/` | `migrate`, `create-user`, импорт истории из CSV |

## Локальный запуск

Нужны Node 22 и Postgres 16 (например, Postgres.app на Mac).

```bash
npm install
cp .env.example .env.local            # впиши DATABASE_URL и INTAKE_IP_SALT
npm run db:migrate
USER_PASSWORD='минимум-10-знаков' npm run user:create -- --email ivan@barowo.com --name "Ivan" --org "Barowo"
npm run dev                           # http://localhost:3000
```

Проверки: `npm run check` (линтер + типы + 160 тестов), `npm run build`, `npm run test:e2e` (нужна **отдельная** тестовая база в `DATABASE_URL` — тест её очищает).

## Деплой на Railway (один раз)

1. Создай приватный репозиторий на GitHub и загрузи код (`git push`).
2. railway.com → **New Project → Deploy from GitHub repo** → выбери репозиторий.
3. В проекте: **+ Create → Database → PostgreSQL**.
4. Сервис приложения → **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `INTAKE_IP_SALT` = случайная строка (`openssl rand -hex 32`)
   - `NEXT_PUBLIC_SITE_URL` и `SITE_URL` = адрес приложения, например `https://crm.owoads.pl`
   - остальное — по `.env.example`, когда понадобится (Telegram, push, Resend)
5. **Settings → Networking → Generate Domain** (или свой домен).
   Сборка идёт по `Dockerfile` (Node 22 + LibreOffice для PDF договоров), часовой пояс контейнера — Europe/Warsaw.
6. Деплой идёт сам при каждом push в `main`. При старте `npm start` сначала применяет новые миграции, потом запускает приложение. Проверка живости — `/api/health`.
7. Первый пользователь: в Railway у Postgres → **Connect** скопируй публичный URL и на своём компьютере запусти
   `DATABASE_URL='...' USER_PASSWORD='...' npm run user:create -- --email ... --name ... --org "Barowo"`.

Реплика приложения — **ровно одна** (воркер и live-обновления живут в процессе).
Бэкапы: у Railway Postgres включи Backups (платный план) или делай `pg_dump` по расписанию.

## Подключение формы сайта

1. Создай канал (пока SQL, экран настроек — следующий шаг):
   ```sql
   insert into public.channels (organization_id, type, name, config)
   values ('<id фирмы>', 'website', 'Strona barowo.com', '{"allowedOrigins":["https://barowo.com"]}')
   returning public_key;
   ```
2. Форма шлёт `POST https://<crm>/api/intake/<public_key>` (JSON или form-data). Поля: `name`, `phone`, `email`, `event_type`, `event_date` (ГГГГ-ММ-ДД), `city`, `venue`, `guests`, `message`, `consent` (обязательно), `utm_*`, `page_url`, `referrer`. Скрытое поле-ловушка `website` должно быть пустым.
3. Защита от дублей: поле `submission_id` или заголовок `Idempotency-Key` — повтор той же заявки вернёт `ok`, но второго лида не создаст.
4. Лимит: 10 заявок в час с одного IP. Ответы: `200 ok`, `403` чужой домен, `422` нет согласия/данных, `429` лимит.

## Документы Barowo (оферта, меню, договор)

В карточке лида → блок **Dokumenty**: оферта Simple / Standard / Premium, меню для гостей, договор. Каждый документ — PDF + Word, хранится в базе, скачивается только после входа.

- Оферта и меню — оригинальный код бота v48 (`lib/documents/barowo/legacy/*.gs`), выполняется как есть: тот же дизайн, шрифты, каталог и цены.
- Договор — Word-шаблон `lib/documents/barowo/umowa-template.docx` с полями `{{UMOWA_NR}} {{TODAY}} {{EVENT_DATE}} {{CITY}} {{ZLECENIODAWCA}} {{ADDRESS}} {{GUESTS}} {{PRICE}} {{BALANCE}}` (доступны также `{{DEPOSIT}} {{DEPOSIT_DATE}} {{HOURS}} {{PACKAGE}} {{EXTRA_HOUR}} {{PENALTY}}`). PDF делает LibreOffice внутри контейнера. Чтобы изменить договор — правь этот .docx в Word, поля вписывай целиком.
- Включить для фирмы: `update public.organizations set document_engine='barowo', email='barowo.pl@gmail.com', phone='+48 889 168 003' where slug='barowo';` (email/телефон печатаются в подвале оферты).
- **Продолжить нумерацию из бота** (значения `umowa_counter`, `oferta_counter`, `menu_counter` из Script Properties):
  ```sql
  insert into public.document_counters (organization_id, kind, last_value)
  select id, k, v from public.organizations, (values ('contract', 0), ('offer', 0), ('menu', 0)) c(k, v)
  where slug = 'barowo'
  on conflict (organization_id, kind) do update set last_value = excluded.last_value;
  ```
  (вместо нулей — числа из бота; следующий документ получит +1).

## Telegram (уведомления + кнопки)

1. Создай бота у @BotFather → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`.
2. `TELEGRAM_WEBHOOK_SECRET` = случайная строка; `OUTBOUND_NOTIFICATIONS_ENABLED=true`.
3. Зарегистрируй вебхук (один раз):
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<crm>/api/telegram&secret_token=<SECRET>"`
4. В CRM: **Ustawienia → Powiadomienia → Połącz Telegram** — каждый член команды привязывает свой аккаунт.

Старый бот на Apps Script продолжает работать, пока новый не проверен; потом его вебхук переключается на этот адрес.

## Что дальше

См. `PROGRESS.md` → «Следующий шаг».
