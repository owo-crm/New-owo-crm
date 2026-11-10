import { parse } from "csv-parse/sync";
import { z } from "zod";
import { normalizeLead, type NormalizedLead } from "./ingest.ts";
import { parseMoney } from "./edit.ts";
import { PRESETS } from "../presets/index.ts";
export const defaultImportMapping = {
  uid: "uid",
  name: "name",
  phone: "phone",
  email: "email",
  event_type: "event_type",
  event_date: "event_date",
  city: "city",
  venue: "venue",
  guests: "guests",
  budget_zl: "budget",
  budget_grosze: "budget_grosze",
  message: "message",
  stage: "stage",
  created_at: "created_at",
  first_response_at: "first_response_at",
  source: "source",
};
export type ImportMapping = typeof defaultImportMapping;
export type LegacyLead = {
  uid: string;
  lead: NormalizedLead;
  stage: string;
  createdAt: string;
  firstResponseAt: string | null;
  source: string;
  raw: Record<string, string>;
};
export function prepareCsvImport(
  csv: string,
  mapping: ImportMapping = defaultImportMapping,
  delimiter = ",",
) {
  const raw: unknown = parse(csv, {
    bom: true,
    skip_empty_lines: true,
    delimiter,
    columns: (headers: string[]) => {
      const clean = headers.map((header) => header.trim());
      if (new Set(clean).size !== clean.length) throw new Error("duplicate_headers");
      return clean;
    },
  });
  const rows = z.array(z.record(z.string(), z.string())).parse(raw);
  const valid: { row: number; value: LegacyLead }[] = [];
  const errors: { row: number; code: string }[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    try {
      const field = (key: keyof ImportMapping) => row[mapping[key]]?.trim() ?? "";
      const uid = z.string().min(1).max(140).parse(field("uid"));
      if (seen.has(uid)) throw new Error("duplicate_uid");
      seen.add(uid);
      const date = field("event_date");
      const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(date);
      const event_date = match
        ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
        : date;
      const stageValue = field("stage").toLowerCase();
      const stage = PRESETS["event-services"].stages.find(
        (stage) => stage.key === stageValue || stage.labelPl.toLowerCase() === stageValue,
      )?.key;
      if (!stage) throw new Error("unknown_stage");
      const createdAt = z.iso.datetime({ offset: true }).parse(field("created_at"));
      const first = field("first_response_at");
      const firstResponseAt = first ? z.iso.datetime({ offset: true }).parse(first) : null;
      if (firstResponseAt && Date.parse(firstResponseAt) < Date.parse(createdAt))
        throw new Error("response_before_created");
      const budget = field("budget_grosze");
      const lead = normalizeLead({
        name: field("name"),
        phone: field("phone"),
        email: field("email"),
        event_type: field("event_type"),
        event_date,
        city: field("city"),
        venue: field("venue"),
        guests: field("guests"),
        budget_grosze: budget || parseMoney(field("budget_zl")),
        message: field("message"),
      });
      valid.push({
        row: index + 2,
        value: {
          uid: `apps-script:${uid}`,
          lead,
          stage,
          createdAt,
          firstResponseAt,
          source: z.string().max(120).parse(field("source")),
          raw: row,
        },
      });
    } catch (error) {
      errors.push({
        row: index + 2,
        code:
          error instanceof z.ZodError
            ? `invalid_${String(error.issues[0].path[0] ?? "value")}`
            : error instanceof Error
              ? error.message
              : "invalid_row",
      });
    }
  });
  return { valid, errors, total: rows.length };
}
