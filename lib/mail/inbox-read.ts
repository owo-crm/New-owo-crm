import "server-only";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/** Чтение переписки для экранов — через RLS, как остальные данные фирмы. */

const thread = z.object({
  counterpart: z.string(),
  name: z.string().nullable(),
  lead_id: z.uuid().nullable(),
  last_at: z.coerce.string(),
  last_direction: z.enum(["in", "out"]),
  last_subject: z.string(),
  last_text: z.string(),
  unread: z.coerce.number(),
  /** Последнее отправленное клиенту письмо не дошло (адрес не существует, ящик полон). */
  bounced: z.boolean(),
});
export type Thread = z.infer<typeof thread>;

const message = z.object({
  id: z.uuid(),
  direction: z.enum(["in", "out"]),
  subject: z.string(),
  body_text: z.string(),
  body_pending: z.boolean(),
  has_html: z.boolean(),
  attachments: z
    .array(
      z
        .object({
          filename: z.string(),
          fileId: z.string().optional(),
          kind: z.string().optional(),
        })
        .passthrough(),
    )
    .catch([]),
  message_id: z.string().nullable(),
  created_at: z.coerce.string(),
  sender: z.string().nullable(),
  status: z.enum(["sent", "delayed", "delivered", "opened", "bounced", "complained"]).nullable(),
  status_at: z.coerce.string().nullable(),
  status_detail: z.string().nullable(),
});
export type ThreadMessage = z.infer<typeof message>;

export function listThreads() {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query(
      `with last as (
         select distinct on (m.counterpart) m.counterpart, m.created_at as last_at,
                m.direction as last_direction, m.subject as last_subject,
                left(m.body_text, 200) as last_text
           from public.mail_messages m
          where m.organization_id = $1
          order by m.counterpart, m.created_at desc)
       select l.*,
              (select count(*) from public.mail_messages u
                where u.organization_id = $1 and u.counterpart = l.counterpart
                  and u.direction = 'in' and u.read_at is null) as unread,
              coalesce(
                (select x.client_name from public.mail_messages lm
                   join public.leads x on x.organization_id = lm.organization_id and x.id = lm.lead_id
                  where lm.organization_id = $1 and lm.counterpart = l.counterpart and lm.lead_id is not null
                  order by lm.created_at desc limit 1),
                (select n.counterpart_name from public.mail_messages n
                  where n.organization_id = $1 and n.counterpart = l.counterpart
                    and n.counterpart_name is not null limit 1)) as name,
              (select lm.lead_id from public.mail_messages lm
                where lm.organization_id = $1 and lm.counterpart = l.counterpart and lm.lead_id is not null
                order by lm.created_at desc limit 1) as lead_id,
              coalesce((select o.status in ('bounced', 'complained') from public.mail_messages o
                where o.organization_id = $1 and o.counterpart = l.counterpart and o.direction = 'out'
                order by o.created_at desc limit 1), false) as bounced
         from last l
        order by l.last_at desc
        limit 300`,
      [organization.id],
    );
    return thread.array().parse(rows);
  });
}

export function unreadCount() {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{ n: number }>(
      `select count(*)::int as n from public.mail_messages
        where organization_id = $1 and direction = 'in' and read_at is null`,
      [organization.id],
    );
    return rows[0]?.n ?? 0;
  });
}

/** Переписка с одним адресом; входящие отмечаются прочитанными. */
export function getThread(counterpart: string) {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query(
      `select m.id, m.direction, m.subject, m.body_text, m.body_pending,
              (m.body_html is not null) as has_html, m.attachments, m.message_id, m.created_at,
              p.full_name as sender, m.status, m.status_at, m.status_detail
         from public.mail_messages m
         left join public.profiles p on p.user_id = m.sent_by
        where m.organization_id = $1 and m.counterpart = $2
        order by m.created_at
        limit 500`,
      [organization.id, counterpart],
    );
    await tx.query(
      `update public.mail_messages set read_at = now()
        where organization_id = $1 and counterpart = $2 and direction = 'in' and read_at is null`,
      [organization.id, counterpart],
    );
    const lead = (
      await tx.query<{ id: string; client_name: string }>(
        `select id, client_name from public.leads
          where organization_id = $1 and lower(email) = $2 and deleted_at is null
          order by created_at desc limit 1`,
        [organization.id, counterpart],
      )
    ).rows[0];
    const named = (
      await tx.query<{ counterpart_name: string }>(
        `select counterpart_name from public.mail_messages
          where organization_id = $1 and counterpart = $2 and counterpart_name is not null
          order by created_at desc limit 1`,
        [organization.id, counterpart],
      )
    ).rows[0];
    return {
      messages: message.array().parse(rows),
      lead: lead ?? null,
      name: named?.counterpart_name ?? null,
    };
  });
}

/** Последнее письмо лиду не дошло — предупреждение в карточке лида. */
export function leadMailProblem(leadId: string) {
  return withOrg(async (tx, { organization }) => {
    const row = (
      await tx.query<{ status: string; status_detail: string | null }>(
        `select status, status_detail from public.mail_messages
          where organization_id = $1 and lead_id = $2 and direction = 'out'
          order by created_at desc limit 1`,
        [organization.id, leadId],
      )
    ).rows[0];
    return row && ["bounced", "complained"].includes(row.status)
      ? { status: row.status as "bounced" | "complained", detail: row.status_detail }
      : null;
  });
}
