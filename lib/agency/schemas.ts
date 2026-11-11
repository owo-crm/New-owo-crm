import { z } from "zod";

/**
 * Проверка данных кабинета агентства. Общая для формы (браузер) и сервера.
 * Деньги приходят уже в грошах (целые числа), часы — числом с точностью до 0,01.
 */
export const ORDER_KINDS = ["retainer", "project"] as const;
export const ORDER_STATUSES = ["draft", "invoiced", "paid", "cancelled"] as const;
export const CLIENT_STATUSES = ["lead", "active", "paused", "lost"] as const;

export type OrderKind = (typeof ORDER_KINDS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

const grosze = z.number().int().min(0).max(10_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const workLineSchema = z.object({
  userId: z.uuid(),
  hours: z
    .number()
    .gt(0)
    .max(500)
    .refine((h) => Math.abs(h * 100 - Math.round(h * 100)) < 1e-6, "hours_precision"),
  note: z.string().trim().max(500).optional().default(""),
});

export const orderInputSchema = z
  .object({
    id: z.uuid().optional(),
    clientId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(ORDER_KINDS),
    amountGrosze: grosze,
    directCostsGrosze: grosze,
    adBudgetGrosze: grosze,
    /** Продавцы и доли комиссии 10 % (в базисных пунктах, сумма ≤ 10 000). */
    sellers: z
      .object({ userId: z.uuid(), shareBp: z.number().int().min(1).max(10000) })
      .array()
      .max(10),
    /** Основа распределения 65 %: часы или согласованные баллы вклада. */
    workBasis: z.enum(["hours", "points"]),
    /** Прямые расходы строками; сумма = directCostsGrosze. paidTo — партнёр (например, логистика). */
    costs: z
      .object({
        label: z.string().trim().min(1).max(200),
        amountGrosze: z.number().int().min(1).max(10_000_000_000),
        paidTo: z.uuid().nullable(),
      })
      .array()
      .max(30),
    periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
    status: z.enum(ORDER_STATUSES),
    dueDate: isoDate.nullable(),
    note: z.string().trim().max(4000).optional().default(""),
    work: workLineSchema.array().max(30),
  })
  .refine((o) => o.directCostsGrosze <= o.amountGrosze, {
    path: ["directCostsGrosze"],
    message: "costs_over_amount",
  })
  .refine((o) => o.sellers.reduce((sum, x) => sum + x.shareBp, 0) <= 10000, {
    path: ["sellers"],
    message: "shares_over_100",
  })
  .refine((o) => new Set(o.sellers.map((x) => x.userId)).size === o.sellers.length, {
    path: ["sellers"],
    message: "duplicate_seller",
  })
  .refine(
    (o) =>
      o.costs.length === 0 ||
      o.costs.reduce((sum, c) => sum + c.amountGrosze, 0) === o.directCostsGrosze,
    {
      path: ["costs"],
      message: "costs_sum",
    },
  )
  .refine((o) => new Set(o.work.map((w) => w.userId)).size === o.work.length, {
    path: ["work"],
    message: "duplicate_worker",
  });
export type OrderInput = z.infer<typeof orderInputSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const clientInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  nip: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^\d{10}$/)]))
    .transform((v) => (v === "" ? null : v)),
  contactName: optionalText(200),
  phone: optionalText(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.union([z.literal(""), z.email().max(254)]))
    .transform((v) => (v === "" ? null : v)),
  city: optionalText(120),
  status: z.enum(CLIENT_STATUSES),
  startedAt: z.union([z.literal(""), isoDate]).transform((v) => (v === "" ? null : v)),
  note: optionalText(4000),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

/** «12,5» / «12.5» → 12.5 часа; пусто или мусор → NaN. */
export function parseHours(text: string) {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  return /^\d{1,3}(\.\d{1,2})?$/.test(clean) ? Number(clean) : Number.NaN;
}

/** Текст суммы в форме → гроши; пустое поле = 0, ошибка = NaN (форма подсветит поле). */
export function parseMoneyField(text: string) {
  const clean = text.replace(/\s/g, "").replace(",", ".").replace(/zł$/i, "");
  if (clean === "") return 0;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
}

/** Гроши → «1234,50» для поля ввода (без валюты и пробелов). */
export function moneyFieldValue(grosze: number) {
  if (!grosze) return "";
  const zl = Math.trunc(grosze / 100);
  const gr = grosze % 100;
  return gr ? `${zl},${String(gr).padStart(2, "0")}` : String(zl);
}
