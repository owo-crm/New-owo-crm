import { z } from "zod";
import { one, type Queryable } from "../db/core.ts";
import { renderLetter, type LetterLook } from "../mailing/render.ts";
import { applyStageAfter, MEANING_BY_KIND } from "../documents/stage.ts";
import { replySubject } from "./inbound.ts";
import { sendBusinessMail } from "./service.ts";
import {
  isPdf,
  MailError,
  MAX_PDF_BYTES,
  safeFilename,
  type MailAttachment,
  type SmtpFactory,
} from "./transport.ts";

/**
 * Отправка из чата «Poczta → Wiadomości» (решения 051, 053): текст, шаблон письма или
 * шаблон документа с PDF во вложении. Порядок по D-20:
 *
 *   1. операция записывается в outbound_messages ДО вызова провайдера (unique step_key);
 *   2. документ создаётся с operation_key — повтор не плодит второй документ;
 *   3. провайдер вызывается вне транзакции базы;
 *   4. подтверждённая отправка → status='sent' + provider_message_id, затем «фиксация»:
 *      письмо в переписке, документ «sent», событие в истории, сдвиг этапа (одна транзакция,
 *      повторяемая: mail_messages.outbound_id уникален);
 *   5. ответа провайдера нет (таймаут после отправки) → status='unknown', без автоповтора;
 *      пользователь решает сам («Wyślij ponownie» = новая операция).
 *
 * Получатель берётся ТОЛЬКО из лида (если он указан) — адрес из браузера не используется.
 * Шаблон, документ и файл проверяются на принадлежность фирме через RLS (runAsUser).
 */

export const quickOfferValues = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{2}\.\d{2}\.\d{4}$/, "Data w formacie DD.MM.RRRR"),
  venue: z.string().trim().max(200),
  guests: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, "Liczba gości"),
  hours: z.string().trim().max(60),
  price: z
    .string()
    .trim()
    .regex(/^\d{1,7}([.,]\d{1,2})?$/, "Cena"),
});
export type QuickOfferValues = z.infer<typeof quickOfferValues>;

export const chatSendInput = z.object({
  operationId: z.uuid(),
  leadId: z.uuid().optional(),
  /** Только для переписки без лида (незнакомый адрес из входящих). */
  to: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  templateId: z.uuid().optional(),
  documentId: z.uuid().optional(),
  values: quickOfferValues.optional(),
  text: z.string().max(20000).default(""),
  subject: z.string().trim().max(200).optional(),
  heading1: z.string().trim().max(60).optional(),
  heading2: z.string().trim().max(60).optional(),
});
export type ChatSendInput = z.infer<typeof chatSendInput>;

export type ChatSendResult =
  | { status: "sent"; documentId: string | null; stage: { from: string; to: string } | null }
  | { status: "pending" | "unknown"; documentId: string | null }
  | { status: "error"; code: string; message?: string; documentId: string | null };

type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  heading1: string | null;
  heading2: string | null;
  button_text: string | null;
  button_url: string | null;
  purpose: "mail" | "document";
  document_kind: "offer" | "contract" | "menu" | "file" | null;
  document_params: Record<string, unknown>;
  document_mode: "quick" | "form" | null;
  attachment_id: string | null;
  stage_after: string | null;
};

export type ChatSendDeps = {
  /** Соединение владельца базы: outbox и журнал отправки (вне RLS, только по проверенным id). */
  db: Queryable;
  /** Выполнить от имени пользователя под RLS (в приложении — withOrg). */
  runAsUser: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  ctx: {
    userId: string;
    organization: {
      id: string;
      name: string;
      documentEngine: string | null;
      modules: string[];
      email: string | null;
      phone: string | null;
    };
  };
  origin: string;
  look: LetterLook;
  /** Генерация быстрой оферты (Barowo): возвращает id документа; тот же operationKey → тот же документ. */
  generateQuickOffer?: (
    tx: Queryable,
    input: { leadId: string; pkg: string; values: QuickOfferValues; operationKey: string },
  ) => Promise<{ id: string }>;
  mail?: { smtp?: SmtpFactory; fetch?: typeof fetch };
};

const fail = (
  code: string,
  documentId: string | null = null,
  message?: string,
): ChatSendResult => ({
  status: "error",
  code,
  message,
  documentId,
});

export function engineSupports(org: ChatSendDeps["ctx"]["organization"], kind: string | null) {
  if (kind === "file" || kind === null) return true;
  return org.documentEngine === "barowo" && org.modules.includes("documents");
}

export async function sendChatMessage(
  raw: ChatSendInput,
  deps: ChatSendDeps,
): Promise<ChatSendResult> {
  const input = chatSendInput.parse(raw);
  const { db, runAsUser, ctx } = deps;
  const orgId = ctx.organization.id;

  // ── 1. Кому и что: всё через RLS ──────────────────────────────────────────
  let prepared: {
    to: string;
    leadId: string | null;
    leadName: string;
    template: TemplateRow | null;
    last: { subject: string; message_id: string | null } | null;
  };
  try {
    prepared = await runAsUser(async (tx) => {
      let to = input.to ?? null;
      let leadId: string | null = null;
      let leadName = "";
      if (input.leadId) {
        const lead = await one<{ id: string; email: string | null; client_name: string }>(
          tx,
          "select id, email, client_name from public.leads where organization_id=$1 and id=$2 and deleted_at is null",
          [orgId, input.leadId],
        );
        if (!lead) throw new Error("lead_not_found");
        if (!lead.email || !z.email().safeParse(lead.email.trim()).success)
          throw new Error("no_email");
        to = lead.email.trim().toLowerCase();
        leadId = lead.id;
        leadName = lead.client_name;
      } else if (to) {
        const lead = await one<{ id: string; client_name: string }>(
          tx,
          `select id, client_name from public.leads
            where organization_id=$1 and lower(email)=$2 and deleted_at is null
            order by created_at desc limit 1`,
          [orgId, to],
        );
        leadId = lead?.id ?? null;
        leadName = lead?.client_name ?? "";
      }
      if (!to) throw new Error("no_email");
      const template = input.templateId
        ? await one<TemplateRow>(
            tx,
            `select id, name, subject, body, heading1, heading2, button_text, button_url, purpose,
                    document_kind, document_params, document_mode, attachment_id, stage_after
               from public.mailing_templates where organization_id=$1 and id=$2`,
            [orgId, input.templateId],
          )
        : null;
      if (input.templateId && !template) throw new Error("template_not_found");
      const last = await one<{ subject: string; message_id: string | null }>(
        tx,
        `select subject, message_id from public.mail_messages
          where organization_id=$1 and counterpart=$2 order by created_at desc limit 1`,
        [orgId, to],
      );
      return { to, leadId, leadName, template, last };
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { to, leadId, leadName, template, last } = prepared;
  const isDocument = template?.purpose === "document";
  if (isDocument && !leadId) return fail("document_needs_lead");
  if (isDocument && !engineSupports(ctx.organization, template!.document_kind))
    return fail("engine_missing");
  if (!template && !input.text.trim()) return fail("empty");

  // ── 2. Операция в outbox до вызова провайдера ─────────────────────────────
  const stepKey = `ui:${input.operationId}`;
  let op = await one<{ id: string }>(
    db,
    `insert into public.outbound_messages
       (organization_id, step_key, channel, target_ref, template_key, params, lead_id,
        template_id, created_by, status, attempts)
     values ($1, $2, 'email', $3, $4, $5, $6, $7, $8, 'sending', 1)
     on conflict (step_key) do nothing returning id`,
    [
      orgId,
      stepKey,
      leadId ?? "address",
      template?.id ?? "",
      JSON.stringify({ kind: template?.document_kind ?? "text" }),
      leadId,
      template?.id ?? null,
      ctx.userId,
    ],
  );
  if (!op) {
    const existing = await one<{
      id: string;
      organization_id: string;
      status: string;
      document_id: string | null;
      finalized_at: string | null;
      provider_message_id: string | null;
    }>(
      db,
      "select id, organization_id, status, document_id, finalized_at, provider_message_id from public.outbound_messages where step_key=$1",
      [stepKey],
    );
    if (!existing || existing.organization_id !== orgId) return fail("operation_conflict");
    if (existing.status === "sent") {
      // Повторный клик: письмо уже ушло. Если фиксация не прошла (сбой после отправки) и
      // первая попытка точно закончилась (> 15 с), дописываем сейчас; иначе не мешаем ей.
      const stale = await one<{ stale: boolean }>(
        db,
        "select (sent_at < now() - interval '15 seconds') as stale from public.outbound_messages where id=$1",
        [existing.id],
      );
      const stage =
        !existing.finalized_at && stale?.stale
          ? await finalize(deps, existing.id).catch(() => null)
          : null;
      return { status: "sent", documentId: existing.document_id, stage };
    }
    if (existing.status === "sending" || existing.status === "queued")
      return { status: "pending", documentId: existing.document_id };
    if (existing.status === "unknown")
      return { status: "unknown", documentId: existing.document_id };
    // failed / cancelled — пользователь пробует ещё раз той же операцией.
    await db.query(
      "update public.outbound_messages set status='sending', attempts=attempts+1, last_error=null where id=$1",
      [existing.id],
    );
    op = { id: existing.id };
  }
  const opId = op.id;
  const markFailed = async (code: string, documentId: string | null) => {
    await db.query(
      "update public.outbound_messages set status='failed', last_error=$2, document_id=coalesce($3, document_id) where id=$1",
      [opId, code.slice(0, 500), documentId],
    );
  };

  // ── 3. Документ и вложение ────────────────────────────────────────────────
  let documentId: string | null = null;
  let attachment: MailAttachment | null = null;
  let fileRef: { fileId: string; filename: string; kind: "document" | "template" } | null = null;
  if (isDocument) {
    const kind = template!.document_kind!;
    try {
      const loaded = await runAsUser(async (tx) => {
        if (kind === "file") {
          const file = await one<{ id: string; filename: string; content: Buffer }>(
            tx,
            "select id, filename, content from public.template_files where organization_id=$1 and id=$2",
            [orgId, template!.attachment_id],
          );
          if (!file) throw new Error("file_not_found");
          return {
            documentId: null,
            fileId: file.id,
            filename: file.filename,
            content: file.content,
            kind: "template" as const,
          };
        }
        let docId = input.documentId ?? null;
        if (docId) {
          const doc = await one<{ id: string }>(
            tx,
            "select id from public.documents where organization_id=$1 and id=$2 and lead_id=$3 and kind=$4 and status<>'cancelled'",
            [orgId, docId, leadId, kind],
          );
          if (!doc) throw new Error("document_not_found");
        } else {
          if (template!.document_mode !== "quick" || kind !== "offer" || !deps.generateQuickOffer)
            throw new Error("document_required");
          if (!input.values) throw new Error("values_required");
          const pkg = String(template!.document_params.package ?? "");
          docId = (
            await deps.generateQuickOffer(tx, {
              leadId: leadId!,
              pkg,
              values: input.values,
              operationKey: input.operationId,
            })
          ).id;
        }
        const file = await one<{ id: string; filename: string; content: Buffer }>(
          tx,
          "select id, filename, content from public.document_files where organization_id=$1 and document_id=$2 and format='pdf'",
          [orgId, docId],
        );
        if (!file) throw new Error("file_not_found");
        return {
          documentId: docId,
          fileId: file.id,
          filename: file.filename,
          content: file.content,
          kind: "document" as const,
        };
      });
      documentId = loaded.documentId;
      const bytes = new Uint8Array(loaded.content);
      if (!isPdf(bytes)) throw new Error("not_pdf");
      if (bytes.length > MAX_PDF_BYTES) throw new Error("attachment_too_large");
      const filename = safeFilename(loaded.filename);
      attachment = { filename, content: Buffer.from(bytes), contentType: "application/pdf" };
      fileRef = { fileId: loaded.fileId, filename, kind: loaded.kind };
      await db.query("update public.outbound_messages set document_id=$2 where id=$1", [
        opId,
        documentId,
      ]);
    } catch (error) {
      const message = (error as Error).message;
      // Ошибка проверки данных из генератора Barowo — понятный текст для пользователя.
      const code = /^[a-z_]+$/.test(message) ? message : "document_failed";
      await markFailed(code, documentId);
      return fail(code, documentId, code === "document_failed" ? message : undefined);
    }
  }

  // ── 4. Письмо ─────────────────────────────────────────────────────────────
  const defaultSubject = last
    ? replySubject(last.subject)
    : `Wiadomość od ${ctx.organization.name}`;
  const subject = input.subject || (template ? template.subject : defaultSubject);
  const letter = renderLetter(
    template
      ? {
          subject: template.subject || subject,
          body: template.body,
          heading1: template.heading1,
          heading2: template.heading2,
          buttonText: template.button_text,
          buttonUrl: template.button_url,
        }
      : {
          subject,
          body: input.text,
          heading1: input.heading1 || null,
          heading2:
            input.heading2 || subject.replace(/^\s*((re|odp|aw|fwd?)\s*:\s*)+/i, "").trim() || null,
        },
    { name: leadName, email: to },
    {
      organizationId: orgId,
      origin: deps.origin,
      brand: ctx.organization.name,
      look: deps.look,
      unsubscribe: false,
    },
  );
  const inReplyTo = last?.message_id ?? null;

  let providerId: string | null = null;
  try {
    ({ providerId } = await sendBusinessMail(
      db,
      orgId,
      {
        to: [to],
        subject: letter.subject,
        html: letter.html,
        text: letter.text,
        inReplyTo,
        idempotencyKey: input.operationId,
        attachments: attachment ? [attachment] : undefined,
      },
      { kind: isDocument ? "document" : "reply", leadId, sentBy: ctx.userId },
      deps.mail,
    ));
  } catch (error) {
    const mailError = error instanceof MailError ? error : new MailError("send_failed");
    if (mailError.uncertain) {
      await db.query(
        "update public.outbound_messages set status='unknown', last_error=$2 where id=$1",
        [opId, mailError.code],
      );
      return { status: "unknown", documentId };
    }
    await markFailed(mailError.code, documentId);
    return fail(mailError.code, documentId);
  }

  // ── 5. Подтверждено: сначала статус операции, потом фиксация ──────────────
  const chatBody = template
    ? [template.heading1, template.heading2, template.body]
        .filter(Boolean)
        .join("\n\n")
        .replace(/\{imie\}/g, leadName.trim().split(/\s+/)[0] ?? "")
    : input.text;
  await db.query(
    `update public.outbound_messages
        set status='sent', provider_message_id=$2, sent_at=now(),
            params = params || $3::jsonb
      where id=$1`,
    [
      opId,
      providerId,
      // Для фиксации нужны текст и тема; в outbox по §4.6 храним только ключи — текст
      // кладём временно и стираем в finalize.
      JSON.stringify({
        pending: {
          to,
          subject: letter.subject,
          text: chatBody,
          html: letter.html,
          inReplyTo,
          file: fileRef,
        },
      }),
    ],
  );
  let stage: { from: string; to: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      stage = await finalize(deps, opId);
      break;
    } catch (error) {
      // Конфликт сериализации (параллельная правка лида) — короткий повтор; письмо уже ушло,
      // поэтому повторяется только запись в базу, не отправка.
      console.error("[chat-send] finalize", (error as Error).message);
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  return { status: "sent", documentId, stage };
}

/** Фиксация отправленного письма (повторяемая): переписка, документ, история, этап. */
async function finalize(deps: ChatSendDeps, opId: string) {
  const { db, runAsUser, ctx } = deps;
  const orgId = ctx.organization.id;
  const op = await one<{
    lead_id: string | null;
    document_id: string | null;
    template_id: string | null;
    provider_message_id: string | null;
    params: {
      kind?: string;
      pending?: {
        to: string;
        subject: string;
        text: string;
        html: string;
        inReplyTo: string | null;
        file: { fileId: string; filename: string; kind: string } | null;
      };
    };
    finalized_at: string | null;
  }>(
    db,
    "select lead_id, document_id, template_id, provider_message_id, params, finalized_at from public.outbound_messages where id=$1 and organization_id=$2 and status='sent'",
    [opId, orgId],
  );
  if (!op || op.finalized_at || !op.params.pending) return null;
  const p = op.params.pending;
  const stage = await runAsUser(async (tx) => {
    const inserted = await one<{ id: string }>(
      tx,
      `insert into public.mail_messages
         (organization_id, lead_id, direction, counterpart, subject, body_text, body_html,
          in_reply_to, read_at, sent_by, provider_id, status, status_at, outbound_id,
          document_id, attachments)
       values ($1, $2, 'out', $3, $4, $5, $6, $7, now(), $8, $9, 'sent', now(), $10, $11, $12)
       on conflict (outbound_id) where outbound_id is not null do nothing
       returning id`,
      [
        orgId,
        op.lead_id,
        p.to,
        p.subject.slice(0, 500),
        p.text.slice(0, 200000),
        p.html.slice(0, 500000),
        p.inReplyTo,
        ctx.userId,
        op.provider_message_id,
        opId,
        op.document_id,
        JSON.stringify(p.file ? [p.file] : []),
      ],
    );
    if (!inserted) return null;
    let moved: { from: string; to: string } | null = null;
    let number: string | null = null;
    let kind: string | null = null;
    if (op.document_id) {
      const doc = await one<{ number: string; kind: string }>(
        tx,
        "update public.documents set status='sent', sent_at=now() where organization_id=$1 and id=$2 and status in ('generated','sent') returning number, kind",
        [orgId, op.document_id],
      );
      number = doc?.number ?? null;
      kind = doc?.kind ?? null;
    }
    if (op.lead_id && op.template_id) {
      const template = await one<{
        document_kind: string | null;
        stage_after: string | null;
        purpose: string;
      }>(
        tx,
        "select document_kind, stage_after, purpose from public.mailing_templates where organization_id=$1 and id=$2",
        [orgId, op.template_id],
      );
      if (template?.purpose === "document")
        moved = await applyStageAfter(
          tx,
          orgId,
          op.lead_id,
          template.stage_after,
          MEANING_BY_KIND[template.document_kind ?? ""] ?? null,
        );
    }
    if (op.lead_id)
      await tx.query(
        `insert into public.lead_events (organization_id, lead_id, type, actor_user_id, payload)
         values ($1, $2, 'email_sent', $3, $4)`,
        [
          orgId,
          op.lead_id,
          ctx.userId,
          {
            outbound_id: opId,
            template_id: op.template_id,
            document_id: op.document_id,
            document_kind: kind,
            number,
            stage_from: moved?.from ?? null,
            stage_to: moved?.to ?? null,
          },
        ],
      );
    return moved;
  });
  // Текст письма из outbox убираем: он уже в переписке (§4.6 — в outbox только ключи).
  await db.query(
    "update public.outbound_messages set finalized_at=now(), params = params - 'pending' where id=$1",
    [opId],
  );
  return stage;
}
