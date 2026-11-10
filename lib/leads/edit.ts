import { z } from "zod";
import { normalizeLead } from "./ingest.ts";
import type { Lead } from "./types.ts";
export const editableFields = [
  "client_name",
  "phone_e164",
  "email",
  "event_type",
  "event_date",
  "event_city",
  "venue",
  "guests",
  "budget_grosze",
  "message",
  "assigned_to",
  "stage_key",
] as const;
export type EditableField = (typeof editableFields)[number];
export const editFieldSchema = z.enum(editableFields);
export function parseMoney(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw new Error("invalid_money");
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return z.number().int().max(2147483647).parse(amount);
}
export function prepareLeadPatch(
  lead: Lead,
  field: EditableField,
  input: string,
): Record<string, string | number | null> {
  if (field === "stage_key")
    return {
      stage_key: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,49}$/)
        .parse(input),
    };
  if (field === "assigned_to") return { assigned_to: input ? z.uuid().parse(input) : null };
  const raw = { ...lead, [field]: field === "budget_grosze" ? parseMoney(input) : input };
  const normalized = normalizeLead({
    name: raw.client_name,
    phone: raw.phone_e164 ?? "",
    email: raw.email ?? "",
    event_type: raw.event_type ?? "",
    event_date: raw.event_date ?? "",
    city: raw.event_city ?? "",
    venue: raw.venue ?? "",
    guests: raw.guests,
    budget_grosze: raw.budget_grosze,
    message: raw.message,
  });
  return { [field]: normalized[field as keyof typeof normalized] as string | number | null };
}
