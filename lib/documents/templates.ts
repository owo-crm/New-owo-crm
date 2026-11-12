import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { withOrg } from "@/lib/db/user";
import type { Queryable } from "@/lib/db";

/**
 * Шаблон умовы.
 *
 * Встроенный лежит в коде (`lib/documents/barowo/umowa-template.docx`) и работает «из коробки».
 * Фирма может загрузить свой .docx — тогда генератор берёт его. Поля подставляются по тем же
 * меткам, поэтому свой файл проще всего делать из скачанного встроенного.
 */

export const BUILT_IN_CONTRACT = path.join(
  process.cwd(),
  "lib/documents/barowo/umowa-template.docx",
);

export function builtInContractTemplate() {
  return readFileSync(BUILT_IN_CONTRACT);
}

/** Шаблон фирмы, если загружен; иначе встроенный. */
export async function contractTemplate(db: Queryable, organizationId: string) {
  const { rows } = await db.query<{ content: Buffer }>(
    "select content from public.organization_templates where organization_id=$1 and kind='contract'",
    [organizationId],
  );
  return rows[0]?.content ?? builtInContractTemplate();
}

export function templateInfo() {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{
      filename: string;
      size_bytes: number;
      updated_at: string;
    }>(
      "select filename, size_bytes, updated_at from public.organization_templates where organization_id=$1 and kind='contract'",
      [organization.id],
    );
    return rows[0] ?? null;
  });
}

export function saveContractTemplate(filename: string, content: Buffer) {
  return withOrg((tx, { organization, user }) =>
    tx.query(
      `insert into public.organization_templates
         (organization_id, kind, filename, content, size_bytes, uploaded_by)
       values ($1,'contract',$2,$3,$4,$5)
       on conflict (organization_id, kind) do update
         set filename = excluded.filename, content = excluded.content,
             size_bytes = excluded.size_bytes, uploaded_by = excluded.uploaded_by,
             updated_at = now()`,
      [organization.id, filename, content, content.byteLength, user.id],
    ),
  );
}

export function resetContractTemplate() {
  return withOrg((tx, { organization }) =>
    tx.query(
      "delete from public.organization_templates where organization_id=$1 and kind='contract'",
      [organization.id],
    ),
  );
}

/** Метки, которые панель подставляет в шаблон: {{UMOWA_NR}} и так далее. */
export const CONTRACT_FIELDS = [
  "UMOWA_NR",
  "TODAY",
  "EVENT_DATE",
  "CITY",
  "ZLECENIODAWCA",
  "ADDRESS",
  "GUESTS",
  "PRICE",
  "BALANCE",
  "DEPOSIT",
  "DEPOSIT_DATE",
  "EXTRA_HOUR",
  "PENALTY",
  "HOURS",
  "PACKAGE",
];
