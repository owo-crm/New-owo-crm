/**
 * M1.2 · отчёт классификации организаций (D-02). ТОЛЬКО ЧТЕНИЕ: транзакция `read only`,
 * ничего не записывает и не меняет классификацию. Логика — lib/platform/org-relations-report.ts.
 *
 * Запуск: npm run report:org-relations            (текст)
 *         npm run report:org-relations -- --json  (JSON для архива/проверки)
 */
import pg from "pg";
import { orgRelationsReport } from "../lib/platform/org-relations-report.ts";
import type { Database } from "../lib/db/core.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Brak DATABASE_URL");
  process.exit(1);
}
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
const db: Database = {
  query: (sql: string, params?: unknown[]) => client.query(sql, params) as never,
  transaction: () => {
    throw new Error("read-only report");
  },
};
try {
  await client.query("begin transaction read only");
  const rows = await orgRelationsReport(db);
  await client.query("rollback");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2));
  } else {
    const zl = (g: number) => `${(g / 100).toFixed(2)} zł`;
    console.log(`Raport klasyfikacji organizacji (M1.2) — ${new Date().toISOString()}`);
    console.log("TYLKO PODGLĄD: nic nie zostało zapisane. Listę «client» zatwierdza właściciel.\n");
    for (const r of rows) {
      const label = r.proposal + (r.confirm_required ? " (do potwierdzenia)" : "");
      console.log(`■ ${r.name}  [${r.industry_preset}]  → ${label}`);
      console.log(
        `  członkowie: ${r.members.map((m) => `${m.name} (${m.role}${m.is_service ? ", serwis" : ""})`).join(", ") || "—"}`,
      );
      console.log(
        `  agency_clients: ${r.agency_client ? `${r.agency_client.status}, ${r.agency_client.likely_created_by}` : "brak"}`,
      );
      console.log(
        `  billing: ${r.billing ? `${r.billing.status}, subskrypcja ${r.billing.stripe_subscription ? "tak" : "nie"}, ${zl(r.billing.monthly_net_grosze)}/mies.` : "brak"}; zdarzenia Stripe: opłacone ${r.stripe_events.paid}, nieudane ${r.stripe_events.failed}`,
      );
      const st = Object.entries(r.orders.by_status)
        .map(([s, v]) => `${s} ${v.n} · ${zl(v.grosze)}`)
        .join(", ");
      console.log(
        `  zamówienia agencji: ${r.orders.total}${st ? ` (${st})` : ""}; faktury Stripe: ${r.orders.stripe_invoices}; miesiące opłacone: ${r.orders.months_paid.join(", ") || "—"}`,
      );
      if (r.payouts_in_paid_months.length)
        console.log(
          `  wypłaty partnerów w tych miesiącach: ${r.payouts_in_paid_months.map((p) => `${p.month} ${zl(p.grosze)}`).join(", ")}`,
        );
      for (const reason of r.reasons) console.log(`  · ${reason}`);
      console.log("");
    }
  }
} finally {
  await client.end();
}
