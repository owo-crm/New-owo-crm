// Extracted verbatim from LegacyBot.gs / WebApp.gs (v48).

const COL = {
  UID: 1,
  CREATED_AT: 2,
  LEAD_SOURCE: 20,
  LEAD_STATUS: 21,
  EVENT: 13,
  DATE: 15,
  CITY: 16,
  NAME: 17,
  EMAIL: 18,
  PHONE: 19,
  SENT: 22,
  ASSIGNED: 23,
  OFERTA: 24,
  UMOWA: 25,
  SPAM: 26,
  REMIND: 28,
  NOTE: 29,
  CALLHIST: 30,
  NEXTCALL: 31,
  CAL_ID: 32,
  GUESTS: 33,
  PACKAGE: 34,
  HOURS: 35,
  CLIENT_FULL_NAME: 36,
  CLIENT_ADDRESS: 37,
};

function formatDate(value) {
  if (!value) return "";
  const d = parseDate(value);
  if (isNaN(d.getTime())) return value.toString();
  return (
    String(d.getDate()).padStart(2, "0") +
    "." +
    String(d.getMonth() + 1).padStart(2, "0") +
    "." +
    d.getFullYear()
  );
}

function parseDate(value) {
  if (!value) return new Date(NaN);
  if (value instanceof Date) return value;
  // Убираем апостроф от Facebook: '19.10.2027 → 19.10.2027
  let str = value.toString().trim().replace(/^'+/, "");
  // Пробуем DD.MM.YYYY формат СНАЧАЛА (приоритет над JS Date)
  const dotParts = str.split(".");
  if (dotParts.length >= 2) {
    const day = parseInt(dotParts[0]);
    const month = parseInt(dotParts[1]) - 1;
    const year =
      dotParts.length >= 3
        ? dotParts[2].length == 2
          ? 2000 + parseInt(dotParts[2])
          : parseInt(dotParts[2])
        : new Date().getFullYear();
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      return new Date(year, month, day);
    }
  }
  // Fallback на стандартный парсинг
  let d = new Date(str);
  return d;
}

function getLeadContractClientName_(lead) {
  return (lead[COL.CLIENT_FULL_NAME - 1] || lead[COL.NAME - 1] || "").toString().trim();
}

function getLeadContractClientAddress_(lead) {
  return (lead[COL.CLIENT_ADDRESS - 1] || "").toString().trim();
}

// ─── UID: уникальный ID лида ─────────────────────────────────────────────────

function escapeHtml_(value) {
  return (value || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
