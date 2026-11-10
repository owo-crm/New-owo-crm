import { z } from "zod";

/** Local numbers default to Poland; explicitly international numbers keep their country code. */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[+\d\s().-]+$/.test(trimmed)) throw new Error("invalid_phone");
  let phone = trimmed.replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (/^\d{9}$/.test(phone)) phone = `+48${phone}`;
  else if (/^48\d{9}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || (phone.startsWith("+48") && phone.length !== 12)) {
    throw new Error("invalid_phone");
  }
  return phone;
}

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");
const nullableInteger = (max: number) =>
  z.preprocess(
    (value) =>
      value === "" || value === undefined || value === null
        ? null
        : typeof value === "string"
          ? Number(value)
          : value,
    z.number().int().min(0).max(max).nullable(),
  );
export const leadInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: optionalText(40).transform((value, ctx) => {
      try {
        return normalizePhone(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "invalid_phone" });
        return z.NEVER;
      }
    }),
    email: optionalText(254)
      .transform((value) => value.toLowerCase())
      .pipe(z.union([z.literal(""), z.email()])),
    event_type: optionalText(120),
    event_date: optionalText(10).refine(
      (value) =>
        !value ||
        (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value),
      "invalid_date",
    ),
    city: optionalText(120),
    venue: optionalText(200),
    guests: nullableInteger(100000),
    budget_grosze: nullableInteger(2147483647),
    message: optionalText(10000),
    custom_fields: z.record(z.string().max(100), z.json()).default({}),
    utm: z.record(z.string().max(100), z.string().max(500)).default({}),
    page_url: optionalText(2000).refine(
      (value) => !value || /^https?:\/\//.test(value),
      "invalid_url",
    ),
    referrer: optionalText(2000),
  })
  .refine((value) => Boolean(value.phone || value.email), {
    path: ["phone"],
    message: "contact_required",
  });

export type LeadInput = z.input<typeof leadInputSchema>;
export type NormalizedLead = {
  client_name: string;
  phone_e164: string | null;
  email: string | null;
  event_type: string | null;
  event_date: string | null;
  event_city: string | null;
  venue: string | null;
  guests: number | null;
  budget_grosze: number | null;
  message: string;
  custom_fields: Record<string, z.infer<ReturnType<typeof z.json>>>;
  utm: Record<string, string>;
  page_url: string | null;
  referrer: string | null;
};
export type IngestContext = {
  organizationId: string;
  channelId: string | null;
  sourceLabel: string;
  consentAt: string | null;
};
export type IngestResult = { id: string; number: number; duplicateIds: string[] };
export type IngestRepository = {
  /** Atomic transaction: insert + created event + duplicate links (last 30 days, same tenant). */
  saveLead(context: IngestContext, lead: NormalizedLead): Promise<IngestResult>;
};

export function normalizeLead(input: unknown): NormalizedLead {
  const value = leadInputSchema.parse(input);
  return {
    client_name: value.name,
    phone_e164: value.phone,
    email: value.email || null,
    event_type: value.event_type || null,
    event_date: value.event_date || null,
    event_city: value.city || null,
    venue: value.venue || null,
    guests: value.guests,
    budget_grosze: value.budget_grosze,
    message: value.message,
    custom_fields: value.custom_fields,
    utm: value.utm,
    page_url: value.page_url || null,
    referrer: value.referrer || null,
  };
}

export async function ingestLead(
  input: unknown,
  context: IngestContext,
  repository: IngestRepository,
) {
  const lead = normalizeLead(input);
  z.uuid().parse(context.organizationId);
  if (context.channelId !== null) z.uuid().parse(context.channelId);
  return repository.saveLead(context, lead);
}
