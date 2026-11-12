import "server-only";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/**
 * Свои файлы у лида: подписанный скан, план зала, список гостей, фото площадки.
 * Нумерации нет — это не сгенерированный документ, а приложение к заказу.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const attachment = z.object({
  id: z.uuid(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  note: z.string().nullable(),
  created_at: z.string(),
});
export type Attachment = z.infer<typeof attachment>;

export function listAttachments(leadId: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query(
      `select id, filename, content_type, size_bytes, note, created_at
       from public.lead_attachments where organization_id=$1 and lead_id=$2
       order by created_at desc`,
      [organization.id, leadId],
    );
    return attachment.array().parse(rows);
  });
}

export function addAttachment(input: {
  leadId: string;
  filename: string;
  contentType: string;
  content: Buffer;
  note: string | null;
}) {
  return withOrg(async (tx, { organization, user }) => {
    await tx.query(
      `insert into public.lead_attachments
         (organization_id, lead_id, filename, content_type, size_bytes, content, note, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        organization.id,
        input.leadId,
        input.filename,
        input.contentType,
        input.content.byteLength,
        input.content,
        input.note,
        user.id,
      ],
    );
    await tx.query(
      `insert into public.lead_events (organization_id, lead_id, type, payload, actor_user_id)
       values ($1,$2,'file_uploaded',$3::jsonb,$4)`,
      [organization.id, input.leadId, JSON.stringify({ text: input.filename }), user.id],
    );
  });
}

export function removeAttachment(id: string) {
  return withOrg((tx, { organization }) =>
    tx.query("delete from public.lead_attachments where organization_id=$1 and id=$2", [
      organization.id,
      id,
    ]),
  );
}

export function readAttachment(id: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{
      filename: string;
      content_type: string;
      content: Buffer;
    }>(
      "select filename, content_type, content from public.lead_attachments where organization_id=$1 and id=$2",
      [organization.id, id],
    );
    return rows[0] ?? null;
  });
}
