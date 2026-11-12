import "server-only";
import { getDb } from "@/lib/db";
import { loadMailSettings, recipientsSentToday, sendBusinessMail } from "@/lib/mail/service";
import { MailError } from "@/lib/mail/transport";
import { renderLetter } from "./render";

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

  const { rows: brandRows } = await db.query<{ name: string; brand_color: string }>(
    "select name, brand_color from public.organizations where id = $1",
    [organizationId],
  );
  const brand = brandRows[0];
  if (!brand) return { sent: 0, reason: "not_configured" as const };

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
        brandColor: brand.brand_color,
      },
    );
    try {
      await sendBusinessMail(
        db,
        organizationId,
        { to: [row.email], subject: letter.subject, html: letter.html, text: letter.text },
        { kind: "mailing" },
      );
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
