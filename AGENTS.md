# AGENTS.md — правила для ИИ-агентов (Codex, Claude)

Этот файл читается автоматически в начале каждой сессии. Соблюдать всегда.

## Проект

Веб-CRM OWO (монолит Next.js + Postgres, деплой GitHub → Railway, решение 017) для фирм, продающих услуги на дату мероприятия (свадьбы, праздники, корпоративы). Первый клиент — Barowo (мобильный бар, Гдыня). Главные функции: генерация договоров (3+ дизайна) и оферт (3+ стиля), мгновенные уведомления о лидах, подключение каналов заявок.

Владелец — Иван. Опыт программирования небольшой: объясняй просто, без жаргона, на **русском**.

## Начало каждой сессии (обязательно, по порядку)

1. Прочитать `PROGRESS.md` — последняя запись и «Следующий шаг».
2. Прочитать `docs/03-roadmap.md` — найти первую задачу `[ ]`.
3. Прочитать документ, который относится к задаче (`docs/0X-*.md`).
4. `git status` и `git log --oneline -10` — убедиться, что нет чужих незакоммиченных изменений. Если есть — не удалять, разобраться и записать в PROGRESS.
5. Если в `PROGRESS.md` есть «⚠️ Незакончено» — сначала доделать это.

## Как работать

- **Одна задача из roadmap = один коммит.** Большую задачу дробить на подзадачи (2.4a, 2.4b) и вписывать их в roadmap.
- **После КАЖДОЙ завершённой задачи** (а не в конце сессии): `npm run check` → коммит → `[x]` в roadmap → запись в `PROGRESS.md`. Лимит может закончиться в любой момент — состояние всегда должно быть сохранено.
- Если задача не закончена, а контекст/лимит заканчивается: закоммить WIP (`wip: ...`), в `PROGRESS.md` раздел «⚠️ Незакончено» — что сделано, что осталось, какие файлы.
- Новое архитектурное решение → запись в `docs/decisions.md`.
- Изменение схемы БД → новая миграция в `db/migrations/` (старые не менять!) + обновить `docs/02-data-model.md`. Никаких Google Sheets/Apps Script.
- Принимай разумные решения сам. Спрашивай Ивана только о том, что нельзя отменить или что меняет продукт.

## Запрещено

- Трогать что-либо вне папки `crm-web/` (особенно `../crm-system/apps-script/` — это рабочий CRM Barowo, и `../current-site/`, `../source-and-history/` — сайт).
- Деплоить в production, менять DNS, отправлять реальные письма/SMS/Telegram клиентам, push в чужие ветки, `git push --force`, `git reset --hard`, удалять историю.
- Коммитить секреты. Только `.env.example` без значений.
- Импортировать `lib/db` в клиентские компоненты (`"use client"`). Данные пользователя — только через `withOrg()` (RLS).
- Таблица без RLS или без `organization_id`.
- Отправлять что-либо внешнему адресату без явного подтверждения пользователя в интерфейсе.
- Придумывать отзывы, цифры, юридические гарантии в шаблонах.
- Упоминать алкоголь в письмах клиентам (правило Barowo).

## Стандарты

- TypeScript strict, без `any` (кроме обоснованных мест с комментарием).
- Бизнес-логика — в `lib/`, у неё есть юнит-тесты (Vitest).
- Тексты интерфейса — только польские, только через `messages/pl.json`.
- Деньги — в грошах (`integer`). Даты мероприятий — `date`. Время — `timestamptz`, часовой пояс `Europe/Warsaw`.
- Мобильная вёрстка проверяется на 390 px, десктоп — 1440 px. После UI-изменений — скриншот Playwright в `tests/screenshots/` и визуальная проверка.
- Документы (PDF/DOCX) проверяются: польские буквы ąęłńóśźż, эмодзи, длинные имена.

## Скиллы

- `.agents/skills/` — инструкции для агентов (Codex читает отсюда; Claude — по ссылке из этого файла).
- **Перед любой работой с интерфейсом** прочитай `.agents/skills/frontend-design/SKILL.md` и раздел «Визуальный стиль» в `docs/07-ux.md` + решение 011 в `docs/decisions.md`. Не меняй дизайн-токены (`app/globals.css`) без записи в decisions.
- **Дизайн-скиллы (редизайн, решение 024)** — в `.agents/skills/` и `.claude/skills/`: `frontend-design`, `canvas-design` (anthropics); `emil-design-eng`, `review-animations`, `improve-animations`, `remove-animations` (emilkowalski); `better-ui`, `better-interface`, `better-layout`, `better-typography`, `better-colors`, `better-accessibility`, `better-writing`, `interface-review`, `state-machine`, `variant` (jakubkrehel); `minimal`, `clean` (bergside); `no-ai-design-slop`, `audit-ai-design-slop`, `design-first-ui-prompting` (MengTo); `information-architecture`, `navigation-patterns`, `form-design`, `visual-hierarchy`, `spacing-system`, `typography-scale`, `color-system`, `dark-mode-design`, `loading-states`, `error-handling-ux`, `heuristic-evaluation`, `critique-information-density` (Owl-Listener). Перед любой UI-работой читать `frontend-design`, `no-ai-design-slop`, `better-ui`.
- Новые скиллы ставить командой `npx skills add <repo> -a codex -a claude-code` (CLI vercel-labs/skills) в папку проекта и записывать сюда.

## Команды

- `npm run dev` — запуск; `npm run check` — линтер + типы + все тесты; `npm run build`; `npm run test:e2e` — Playwright (переменная `PW_CHROMIUM_PATH`, если браузер Playwright не скачивается).
- Тесты базы: `tests/db/` (PGlite, без Docker). Новая таблица → миграция + проверки изоляции фирм в `tests/db/rls.test.ts`.
- Скриншоты для визуальной проверки сохраняются в `tests/screenshots/` (в git не попадают).

## Definition of Done (задача готова, когда)

- [ ] `npm run check` зелёный (lint + typecheck + тесты);
- [ ] новая логика покрыта тестом;
- [ ] UI проверен на телефоне и десктопе (скриншот);
- [ ] документация обновлена (если менялось поведение/схема);
- [ ] коммит сделан, roadmap и `PROGRESS.md` обновлены.

## Документация

| Файл | О чём |
|---|---|
| `docs/00-product.md` | для кого продукт, сегменты, фишки, цены |
| `docs/01-architecture.md` | стек, структура, окружения |
| `docs/02-data-model.md` | таблицы, RLS |
| `docs/03-roadmap.md` | **план и прогресс** |
| `docs/04-documents-engine.md` | договоры и оферты |
| `docs/05-lead-channels.md` | каналы заявок |
| `docs/06-notifications.md` | уведомления |
| `docs/07-ux.md` | экраны и принципы интерфейса |
| `docs/08-security-rodo.md` | безопасность, RODO |
| `docs/09-migration.md` | перенос с Apps Script v39 |
| `docs/decisions.md` | журнал решений |
| `PROGRESS.md` | журнал сессий |

## Next.js (версия 16 — отличается от старых знаний)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
