import "server-only";
import { getDb } from "@/lib/db";
import { loadMailSettings, recipientsSentToday, sendBusinessMail } from "@/lib/mail/service";
import { MailError } from "@/lib/mail/transport";
import { fillName, renderLetter } from "./render";
import { loadLetterLook } from "@/lib/mail/look";
import { findLeadByEmail, recordOutgoing } from "@/lib/mail/inbox";

/**
 * Отправка рассылки порциями.
 *
 * Кампания крупнее дневного лимита ящика не падает, а доезжает за несколько дней:
 * каждый проход берёт столько получателей, сколько сегодня ещё можно отправить.
 * Письма уходят по одному — так отказ по одному адресу не губит всю порцию
 * и в письме у каждого своё имя и своя ссылка отписки.
 */

type Row = {
  recipient_id: string;
  campaign_id: string;
  email: string;
  name: string | null;
  subject: string;
  body: string;
  heading1: string | null;
  heading2: string | null;
  button_text: string | null;
  button_url: string | null;
};

export async function sendMailingBatch(organizationId: string, origin: string, max = 50) {
  const db = getDb();
  const loaded = await loadMailSettings(db, organizationId);
  if (!loaded) return { sent: 0, reason: "not_configured" as const };

  const sentToday = await recipientsSentToday(db, organizationId);
  const room = Math.min(max, loaded.dailyLimit - sentToday);
  if (room <= 0) return { sent: 0, reason: "daily_limit" as const };

  const { rows: brandRows } = await db.query<{ name: string }>(
    "select name from public.organizations where id = $1",
    [organizationId],
  );
  const brand = brandRows[0];
  if (!brand) return { sent: 0, reason: "not_configured" as const };

  const look = await loadLetterLook(db, organizationId, origin);
  const { rows } = await db.query<Row>("select * from public.mailing_next($1,$2)", [
    organizationId,
    room,
  ]);

  let sent = 0;
  for (const row of rows) {
    const letter = renderLetter(
      {
        subject: row.subject,
        body: row.body,
        heading1: row.heading1,
        heading2: row.heading2,
        buttonText: row.button_text,
        buttonUrl: row.button_url,
      },
      { name: row.name ?? "", email: row.email },
      {
        organizationId,
        origin,
        brand: brand.name,
        look,
      },
    );
    try {
      const { providerId } = await sendBusinessMail(
        db,
        organizationId,
        { to: [row.email], subject: letter.subject, html: letter.html, text: letter.text },
        { kind: "mailing" },
      );
      // Письмо рассылки попадает в переписку с этим клиентом: когда он ответит,
      // в чате видно, на что именно (и у письма будут статусы «Dostarczono», «Otwarto»).
      await recordOutgoing(db, {
        organizationId,
        leadId: await findLeadByEmail(db, organizationId, row.email),
        to: row.email,
        subject: letter.subject,
        text: chatText(row, row.name ?? ""),
        html: letter.html,
        inReplyTo: null,
        sentBy: null,
        providerId,
      }).catch((error) => console.error("[mailing] chat", (error as Error).message));
      await db.query("select public.mailing_mark($1,$2,true,null)", [
        organizationId,
        row.recipient_id,
      ]);
      sent += 1;
    } catch (error) {
      const code = error instanceof MailError ? error.code : "send_failed";
      await db.query("select public.mailing_mark($1,$2,false,$3)", [
        organizationId,
        row.recipient_id,
        code,
      ]);
      // Лимит дня исчерпан — остальное уедет завтра, это не ошибка кампании.
      if (code === "daily_limit") break;
    }
  }
  return { sent, reason: null };
}

/** Проход по всем фирмам, у которых есть незавершённые кампании. */
export async function runMailingQueue(origin: string) {
  const db = getDb();
  const { rows } = await db.query<{ organization_id: string }>(
    `select distinct organization_id from public.mailing_recipients where status = 'pending'`,
  );
  let sent = 0;
  for (const row of rows) sent += (await sendMailingBatch(row.organization_id, origin)).sent;
  return { sent, organizations: rows.length };
}

/** Текст письма для чата: заголовок и тело, с подставленным именем, без оформления. */
function chatText(row: Row, name: string) {
  return fillName([row.heading1, row.heading2, row.body].filter(Boolean).join("\n\n"), name);
}
