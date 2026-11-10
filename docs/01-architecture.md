> ⚠️ С 2026-11-10 действует решение **017** (`docs/decisions.md`): монолит Next.js + Postgres на Railway. Упоминания Supabase, Edge Functions, Cloud Run и pg_cron ниже — история прототипа. Актуальная схема — в `README.md`.

# 01 — Архитектура

## Стек (решения зафиксированы в `docs/decisions.md`)

| Слой | Технология | Зачем |
|---|---|---|
| Веб-приложение | **Next.js 16 (App Router) + TypeScript (strict)** | одно приложение: интерфейс + API |
| UI | **Tailwind CSS + shadcn/ui**, иконки lucide | быстро, аккуратно, легко менять |
| База, логины, файлы | **Supabase** (Postgres, Auth, Storage, Realtime), регион **EU (Frankfurt)** | логины/пароли из коробки, RLS для разделения фирм, RODO |
| Хостинг | **Google Cloud Run** (регион `europe-west1`, бесплатный уровень), Docker-контейнер с Next.js и Chromium | 0 zł на старте, коммерческое использование разрешено, масштаб до нуля |
| Приём заявок и уведомления | **Supabase Edge Functions** (`intake`, `notify`) | всегда быстро отвечают, не зависят от «холодного старта» Cloud Run |
| Валидация | **zod** | одна схема для форм и API |
| PDF | HTML-шаблон → **Chromium** (`puppeteer-core`, Chromium внутри того же контейнера Cloud Run) | точные шрифты и дизайн |
| Word | библиотека **`docx`** (npm) из той же модели документа | редактируемый .docx |
| E-mail | **Resend** (домен `barowo.com`, `reply-to` = почта фирмы-клиента) | отправка оферт и уведомлений |
| Входящая почта | Postmark Inbound (или Cloudflare Email Workers) | заявки с порталов по e-mail |
| Telegram | **grammY**, webhook на `/api/telegram` | уведомления и быстрые действия |
| Push | **web-push** + VAPID, PWA (manifest + service worker) | уведомления на телефон без приложения из стора |
| Фоновые задачи | таблица `jobs` + `pg_cron` в Supabase (раз в минуту вызывает Edge Function) | ретраи уведомлений, напоминания |
| Оплата подписки | на старте — счёт и перевод вручную; **Stripe Billing** — после ~10 клиентов | без абонплаты, только % с платежа |
| ИИ (опционально) | Claude API | разбор договора клиента в шаблон, разбор писем с порталов |
| Тесты | **Vitest** (логика), **Playwright** (e2e) | |
| Ошибки | Sentry (бесплатный план) | |

## Схема

```
 Сайт фирмы / Meta / Google Ads / e-mail / вебхук / ручной ввод
                         │
                         ▼
              Supabase Edge Function `intake`     ← проверка, антиспам, нормализация
                         │
                         ▼
          Supabase Postgres: leads + lead_events   ← RLS по organization_id
                         │
          ┌──────────────┼───────────────────┐
          ▼              ▼                   ▼
   Telegram (grammY)  Web Push (PWA)     E-mail (Resend)     ← < 5 c
                         │
                         ▼
           Веб-интерфейс app.barowo.com (Next.js)
           ├─ Leady / Karta leada
           ├─ Oferty  ─┐
           ├─ Umowy   ─┼─► Document engine → HTML → PDF (Chromium) + DOCX (docx)
           └─ Ustawienia ┘                     → Supabase Storage (приватно, signed URL)
```

## Структура репозитория

```
crm-web/
├─ AGENTS.md              ← правила для Codex/Claude (читается автоматически)
├─ MASTER_PROMPT.md       ← промт для вставки в новый чат
├─ PROGRESS.md            ← журнал сессий и «следующий шаг»
├─ docs/                  ← вся документация
├─ app/                   ← Next.js routes
│  ├─ (auth)/logowanie, rejestracja, reset-hasla, nowe-haslo, firma
│  ├─ (app)/dzisiaj, leady, leady/[id], dokumenty, kalendarz, ustawienia/...
│  ├─ o/[token]/          ← публичная онлайн-оферта (без логина)
│  └─ api/telegram, api/webhooks/*, api/documents/*
├─ supabase/functions/    ← Edge Functions: intake, notify, cron-jobs
├─ components/            ← UI (shadcn) и составные компоненты
├─ lib/
│  ├─ db/                 ← клиенты Supabase, запросы
│  ├─ leads/              ← нормализация, дедупликация, статусы
│  ├─ documents/          ← модель документа, рендер, дизайны, нумерация
│  │  └─ designs/{contract,offer}/<design-id>/
│  ├─ channels/           ← адаптеры: website, meta, google, email, webhook
│  ├─ notify/             ← telegram, push, email, sms
│  └─ presets/            ← отраслевые пресеты (mobile-bar, photo, dj ...)
├─ supabase/migrations/   ← SQL миграции (единственный источник схемы)
├─ messages/pl.json       ← все тексты интерфейса на польском
└─ tests/
```

## Окружения

| Окружение | Где | Данные |
|---|---|---|
| local | `npm run dev` + `supabase start` (Docker) | тестовые (seed) |
| staging | отдельный сервис Cloud Run `crm-staging` | отдельный Supabase-проект `staging` |
| production | `app.barowo.com` | Supabase-проект `prod` |

Секреты — только в `.env.local` и в Secret Manager / переменных Cloud Run. В репозитории — `.env.example` без значений.

## Принципы кода

- Вся бизнес-логика в `lib/`, страницы тонкие.
- Каждая таблица имеет `organization_id`, каждый запрос идёт через RLS. `service_role` ключ — только на сервере (intake, webhooks, cron).
- Все тексты интерфейса — польские, из `messages/pl.json`. Код, имена, коммиты — английские. Документация — русская.
- Деньги хранятся в грошах (`integer`), даты мероприятия — `date`, время — `timestamptz`.
- Любое внешнее действие (письмо клиенту, SMS) — только после явного подтверждения пользователем (как в боте v39).
