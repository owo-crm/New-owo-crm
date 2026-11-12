import { unsubscribeUrl } from "./unsubscribe";

/**
 * Письмо рассылки: простая и надёжная вёрстка на таблицах — то, что переживает
 * Gmail, Outlook и телефон. Никаких внешних картинок и скриптов.
 */

export type Letter = {
  subject: string;
  body: string;
  heading1?: string | null;
  heading2?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** {imie} → имя получателя. Пустое имя не оставляет дыру в тексте. */
export function fillName(text: string, name: string) {
  return text.replace(/\{imie\}/g, name.trim().split(/\s+/)[0] || "");
}

export function renderLetter(
  letter: Letter,
  recipient: { name: string; email: string },
  context: { organizationId: string; origin: string; brand: string; brandColor: string },
) {
  const paragraphs = fillName(letter.body, recipient.name)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1a1a1a">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const heading =
    letter.heading1 || letter.heading2
      ? `<h1 style="margin:0 0 20px;font-size:26px;line-height:1.2;font-weight:800">
           ${letter.heading1 ? `<span style="color:${escapeHtml(context.brandColor)}">${escapeHtml(letter.heading1)}</span><br>` : ""}
           ${letter.heading2 ? `<span style="color:#111111">${escapeHtml(letter.heading2)}</span>` : ""}
         </h1>`
      : "";

  const button =
    letter.buttonText && letter.buttonUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
           <tr><td style="background:${escapeHtml(context.brandColor)};border-radius:6px">
             <a href="${escapeHtml(letter.buttonUrl)}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${escapeHtml(letter.buttonText)}</a>
           </td></tr>
         </table>`
      : "";

  const optOut = unsubscribeUrl(context.origin, context.organizationId, recipient.email);

  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f5f8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px">
  <tr><td style="padding:32px 28px">
    ${heading}
    ${paragraphs}
    ${button}
  </td></tr>
  <tr><td style="padding:0 28px 28px">
    <hr style="border:0;border-top:1px solid #e7e9ee;margin:0 0 14px">
    <p style="margin:0;font-size:12px;line-height:1.5;color:#8a91a0">
      ${escapeHtml(context.brand)} ·
      <a href="${escapeHtml(optOut)}" style="color:#8a91a0">Wypisz się</a>
    </p>
  </td></tr>
</table>
</body></html>`;

  const text = `${[letter.heading1, letter.heading2].filter(Boolean).join(" ")}\n\n${fillName(letter.body, recipient.name)}\n\n${
    letter.buttonText && letter.buttonUrl ? `${letter.buttonText}: ${letter.buttonUrl}\n\n` : ""
  }${context.brand}\nWypisz się: ${optOut}`;

  return { subject: fillName(letter.subject, recipient.name), html, text };
}
