import { z } from "zod";
export const leadFiltersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  stage: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,49}$/)
    .optional()
    .catch(undefined),
  source: z.uuid().optional().catch(undefined),
  assigned: z
    .union([z.uuid(), z.literal("unassigned")])
    .optional()
    .catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  view: z.enum(["list", "board"]).catch("list"),
  /** Быстрый фильтр: ждут ответа / мои / этот месяц. */
  quick: z.enum(["waiting", "mine", "month"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).catch(1),
});
export type LeadFilters = z.infer<typeof leadFiltersSchema>;
export function parseLeadFilters(params: Record<string, string | string[] | undefined>) {
  return leadFiltersSchema.parse(
    Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );
}
/** Адрес списка с изменёнными фильтрами (страница сбрасывается). */
export function leadFilterUrl(filters: LeadFilters, patch: Partial<LeadFilters>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...patch, page: 1 }))
    if (value && key !== "page") params.set(key, String(value));
  return `/leady${params.size ? `?${params}` : ""}`;
}
export function leadPageUrl(filters: LeadFilters, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page }))
    if (value) params.set(key, String(value));
  return `/leady?${params.toString()}`;
}
