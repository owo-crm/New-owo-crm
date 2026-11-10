import { parse } from "csv-parse/sync";
import { normalizeLead, normalizePhone, type NormalizedLead } from "./ingest.ts";

/**
 * Импорт листа «Lidy» из таблицы бота Barowo (CSV из Google Sheets).
 * Колонки читаются по номеру, как в боте (COL в LegacyBot.gs) — названия в шапке не важны.
 */
const COL = {
  UID: 1,
  CREATED: 2,
  EVENT: 13,
  GUESTS_OLD: 14,
  DATE: 15,
  CITY: 16,
  NAME: 17,
  EMAIL: 18,
  PHONE: 19,
  SOURCE: 20,
  STATUS: 21,
  ASSIGNED: 23,
  OFERTA: 24,
  UMOWA: 25,
  NOTE: 29,
  HISTORY: 30,
  GUESTS: 33,
  PACKAGE: 34,
  HOURS: 35,
  FULL_NAME: 36,
  ADDRESS: 37,
} as const;

const STAGES: Record<string, string> = {
  new: "new",
  assigned: "contacted",
  offer_draft: "contacted",
  offer_sent: "offer_sent",
  contract_generated: "contract_sent",
  signed: "contract_signed",
  spam: "spam",
};

export type BarowoRow = {
  uid: string;
  lead: NormalizedLead;
  stage: string;
  createdAt: string;
  firstResponseAt: string | null;
  source: string;
  extras: {
    package_name: string;
    service_hours: string;
    client_full_name: string;
    client_address: string;
  };
  note: string;
  assignedName: string;
};

function parseCreated(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const pl = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  const date = pl
    ? new Date(
        Date.UTC(+pl[3], +pl[2] - 1, +pl[1], +(pl[4] ?? 12) - 1, +(pl[5] ?? 0), +(pl[6] ?? 0)),
      )
    : new Date(v);
  return Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86400000
    ? null
    : date.toISOString();
}

export function isBarowoSheet(csv: string, delimiter = ",") {
  const first: string[][] = parse(csv, {
    bom: true,
    to_line: 1,
    delimiter,
    relax_column_count: true,
  });
  const h = (first[0] ?? []).map((x) => x.trim().toLowerCase());
  return h.length >= 25 && h[COL.NAME - 1] === "imie" && h[COL.PHONE - 1] === "telefon";
}

export function prepareBarowoImport(csv: string, delimiter = ",") {
  const rows: string[][] = parse(csv, {
    bom: true,
    from_line: 2,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
  });
  const valid: { row: number; value: BarowoRow }[] = [];
  const errors: { row: number; code: string }[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const cell = (c: number) => (r[c - 1] ?? "").trim().replace(/^'+/, "");
    const uid = cell(COL.UID);
    const name = cell(COL.NAME);
    if (!uid || (!name && !cell(COL.PHONE) && !cell(COL.EMAIL))) return void skipped++;
    let status = cell(COL.STATUS).toLowerCase();
    if (status === "deleted") return void skipped++;
    if (!STAGES[status])
      status =
        cell(COL.UMOWA) === "YES"
          ? "signed"
          : cell(COL.OFERTA) === "YES"
            ? "offer_sent"
            : cell(COL.ASSIGNED)
              ? "assigned"
              : "new";
    try {
      if (seen.has(uid)) throw new Error("duplicate_uid");
      seen.add(uid);
      const createdAt = parseCreated(cell(COL.CREATED));
      if (!createdAt) throw new Error("invalid_created_at");
      let phone = cell(COL.PHONE).replace(/^p:/i, "");
      let email = cell(COL.EMAIL).toLowerCase();
      const leftovers: string[] = [];
      try {
        normalizePhone(phone);
      } catch {
        leftovers.push(`Telefon (import): ${phone}`);
        phone = "";
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        leftovers.push(`E-mail (import): ${email}`);
        email = "";
      }
      if (!phone && !email) throw new Error("no_contact");
      const dateRaw = cell(COL.DATE);
      const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(dateRaw);
      const iso = m
        ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
        : /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
          ? dateRaw
          : "";
      const dateOk = iso && new Date(iso).toISOString().slice(0, 10) === iso;
      if (dateRaw && !dateOk) leftovers.push(`Data (import): ${dateRaw}`);
      const guestsRaw = cell(COL.GUESTS) || cell(COL.GUESTS_OLD);
      const guestNumbers =
        guestsRaw
          .match(/\d+/g)
          ?.map(Number)
          .filter((n) => n <= 100000) ?? [];
      const lead = normalizeLead({
        name: (name || phone || email).slice(0, 200),
        phone,
        email,
        event_type: cell(COL.EVENT).slice(0, 120),
        event_date: dateOk ? iso : "",
        city: cell(COL.CITY).slice(0, 120),
        guests: guestNumbers.length ? Math.max(...guestNumbers) : null,
        message: leftovers.join("\n"),
      });
      const history = cell(COL.HISTORY);
      const note = [cell(COL.NOTE), history ? `Historia z bota:\n${history}` : ""]
        .filter(Boolean)
        .join("\n\n");
      valid.push({
        row,
        value: {
          uid: `apps-script:${uid}`.slice(0, 160),
          lead,
          stage: STAGES[status],
          createdAt,
          // Точное время первого ответа неизвестно: «отвечен» = не новый.
          firstResponseAt: status === "new" ? null : createdAt,
          source: cell(COL.SOURCE).slice(0, 120),
          extras: {
            package_name: cell(COL.PACKAGE),
            service_hours: cell(COL.HOURS),
            client_full_name: cell(COL.FULL_NAME),
            client_address: cell(COL.ADDRESS),
          },
          note,
          assignedName: cell(COL.ASSIGNED),
        },
      });
    } catch (error) {
      errors.push({
        row,
        code: error instanceof Error && !("issues" in error) ? error.message : "invalid_row",
      });
    }
  });
  return { valid, errors, skipped, total: rows.length };
}
