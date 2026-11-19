/**
 * M1.5 · финансовый отчёт по Barowo. ТОЛЬКО ЧТЕНИЕ (транзакция `read only`): заказы агентства
 * по Barowo, распределения 10/25/65, выплаты, закрытые периоды и ПРЕДЛАГАЕМОЕ действие по каждому
 * заказу. Ничего не меняет — корректировки утверждает владелец отдельно.
 * Логика — lib/platform/barowo-finance-report.ts.
 *
 * Запуск: npm run report:barowo-finance            (текст)
 *         npm run report:barowo-finance -- --json  (JSON)
 */
import pg from "pg";
import { barowoFinanceReport } from "../lib/platform/barowo-finance-report.ts";
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
const zl = (g: number) => `${(g / 100).toFixed(2)} zł`;
try {
  await client.query("begin transaction read only");
  const r = await barowoFinanceReport(db);
  await client.query("rollback");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), ...r }, null, 2));
  } else {
    console.log(`Raport finansowy Barowo (M1.5) — ${new Date().toISOString()}`);
    console.log("TYLKO PODGLĄD: nic nie zostało zmienione. Korekty zatwierdza właściciel.\n");
    for (const w of r.warnings) console.log(`! ${w}`);
    if (!r.organization) process.exit(0);
    console.log(
      `Organizacja: ${r.organization.name} (${r.organization.id}) — relacja «${r.relation}» z ${r.agency?.name}`,
    );
    console.log(
      `agency_clients: ${r.agency_clients.map((c) => `${c.status}, created_by ${c.created_by ? "tak" : "brak"}`).join("; ") || "brak"}`,
    );
    console.log(
      `\nZamówienia: ${r.totals.orders} · ${
        Object.entries(r.totals.by_status)
          .map(([s, v]) => `${s} ${v.n} (${zl(v.grosze)})`)
          .join(", ") || "—"
      }`,
    );
    console.log(
      `Opłacone: ${zl(r.totals.paid_grosze)}, w tym ze Stripe: ${zl(r.totals.paid_from_stripe_grosze)}; do funduszu OWO Ads: ${zl(r.totals.company_fund_grosze)}`,
    );
    for (const d of r.totals.distributed)
      console.log(`  podział ${d.role} → ${d.user ?? "nierozdzielone"}: ${zl(d.amount_grosze)}`);
    for (const m of r.months)
      console.log(
        `  miesiąc ${m.month}: Barowo ${zl(m.barowo_paid_grosze)} z ${zl(m.agency_paid_grosze)} (${m.share_pct}%), wypłaty partnerów ${zl(m.payouts_grosze)}`,
      );
    for (const o of r.orders) {
      console.log(
        `\n■ ${o.period_month} · ${o.title} · ${o.status} · ${zl(o.amount_grosze)}${o.stripe_invoice_id ? ` · Stripe ${o.stripe_invoice_id}` : ""}${o.service ? ` · usługa ${o.service}` : ""}`,
      );
      if (o.costs.length)
        console.log(
          `  koszty: ${o.costs.map((c) => `${c.label} ${zl(c.amount_grosze)}${c.paid_to ? ` → ${c.paid_to}` : ""}`).join(", ")}`,
        );
      if (o.split.length)
        console.log(
          `  podział: ${o.split.map((s) => `${s.role} ${s.user ?? "nierozdz."} ${zl(s.amount_grosze)}`).join(", ")}`,
        );
      if (o.payouts_in_month.length)
        console.log(
          `  wypłaty w miesiącu: ${o.payouts_in_month.map((p) => `${p.user} ${zl(p.amount_grosze)}`).join(", ")}`,
        );
      console.log(`  → PROPOZYCJA: ${o.proposal}`);
      for (const x of o.reasons) console.log(`    · ${x}`);
    }
  }
} finally {
  await client.end();
}
