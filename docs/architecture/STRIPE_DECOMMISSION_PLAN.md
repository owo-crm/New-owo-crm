# Отказ от Stripe и встроенного приёма платежей — аудит, план и выполнение

> Решение владельца (2026-11-18): отказаться от Stripe и приёма платежей внутри платформы.
> **Статус (2026-11-19):** решение окончательное (полное удаление, не временное отключение).
> S3 + S4 выполнены в ветке `claude/new-session-pojyef` и **влиты в main только после подтверждения
> владельцем S2** (иначе живые подписки Stripe продолжили бы списывать деньги без записи в CRM).
> Данные, таблицы и миграции не менялись.

## 0. Что важно понять сразу
**[Факт]** Без `STRIPE_SECRET_KEY` биллинг уже работает в «локальном» режиме:
`stripeConfig()` возвращает `null` (`lib/billing/stripe.ts:21`), `syncSubscription()` только
пересчитывает сумму абонемента и места и пишет их в `organization_billing`, ничего не отправляя
(`lib/billing/sync.ts:179–196`, `mode: "local"`); вебхук без `STRIPE_WEBHOOK_SECRET` отвечает 503 и
ничего не обрабатывает (`app/api/stripe/webhook/route.ts`); кнопки Checkout/портала возвращают
«Stripe wyłączony». Поэтому **первый безопасный шаг отключения — убрать ключи Stripe в Railway**:
это обратимо и не трогает ни код, ни данные.

**Не путать:** `lead_payments` (графики предоплат клиентов CRM, например гостей Barowo, «Płatności»
в карточке лида и Statystyka) — это **ручной учёт**, а не приём платежей. Stripe его не касается,
он остаётся (контур 1, D-09).

## 1. Инвентаризация

| Компонент | Файл / объект | Что делает |
|---|---|---|
| Клиент Stripe API | `lib/billing/stripe.ts` | запросы, подпись вебхука, `STRIPE_*` |
| Синхронизация подписки | `lib/billing/sync.ts` (`syncSubscription`, Stripe-часть) | обновляет строки подписки в Stripe |
| Checkout / портал | `lib/billing/sync.ts` (`createCheckoutLink`, `createPortalLink`), `lib/billing/actions.ts` (`checkoutLinkAction`, `openPortalAction`) | ссылка первой оплаты, портал клиента |
| Вебхук | `app/api/stripe/webhook/route.ts` → `handleStripeEvent` | статус подписки, `invoice.paid` → `recordInvoice` |
| Заказ из оплаты | `recordInvoice()` (`lib/billing/sync.ts:427`) | оплаченный заказ агентства «CRM (abonament)» + комиссия Stripe как прямой расход |
| Пересчёт абонемента | `lib/billing/service.ts` `resyncBilling` (из `lib/team/actions.ts`, `saveSubscriptionAction`) | сумма, места; без ключа — локально |
| Модули | `organization_modules`, `set_organization_modules`, `lib/billing/modules.ts`, `gate.ts`, `module_requests` | какие разделы видит бизнес, экран «Poproś o moduł» |
| Цена | `lib/billing/pricing.ts`, `components/billing/price-table.tsx` | расчёт абонемента по модулям и местам |
| Таблицы | `organization_billing` (stripe_customer/subscription_id, status, monthly_net, seats, discount, ad_client), `billing_events` (журнал вебхуков), `agency_orders.stripe_invoice_id` | |
| Интерфейс | `/ustawienia/abonament` (`PortalButton`), карточка клиента агентства (`subscription-panel.tsx`: модули, скидка, «Link do płatności») | |
| Отчёты агентства | `agency_summary` — источник «Abonament CRM», если у заказа есть `stripe_invoice_id` (`0025:180`) | |
| Тесты | `tests/unit/billing-stripe.test.ts`, `tests/db/billing-sync.test.ts`, части `tests/db/billing.test.ts` | |
| Переменные Railway | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_TAX_RATE_ID`, `STRIPE_AUTOMATIC_TAX` | наличие в Railway не проверялось (значения сессия не читает) |
| Фоновые задачи | — | отдельной фоновой задачи Stripe нет (только вебхук и пересчёт при действиях) |

## 2. Классификация

### 2.1 Больше не нужно (удаляется после утверждения)
- Клиент Stripe API, Checkout, портал, вебхук, `handleStripeEvent`, `recordInvoice`.
- Stripe-часть `syncSubscription` (локальный пересчёт остаётся).
- Кнопки «Link do płatności» (карточка клиента агентства) и портала («Ustawienia → Abonament»),
  тексты Stripe в `messages/pl.json`.
- Переменные `STRIPE_*` в Railway и вебхук в панели Stripe.
- Тесты Stripe (`billing-stripe`, Stripe-сценарии `billing-sync`) — вместе с кодом.

### 2.2 Исторические данные — сохранить без изменений
- `billing_events` — журнал полученных событий (таблица остаётся, перестаёт пополняться).
- `organization_billing.stripe_customer_id`, `stripe_subscription_id`, `status`, `synced_at`, `last_error`.
- `agency_orders` с `stripe_invoice_id`, их прямые расходы (комиссия Stripe), участие в разделе
  10/25/65 и выплатах — **неизменны** (закрытые периоды не переписываются).
- Колонка `agency_orders.stripe_invoice_id` и уникальный индекс — остаются (на них опирается
  история и источник «Abonament CRM» в `agency_summary`).

### 2.3 Нужно OWO Ads для внутреннего учёта — остаётся и работает без Stripe
- Модули бизнеса (`organization_modules`, `set_organization_modules`, `moduleAccess`, «Poproś o moduł»).
- Расчёт стоимости абонемента (`pricing.ts`), места (`billable_seats`), скидка, «klient reklamy» —
  как ориентир цены для договора/фактуры вне системы.
- `organization_billing.monthly_net_grosze`, `billed_seats`, `discount_bp`, `ad_client`, `billing_email`.
- Услуга «CRM (abonament)» (`agency_services.system_key = 'crm'`): заказы абонемента теперь вносятся
  **вручную** (как любой заказ) или кнопкой «Powtórz abonamenty z poprzedniego miesiąca»
  (`agency_repeat_retainers`) — 65 % по-прежнему ответственному за услугу.
- Весь финансовый учёт агентства (`agency_*`, раздел, фонд, выплаты) — без изменений.
- `lead_payments` — учёт платежей клиентов CRM.

### 2.4 Нельзя удалять без отдельного решения
- Таблицы `billing_events`, `organization_billing`, колонку `stripe_invoice_id`.
- Логику источника «Abonament CRM» в `agency_summary` (иначе изменятся прошлые отчёты агентства).
- Статус подписки `organization_billing.status` (сейчас нигде не блокирует доступ — **[Факт]**
  проверок статуса в `moduleAccess` нет; сохранить как историю).
- Системную услугу `crm` и прошлые заказы по ней.
- Заказы Barowo (см. M1.5).

## 3. План отключения (каждый шаг — после утверждения)
| Шаг | Действие | Обратимость | Проверка |
|---|---|---|---|
| S1 | Снять отчёт: `billing_events` (типы, даты), `organization_billing` (статусы, наличие customer/subscription), заказы с `stripe_invoice_id` по организациям и месяцам — входит в отчёт M1.2 и финансовый отчёт Barowo | только чтение | отчёт сохранён в `docs/architecture/reports/` |
| S2 | В панели Stripe отменить активные подписки (если есть) и отключить вебхук; в Railway удалить `STRIPE_*` | обратимо (вернуть ключи) | логи: вебхук 503, «Abonament» показывает сумму без Stripe; golden M0 без изменений |
| S3 | Убрать из интерфейса кнопки Checkout и портала, тексты Stripe | обратимо (git revert) | e2e агентства и настроек |
| S4 | Удалить код Stripe (клиент, вебхук, `handleStripeEvent`, `recordInvoice`, Checkout/портал, Stripe-часть `syncSubscription`) и их тесты; `resyncBilling` → только локальный пересчёт | обратимо (git revert), данные не затрагиваются | `npm run check`, golden M0 (сводка агентства не меняется), тесты модулей и абонемента |
| S5 | Документировать ручной процесс абонемента: заказ «CRM (abonament)» вручную / «Powtórz abonamenty», фактура вне системы | — | — |
| S6 | (Отдельное решение, не раньше M9) судьба `billing_events` и Stripe-колонок — архив или оставить | необратимо | — |

**Миграции БД не нужны** для S1–S5: таблицы и колонки остаются.

## 4. Влияние на M1
- **M1.4 «Stripe webhook и заказы CRM (abonament)» отменяется**: вместо изменения `recordInvoice`
  код удаляется в S4. До S2 риск остаётся: если ключи Stripe в Railway есть и придёт оплата,
  `recordInvoice` создаст заказ агентства для любой организации со строкой `agency_clients`
  (включая Barowo). Поэтому **S2 рекомендуется выполнить до M1.3**.
- Критерии `client` больше не используют Stripe (D-02, пересмотр).
- Финансовый отчёт Barowo (до M1.5) по-прежнему нужен: прошлые заказы могли прийти из Stripe.


## 5. Выполнение

### S2 — внешние действия (выполняет владелец, сессия секреты и Stripe не трогает)
1. Stripe Dashboard → **Billing → Subscriptions**: фильтр «Active / Trialing / Past due». Для каждой
   подписки — **Cancel subscription** (рекомендуется «immediately» и без автоматического возврата;
   спорные возвраты — вручную). Записать список отменённых (id клиента, сумма) — для истории.
2. Stripe Dashboard → **Developers → Webhooks** → endpoint `…/api/stripe/webhook` → **Disable** или
   **Delete**.
3. Railway → проект → сервис `crm` → **Variables**: удалить `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `STRIPE_TAX_RATE_ID`, `STRIPE_AUTOMATIC_TAX` (какие есть).
4. Railway → сервис `crm` → **Restart / Redeploy**.
5. Сообщить «S2 выполнен» — после этого ветка с S3+S4 вливается в main.

### S3 + S4 — удаление из приложения (сделано в ветке, ждёт S2)
**Удалённые файлы:** `lib/billing/stripe.ts` (клиент API, подпись вебхука), `app/api/stripe/webhook/route.ts`,
`components/billing/portal-button.tsx`, `tests/unit/billing-stripe.test.ts`.
**Удалено из кода:** `handleStripeEvent`, `recordInvoice` (создание заказов агентства из оплат),
`createCheckoutLink`, `createPortalLink`, продукты/клиенты/строки подписки Stripe, Stripe-часть
`syncSubscription`; Server Actions `checkoutLinkAction`, `openPortalAction`; кнопки «Link do pierwszej
płatności» и портала; статус подписки Stripe и «Stripe: ошибка» в интерфейсе; тексты `billing.status.*`,
`billing.invoice`, `billing.agency.checkout*/copy*/stripeOff/saved`, `billing.settings.notConnected/status/manage`;
`STRIPE_*` в `.env.example`. Зависимостей npm Stripe не было (собственный клиент).
**Сохранено:** модули (`organization_modules`, `set_organization_modules`, `moduleAccess`/`gate.ts`,
«Poproś o moduł»), расчёт абонемента (`pricing.ts`, места, скидка, «klient reklamy»),
`organization_billing` как локальный учёт, `syncSubscription` (только локальный пересчёт), мастер
«Utwórz CRM klienta» и автоматический `client` у новых бизнесов, весь учёт агентства, `lead_payments`.
**Новые тексты:** «Abonament» — сумма по модулям и людям, фактура и оплата вне системы; в карточке
клиента агентства — подсказка добавить заказ «CRM (abonament)» вручную или «Powtórz abonamenty».
**Проверки:** `tests/db/billing-sync.test.ts` (переписан): локальный пересчёт без Stripe и без
изменения истории; места и скидка; ручной заказ CRM → 65 % ответственному; «Powtórz abonamenty»;
старый заказ Stripe виден в сводке как «Abonament CRM» с комиссией; пересчёт не создаёт заказов.
`tests/unit/no-stripe.test.ts`: нет вебхука, клиента, портала, Checkout и `STRIPE_*` в коде.
`npm run check` — 51 файл, 332 теста; golden M0 без изменений; e2e — 37/37; `POST /api/stripe/webhook` → 404.

### Оставшиеся упоминания Stripe (только история)
- SQL-миграции `0021` (таблицы `organization_billing`, `billing_events`, колонка `stripe_invoice_id`),
  `0023`/`0025` (источник «Abonament CRM» по `stripe_invoice_id` в `agency_summary`) — **не меняются**.
- `lib/platform/org-relations-report.ts` / `scripts/report-org-relations.ts` — показывают историю
  Stripe в отчёте M1.2 (не критерий).
- Документация (`docs/architecture/*`, `docs/decisions.md`, `docs/audit/*`) — описание истории и решения.

### Найдено попутно (не исправлялось)
`agency_repeat_retainers` (`0020`) копирует сумму, исполнителей и продавцов, но **не копирует
`service_id`**: повторённый заказ «CRM (abonament)» остаётся без ссылки на услугу (раздел 65 %
сохраняется через скопированных исполнителей). Влияет на отчёты по услугам — решение отдельно.
