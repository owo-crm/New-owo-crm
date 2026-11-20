import { z } from "zod";
import { one, type Database, type Queryable } from "../db/core.ts";

/**
 * Импорт шаблонов писем и документов в одну фирму (решение 053, D-07: конфигурацию
 * делает OWO вместе с Claude; клиент не получает конструктор кода).
 *
 * По умолчанию — только отчёт (что будет создано, что пропущено). Запись — `apply`.
 * Существующий шаблон (по имени) не перезаписывается без `overwrite`: владелец мог
 * поправить текст в «Ustawienia → Poczta → Szablony».
 */

const url = z
  .string()
  .max(500)
  .refine((v) => /^(https?:|mailto:|tel:)/i.test(v), "Adres przycisku: http(s), mailto lub tel");

export const importTemplate = z
  .object({
    name: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(200),
    body: z.string().max(8000),
    heading1: z.string().trim().max(60).nullable().default(null),
    heading2: z.string().trim().max(60).nullable().default(null),
    button_text: z.string().trim().max(60).nullable().default(null),
    button_url: url.nullable().default(null),
    purpose: z.enum(["mail", "document"]).default("mail"),
    document_kind: z.enum(["offer", "contract", "menu", "file"]).nullable().default(null),
    document_params: z
      .object({
        package: z.enum(["simple", "standard", "premium"]).optional(),
        personal: z.boolean().optional(),
      })
      .strict()
      .default({}),
    document_mode: z.enum(["quick", "form"]).nullable().default(null),
    quick_label: z.string().trim().min(1).max(40).nullable().default(null),
    quick_position: z.number().int().min(0).max(999).default(0),
    stage_after: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,49}$/)
      .nullable()
      .default(null),
    /** Готовый PDF (для document_kind = 'file'): содержимое передаёт скрипт после чтения файла. */
    file: z.string().max(300).nullable().default(null),
  })
  .superRefine((x, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (x.purpose === "mail") {
      if (x.document_kind || x.document_mode || x.stage_after || x.file)
        bad("Zwykła wiadomość nie ma pól dokumentu");
      return;
    }
    if (!x.document_kind) bad("Brak document_kind");
    if (x.document_kind === "file" && (!x.file || x.document_mode))
      bad("Plik: potrzebny 'file', bez 'document_mode'");
    if (x.document_kind && x.document_kind !== "file" && !x.document_mode)
      bad("Dokument: potrzebny 'document_mode'");
    if (x.document_mode === "quick" && (x.document_kind !== "offer" || !x.document_params.package))
      bad("Tryb quick: tylko oferta z pakietem");
  });
export type ImportTemplate = z.infer<typeof importTemplate>;

export const importFile = z.object({ templates: z.array(importTemplate).min(1).max(100) });

export type ImportRow = {
  name: string;
  action: "create" | "overwrite" | "skip_exists" | "error";
  reason?: string;
};

export type PdfBytes = Record<string, Uint8Array>;

const isPdf = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** Что произойдёт с каждым шаблоном. Ничего не пишет. */
export async function planImport(
  db: Queryable,
  orgId: string,
  templates: ImportTemplate[],
  options: { overwrite?: boolean; files?: PdfBytes; engine?: string | null } = {},
): Promise<ImportRow[]> {
  const { rows: stages } = await db.query<{ key: string }>(
    "select key from public.pipeline_stages where organization_id=$1",
    [orgId],
  );
  const { rows: existing } = await db.query<{ name: string }>(
    "select name from public.mailing_templates where organization_id=$1",
    [orgId],
  );
  const names = new Set(existing.map((r) => r.name));
  const seen = new Set<string>();
  return templates.map((x): ImportRow => {
    if (seen.has(x.name))
      return { name: x.name, action: "error", reason: "Powtórzona nazwa w pliku" };
    seen.add(x.name);
    if (x.stage_after && !stages.some((s) => s.key === x.stage_after))
      return {
        name: x.name,
        action: "error",
        reason: `Brak etapu „${x.stage_after}” w lejku firmy`,
      };
    if (x.document_kind && x.document_kind !== "file" && options.engine !== "barowo")
      return { name: x.name, action: "error", reason: "Firma nie ma generatora dokumentów" };
    if (x.file) {
      const bytes = options.files?.[x.file];
      if (!bytes) return { name: x.name, action: "error", reason: `Brak pliku ${x.file}` };
      if (!isPdf(bytes)) return { name: x.name, action: "error", reason: "Plik nie jest PDF" };
      if (bytes.length > 10 * 1024 * 1024)
        return { name: x.name, action: "error", reason: "Plik większy niż 10 MB" };
    }
    if (names.has(x.name))
      return options.overwrite
        ? { name: x.name, action: "overwrite" }
        : {
            name: x.name,
            action: "skip_exists",
            reason: "Już jest — bez --overwrite nie zmieniamy",
          };
    return { name: x.name, action: "create" };
  });
}

/** Записать по плану в одной транзакции. Ошибка хотя бы в одном шаблоне — ничего не пишем. */
export async function applyImport(
  db: Database,
  orgId: string,
  templates: ImportTemplate[],
  options: { overwrite?: boolean; files?: PdfBytes; engine?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const plan = await planImport(tx, orgId, templates, options);
    const errors = plan.filter((r) => r.action === "error");
    if (errors.length) throw new Error(errors.map((e) => `${e.name}: ${e.reason}`).join("; "));
    for (const [i, x] of templates.entries()) {
      const action = plan[i].action;
      if (action === "skip_exists") continue;
      let attachmentId: string | null = null;
      if (x.file) {
        const bytes = options.files![x.file];
        const filename = x.file
          .split(/[\\/]/)
          .pop()!
          .replace(/[^\w.\- ]+/g, "_")
          .slice(0, 200);
        attachmentId = (await one<{ id: string }>(
          tx,
          `insert into public.template_files (organization_id, filename, content_type, size_bytes, content)
           values ($1, $2, 'application/pdf', $3, $4) returning id`,
          [orgId, filename, bytes.length, Buffer.from(bytes)],
        ))!.id;
      }
      const values = [
        orgId,
        x.name,
        x.subject,
        x.body,
        x.heading1,
        x.heading2,
        x.button_text,
        x.button_url,
        x.purpose,
        x.document_kind,
        JSON.stringify(x.document_params),
        x.document_mode,
        attachmentId,
        x.quick_label,
        x.quick_position,
        x.stage_after,
      ];
      if (action === "overwrite")
        await tx.query(
          `update public.mailing_templates set subject=$3, body=$4, heading1=$5, heading2=$6,
             button_text=$7, button_url=$8, purpose=$9, document_kind=$10, document_params=$11,
             document_mode=$12, attachment_id=$13, quick_label=$14, quick_position=$15, stage_after=$16
           where organization_id=$1 and name=$2`,
          values,
        );
      else
        await tx.query(
          `insert into public.mailing_templates
             (organization_id, name, subject, body, heading1, heading2, button_text, button_url,
              purpose, document_kind, document_params, document_mode, attachment_id, quick_label,
              quick_position, stage_after)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          values,
        );
    }
    return plan;
  });
}
