import { normalizeLead } from "./ingest";
import { parseMoney } from "./edit";
export function manualLeadInput(formData: FormData) {
  const fields = [
    "name",
    "phone",
    "email",
    "event_type",
    "event_date",
    "city",
    "venue",
    "guests",
    "message",
  ];
  const input = Object.fromEntries(fields.map((key) => [key, formData.get(key) ?? ""]));
  const budget = formData.get("budget");
  if (typeof budget !== "string" && budget !== null) throw new Error("invalid_money");
  const result = { ...input, budget_grosze: parseMoney(budget ?? "") };
  normalizeLead(result); // Same validation as website/Telegram; never accept tenant/stage from this form.
  return result;
}
