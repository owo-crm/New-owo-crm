import { unsubscribeUrl } from "./unsubscribe";

/**
 * Письмо фирмы: рассылка, шаблон из переписки или обычный ответ (решение 051).
 * Вёрстка на таблицах со стилями в строке — то, что переживает Gmail, Outlook и телефон.
 * Внешний вид задаёт фирма: тема (светлая/тёмная), цвет кнопок, логотип, подпись.
 * Никаких скриптов; единственная картинка — логотип фирмы с адреса CRM.
 */

export type Letter = {
  subject: string;
  body: string;
  heading1?: string | null;
  heading2?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
};

export type LetterLook = {
  theme: "light" | "dark";
  /** Цвет кнопок и первой строки заголовка, #rrggbb. */
  accent: string;
  /** Подпись под письмом: имя, телефон, сайт — несколько строк. */
  signature: string;
  /** Полный https-адрес логотипа или null — тогда только название фирмы. */
  logoUrl: string | null;
};

export const DEFAULT_LOOK: LetterLook = {
  theme: "light",
  accent: "#e8000d",
  signature: "",
  logoUrl: null,
};

const PALETTE = {
  light: {
    page: "#f2f0ed",
    card: "#ffffff",
    text: "#1c1c21",
    soft: "#4a4a55",
    muted: "#8b8b96",
    line: "#ebe8e4",
    scheme: "light",
  },
  dark: {
    page: "#08080a",
    card: "#141417",
    text: "#f2f2f4",
    soft: "#c4c4cc",
    muted: "#7d7d88",
    line: "#26262c",
    scheme: "dark",
  },
} as const;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const safeColor = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : DEFAULT_LOOK.accent);
const safeUrl = (u: string) => (/^(https?:|mailto:|tel:)/i.test(u.trim()) ? u.trim() : "");

/** Белый или почти чёрный текст на кнопке — что читается на её цвете. */
function onAccent(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#111114" : "#ffffff";
}

/** {imie} → имя получателя. Пустое имя не оставляет дыру в тексте. */
export function fillName(text: string, name: string) {
  return text.replace(/\{imie\}/g, name.trim().split(/\s+/)[0] || "");
}

export function renderLetter(
  letter: Letter,
  recipient: { name: string; email: string },
  context: {
    organizationId: string;
    origin: string;
    brand: string;
    look?: LetterLook;
    /** Рассылка — со ссылкой отписки; ответ клиенту в переписке — без неё. */
    unsubscribe?: boolean;
  },
) {
  const look = context.look ?? DEFAULT_LOOK;
  const c = PALETTE[look.theme] ?? PALETTE.light;
  const accent = safeColor(look.accent);
  const withOptOut = context.unsubscribe ?? true;
  const font = "'Helvetica Neue',Helvetica,Arial,sans-serif";

  const paragraphs = fillName(letter.body, recipient.name)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:${c.soft}">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const heading =
    letter.heading1 || letter.heading2
      ? `<h1 style="margin:0 0 22px;font-family:${font};font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.5px">${
          letter.heading1
            ? `<span style="color:${accent}">${escapeHtml(letter.heading1)}</span><br>`
            : ""
        }${letter.heading2 ? `<span style="color:${c.text}">${escapeHtml(letter.heading2)}</span>` : ""}</h1>`
      : "";

  const buttonUrl = letter.buttonUrl ? safeUrl(letter.buttonUrl) : "";
  const button =
    letter.buttonText && buttonUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px">
  <tr><td style="background:${accent};border-radius:999px">
    <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:15px 30px;font-family:${font};color:${onAccent(accent)};font-weight:700;font-size:15px;letter-spacing:0.2px;text-decoration:none;border-radius:999px">${escapeHtml(letter.buttonText)}&nbsp;&nbsp;&rarr;</a>
  </td></tr>
</table>`
      : "";

  const logo = look.logoUrl
    ? `<img src="${escapeHtml(look.logoUrl)}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:9px;border:0">`
    : `<div style="width:36px;height:36px;border-radius:9px;background:${accent};color:${onAccent(accent)};font:700 17px/36px ${font};text-align:center">${escapeHtml((context.brand.trim()[0] ?? "•").toUpperCase())}</div>`;

  const signature = look.signature.trim()
    ? `<tr><td style="padding:0 36px 30px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-top:1px solid ${c.line};padding-top:20px;font-family:${font};font-size:14px;line-height:1.6;color:${c.muted}">
      <span style="display:inline-block;width:18px;height:3px;background:${accent};border-radius:2px;margin-bottom:10px"></span><br>
      ${escapeHtml(look.signature.trim()).replace(/\n/g, "<br>")}
    </td></tr></table>
  </td></tr>`
    : "";

  const optOut = withOptOut
    ? unsubscribeUrl(context.origin, context.organizationId, recipient.email)
    : null;

  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="${c.scheme}"><meta name="supported-color-schemes" content="${c.scheme}">
<title>${escapeHtml(fillName(letter.subject, recipient.name))}</title></head>
<body style="margin:0;padding:0;background:${c.page}">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${c.page}">
<tr><td style="padding:32px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto">
  <tr><td style="padding:0 4px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle">${logo}</td>
      <td style="vertical-align:middle;padding-left:12px;font-family:${font};font-size:15px;font-weight:700;color:${c.text}">${escapeHtml(context.brand)}</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${c.card};border-radius:18px;overflow:hidden">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="height:4px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="padding:38px 36px 14px;font-family:${font}">
        ${heading}
        ${paragraphs}
        ${button}
      </td></tr>
      ${signature}
    </table>
  </td></tr>
  <tr><td style="padding:20px 4px 0;font-family:${font};font-size:12px;line-height:1.6;color:${c.muted}">
    ${escapeHtml(context.brand)}${optOut ? ` &nbsp;·&nbsp; <a href="${escapeHtml(optOut)}" style="color:${c.muted};text-decoration:underline">Wypisz się</a>` : ""}
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = [
    [letter.heading1, letter.heading2].filter(Boolean).join(" "),
    fillName(letter.body, recipient.name),
    letter.buttonText && buttonUrl ? `${letter.buttonText}: ${buttonUrl}` : "",
    look.signature.trim(),
    optOut ? `${context.brand}\nWypisz się: ${optOut}` : context.brand,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: fillName(letter.subject, recipient.name), html, text };
}
