import type { Database } from "../db/core.ts";

/**
 * M1.5 — финансовый отчёт по Barowo (docs/architecture/OWO_CRM_MIGRATION_PLAN.md M1.5, D-02).
 *
 * ТОЛЬКО ЧТЕНИЕ. Ничего не меняет: фиксирует фактическую картину и ПРЕДЛАГАЕТ действие по
 * каждому заказу согласно правилам владельца. Корректировки выполняются отдельно, после
 * утверждения.
 *
 * Barowo определяется явно — организация со связью platform_managed_orgs.relation = 'service'
 * (утверждено в M1.3), а не по имени.
 *
 * Правила предложений (утверждены владельцем):
 *  - draft (неоплаченный черновик)         → отменить с пояснением и записью в audit_log;
 *  - invoiced (выставлен, не оплачен)      → проверить реальный внешний счёт; без счёта — отменить;
 *  - paid                                  → сохранить исходные суммы и историю; если участвовал в
 *                                            распределении — при необходимости компенсирующая запись;
 *  - cancelled                             → без действий;
 *  - выплаченные суммы не пересчитываются автоматически, закрытые периоды не переписываются.
 */

export type SplitLine = { user: string | null; role: string; amount_grosze: number };

export type BarowoOrder = {
  id: string;
  title: string;
  kind: string;
  status: string;
  period_month: string;
  amount_grosze: number;
  direct_costs_grosze: number;
  ad_budget_grosze: number;
  due_date: string | null;
  paid_at: string | null;
  stripe_invoice_id: string | null;
  service: string | null;
  repeated_from: string | null;
  created_at: string;
  costs: { label: string; amount_grosze: number; paid_to: string | null }[];
  split: SplitLine[];
  closed_period: boolean;
  payouts_in_month: { user: string; amount_grosze: number }[];
  proposal: string;
  reasons: string[];
};

export type BarowoFinanceReport = {
  organization: { id: string; name: string } | null;
  agency: { id: string; name: string } | null;
  relation: string | null;
  agency_clients: {
    id: string;
    status: string;
    created_by: string | null;
    started_at: string | null;
  }[];
  orders: BarowoOrder[];
  totals: {
    orders: number;
    by_status: Record<string, { n: number; grosze: number }>;
    paid_grosze: number;
    paid_from_stripe_grosze: number;
    distributed: { role: string; user: string | null; amount_grosze: number }[];
    company_fund_grosze: number;
  };
  months: {
    month: string;
    barowo_paid_grosze: number;
    agency_paid_grosze: number;
    share_pct: number;
    payouts_grosze: number;
  }[];
  warnings: string[];
};

const userName = (db: Database) => async (id: string | null) => {
  if (!id) return null;
  const r = await db.query<{ n: string }>(
    `select coalesce(nullif(p.full_name,''), u.email, u.id::text) as n
       from auth.users u left join public.profiles p on p.user_id = u.id where u.id = $1`,
    [id],
  );
  return r.rows[0]?.n ?? id;
};

export async function barowoFinanceReport(
  db: Database,
  today = new Date(),
): Promise<BarowoFinanceReport> {
  const name = userName(db);
  const warnings: string[] = [];
  const rel = (
    await db.query<{
      org_id: string;
      org_name: string;
      agency_id: string;
      agency_name: string;
      relation: string;
    }>(
      `select p.org_id, o.name as org_name, p.agency_org_id as agency_id, a.name as agency_name, p.relation
         from public.platform_managed_orgs p
         join public.organizations o on o.id = p.org_id
         join public.organizations a on a.id = p.agency_org_id
        where p.relation = 'service' order by p.approved_at`,
    )
  ).rows;
  if (rel.length !== 1)
    warnings.push(
      `Oczekiwano dokładnie jednej organizacji «service» (Barowo), znaleziono: ${rel.length}.`,
    );
  const b = rel[0];
  const empty: BarowoFinanceReport = {
    organization: null,
    agency: null,
    relation: null,
    agency_clients: [],
    orders: [],
    totals: {
      orders: 0,
      by_status: {},
      paid_grosze: 0,
      paid_from_stripe_grosze: 0,
      distributed: [],
      company_fund_grosze: 0,
    },
    months: [],
    warnings,
  };
  if (!b) return empty;

  const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" })
    .format(today)
    .slice(0, 7);

  const clients = (
    await db.query<{
      id: string;
      status: string;
      created_by: string | null;
      started_at: string | null;
    }>(
      `select id, status, created_by, started_at::text from public.agency_clients
        where organization_id = $1 and client_org_id = $2 order by created_at`,
      [b.agency_id, b.org_id],
    )
  ).rows;

  const rows = (
    await db.query<{
      id: string;
      title: string;
      kind: string;
      status: string;
      period_month: string;
      amount_grosze: string;
      direct_costs_grosze: string;
      ad_budget_grosze: string;
      due_date: string | null;
      paid_at: string | null;
      stripe_invoice_id: string | null;
      service: string | null;
      repeated_from: string | null;
      created_at: string;
    }>(
      `select o.id, o.title, o.kind, o.status, to_char(o.period_month,'YYYY-MM') as period_month,
              o.amount_grosze, o.direct_costs_grosze, o.ad_budget_grosze, o.due_date::text,
              o.paid_at::text, o.stripe_invoice_id, s.name as service, o.repeated_from, o.created_at::text
         from public.agency_orders o
         join public.agency_clients c on c.organization_id = o.organization_id and c.id = o.client_id
         left join public.agency_services s on s.organization_id = o.organization_id and s.id = o.service_id
        where o.organization_id = $1 and c.client_org_id = $2
        order by o.period_month, o.created_at`,
      [b.agency_id, b.org_id],
    )
  ).rows;

  const orders: BarowoOrder[] = [];
  for (const r of rows) {
    const costs = await Promise.all(
      (
        await db.query<{ label: string; amount_grosze: string; paid_to: string | null }>(
          "select label, amount_grosze, paid_to from public.agency_order_costs where organization_id=$1 and order_id=$2 order by created_at",
          [b.agency_id, r.id],
        )
      ).rows.map(async (c) => ({
        label: c.label,
        amount_grosze: Number(c.amount_grosze),
        paid_to: await name(c.paid_to),
      })),
    );
    const split: SplitLine[] =
      r.status === "paid"
        ? await Promise.all(
            (
              await db.query<{ user_id: string | null; role: string; amount_grosze: string }>(
                "select user_id, role, amount_grosze from public.agency_order_split($1,$2) order by role, user_id nulls first",
                [b.agency_id, r.id],
              )
            ).rows.map(async (s) => ({
              user: await name(s.user_id),
              role: s.role,
              amount_grosze: Number(s.amount_grosze),
            })),
          )
        : [];
    const payouts = await Promise.all(
      (
        await db.query<{ user_id: string; total: string }>(
          `select user_id, sum(amount_grosze) as total from public.agency_payouts
            where organization_id=$1 and to_char(period_month,'YYYY-MM') = $2 group by user_id`,
          [b.agency_id, r.period_month],
        )
      ).rows.map(async (p) => ({
        user: (await name(p.user_id)) ?? p.user_id,
        amount_grosze: Number(p.total),
      })),
    );
    const closed = r.period_month < currentMonth || payouts.length > 0;
    const reasons: string[] = [];
    let proposal: string;
    if (r.status === "draft") {
      proposal = "Anulować (status cancelled + notatka + audit_log)";
      reasons.push("Szkic bez płatności — Barowo nie jest klientem agencji.");
    } else if (r.status === "invoiced") {
      proposal = r.stripe_invoice_id
        ? "Sprawdzić fakturę Stripe (subskrypcje anulowane w S2) → jeśli nieważna: anulować z notatką"
        : "Sprawdzić, czy istnieje realna faktura zewnętrzna → jeśli nie: anulować z notatką";
      reasons.push("Wystawione, nieopłacone — decyzja zależy od istnienia faktury.");
    } else if (r.status === "paid") {
      proposal = split.length
        ? "Zachować bez zmian; ewentualnie osobny wpis kompensujący (do decyzji właściciela)"
        : "Zachować bez zmian";
      reasons.push(
        r.stripe_invoice_id
          ? `Opłacone przez Stripe (faktura ${r.stripe_invoice_id}).`
          : "Opłacone ręcznie.",
      );
      if (split.length) reasons.push("Uczestniczyło w podziale 10/25/65 tego miesiąca.");
      if (payouts.length)
        reasons.push("W tym miesiącu są wypłaty partnerów — nie przeliczać automatycznie.");
    } else {
      proposal = "Bez działań";
      reasons.push("Zamówienie już anulowane.");
    }
    if (closed) reasons.push("Okres zamknięty (miniony miesiąc lub wypłaty) — nie przepisywać.");
    orders.push({
      id: r.id,
      title: r.title,
      kind: r.kind,
      status: r.status,
      period_month: r.period_month,
      amount_grosze: Number(r.amount_grosze),
      direct_costs_grosze: Number(r.direct_costs_grosze),
      ad_budget_grosze: Number(r.ad_budget_grosze),
      due_date: r.due_date,
      paid_at: r.paid_at,
      stripe_invoice_id: r.stripe_invoice_id,
      service: r.service,
      repeated_from: r.repeated_from,
      created_at: r.created_at,
      costs,
      split,
      closed_period: closed,
      payouts_in_month: payouts,
      proposal,
      reasons,
    });
  }

  const byStatus: Record<string, { n: number; grosze: number }> = {};
  for (const o of orders) {
    byStatus[o.status] ??= { n: 0, grosze: 0 };
    byStatus[o.status].n++;
    byStatus[o.status].grosze += o.amount_grosze;
  }
  const paid = orders.filter((o) => o.status === "paid");
  const distributedMap = new Map<
    string,
    { role: string; user: string | null; amount_grosze: number }
  >();
  for (const s of paid.flatMap((o) => o.split)) {
    const k = `${s.role}|${s.user}`;
    const cur = distributedMap.get(k) ?? { role: s.role, user: s.user, amount_grosze: 0 };
    cur.amount_grosze += s.amount_grosze;
    distributedMap.set(k, cur);
  }
  const distributed = [...distributedMap.values()];

  const monthList = [...new Set(paid.map((o) => o.period_month))].sort();
  const months = [];
  for (const m of monthList) {
    const agencyPaid = Number(
      (
        await db.query<{ s: string }>(
          `select coalesce(sum(amount_grosze),0) as s from public.agency_orders
            where organization_id=$1 and status='paid' and to_char(period_month,'YYYY-MM')=$2`,
          [b.agency_id, m],
        )
      ).rows[0].s,
    );
    const payoutsTotal = Number(
      (
        await db.query<{ s: string }>(
          `select coalesce(sum(amount_grosze),0) as s from public.agency_payouts
            where organization_id=$1 and to_char(period_month,'YYYY-MM')=$2`,
          [b.agency_id, m],
        )
      ).rows[0].s,
    );
    const barowoPaid = paid
      .filter((o) => o.period_month === m)
      .reduce((s, o) => s + o.amount_grosze, 0);
    months.push({
      month: m,
      barowo_paid_grosze: barowoPaid,
      agency_paid_grosze: agencyPaid,
      share_pct: agencyPaid ? Math.round((barowoPaid / agencyPaid) * 1000) / 10 : 0,
      payouts_grosze: payoutsTotal,
    });
  }
  if (!orders.length)
    warnings.push("Brak zamówień agencji dla Barowo — korekty M1.5 nie są potrzebne.");

  return {
    organization: { id: b.org_id, name: b.org_name },
    agency: { id: b.agency_id, name: b.agency_name },
    relation: b.relation,
    agency_clients: clients,
    orders,
    totals: {
      orders: orders.length,
      by_status: byStatus,
      paid_grosze: paid.reduce((s, o) => s + o.amount_grosze, 0),
      paid_from_stripe_grosze: paid
        .filter((o) => o.stripe_invoice_id)
        .reduce((s, o) => s + o.amount_grosze, 0),
      distributed,
      company_fund_grosze: distributed
        .filter((d) => d.role === "company")
        .reduce((s, d) => s + d.amount_grosze, 0),
    },
    months,
    warnings,
  };
}
