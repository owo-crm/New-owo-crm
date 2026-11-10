import "server-only";

/**
 * Служебные письма (сброс пароля, приглашения) через Resend.
 * Без RESEND_API_KEY письмо не уходит, а ссылка пишется в лог сервера — удобно локально.
 */
export async function sendSystemEmail(input: {
  to: string;
  subject: string;
  text: string;
  devLog?: string;
}) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV !== "production" && input.devLog) console.info(input.devLog);
    else
      console.warn(
        "[email] RESEND_API_KEY/NOTIFICATION_EMAIL_FROM nie ustawione — e-mail pominięty",
      );
    return { status: "skipped" as const };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`resend_http_${response.status}`);
  return { status: "sent" as const };
}
