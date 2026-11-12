import "server-only";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/** Данные для графиков на «Pulpit»: поток заявок, источники и занятость сезона. */

const schema = z.object({
  months: z.object({ month: z.string(), leads: z.number(), won: z.number() }).array(),
  sources: z.object({ source: z.string(), leads: z.number() }).array(),
  ahead: z
    .object({ month: z.string(), confirmed: z.number(), tentative: z.number() })
    .array(),
});

export type DashboardCharts = z.infer<typeof schema>;

export async function getDashboardCharts(): Promise<DashboardCharts> {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<{ data: unknown }>(
      "select public.dashboard_charts($1) as data",
      [organization.id],
    );
    return schema.parse(rows[0]?.data ?? { months: [], sources: [], ahead: [] });
  });
}
