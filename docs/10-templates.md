# Шаблоны писем и документов (решение 053)

Все шаблоны фирмы лежат в `public.mailing_templates`. Три вида:

| Вид | Поля | Что делает |
|---|---|---|
| Обычное письмо | `purpose='mail'` | Текст с оформлением фирмы. Доступен в рассылках и в чате. |
| Документ из данных лида | `purpose='document'`, `document_kind` = `offer` / `contract` / `menu`, `document_mode` = `quick` / `form` | Письмо + PDF, сгенерированный генератором фирмы (`organizations.document_engine`). Только в чате с лидом. |
| Готовый PDF | `purpose='document'`, `document_kind='file'`, `attachment_id` → `template_files` | Письмо + загруженный PDF (прайс, презентация). Не требует генератора. |

Общие поля: `subject`, `body` (`{imie}` → имя клиента), `heading1` (строка в цвете фирмы),
`heading2` (вторая строка), `button_text`/`button_url`, `quick_label` (подпись кнопки в
«Szybkie działania»; пусто — кнопки нет), `quick_position` (порядок), `stage_after` (этап после
отправки; пусто — решатель по смыслу: оферта → `offer_sent`, умова → `contract_sent`).

`document_params`: `{"package": "simple"|"standard"|"premium"}` для оферт Barowo,
`{"personal": true}` — персональная оферта (полная форма с выбором пакета).

Правила:
- `quick` бывает только у оферты с пакетом: данные (дата, место, гости, часы, цена) правятся
  прямо в чате, PDF создаётся в момент отправки.
- `form` — сначала форма (`/leady/<id>/oferta?personal=1`, `/umowa`, `/menu`), после «Generuj»
  чат открывается с прикреплённым PDF.
- Без генератора кнопки оферты/умовы/меню не показываются, импорт таких шаблонов отклоняется.
- Обычные шаблоны правит любой участник, документные — только owner/admin (RLS).
- В рассылках (`/poczta?tab=rozsylki`) документные шаблоны не показываются и не сохраняются.

## Как добавить шаблоны фирме (делает OWO, D-07)

1. Claude готовит JSON по образцу `templates/barowo.json` и превью писем (картинки) — владелец
   фирмы согласует тексты.
2. Отчёт без записи:
   `npm run templates:import -- --org <slug> --file templates/<firma>.json`
3. Запись (одна транзакция; ошибка хотя бы в одном шаблоне — ничего не пишется):
   `npm run templates:import -- --org <slug> --file templates/<firma>.json --apply`
4. Шаблон с тем же именем **не перезаписывается** (владелец мог поправить текст в
   «Ustawienia → Poczta → Szablony»). Заменить — только явно: `--apply --overwrite`.
5. Готовый PDF: `"document_kind": "file", "file": "pliki/cennik.pdf"` (путь относительно JSON).
   Проверяется, что это PDF (по байтам) и не больше 10 МБ.

На Railway: `railway run npm run templates:import -- …` (нужен `DATABASE_URL` продакшена).

## Отправка из чата (D-20)

`lib/mail/chat-send.ts`: операция с ключом (`operationId` из браузера) пишется в
`outbound_messages` до вызова провайдера; документ создаётся с `documents.operation_key`;
Resend получает `Idempotency-Key`. Ответа нет (таймаут) → `unknown`, автоповтора нет — в чате
предупреждение и ручная кнопка «Wyślij ponownie mimo to» (новая операция, тот же документ).
После подтверждения — в одной транзакции: письмо в `mail_messages` (с вложением), документ
`sent`, событие `email_sent` в истории, сдвиг этапа (только вперёд, не на won/lost).
Получатель — только e-mail лида; без e-mail кнопки документов неактивны.
