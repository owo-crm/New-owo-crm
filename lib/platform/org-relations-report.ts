import type { Database } from "../db/core.ts";

/**
 * M1.2 — отчёт классификации организаций (docs/architecture/OWO_CRM_MIGRATION_PLAN.md, D-02).
 *
 * ТОЛЬКО ЧТЕНИЕ. Ничего не записывает и не меняет: результат — предложение для владельца.
 * Правила (D-02, пересмотрено 2026-11-18; Stripe — не критерий, D-23):
 *  - кабинет агентства — не классифицируется;
 *  - Barowo (фирма Ивана) — `service`; конкретную организацию владелец подтверждает по id;
 *  - тестовая организация — без связи;
 *  - связь создана ЯВНО (created_by указан: «Nowy biznes», мастер «Utwórz CRM klienta», из лида) —
 *    `client`: создание бизнеса через OWO само является явным действием;
 *  - связь создана СТАРОЙ автопривязкой при старте (linkBusinessesToAgency, без created_by) —
 *    `decide`: решает владелец (в отчёте — заказы, выплаты, сервисный доступ);
 *  - связи нет, но есть сервисный доступ OWO — `service`; иначе — без связи.
 * Stripe-события и заказы со stripe_invoice_id выводятся только как история.
 */

export type Proposal = "client" | "service" | "none" | "agency" | "decide";

export type OrgRelationRow = {
  organization_id: string;
  name: string;
  industry_preset: string;
  created_at: string;
  members: { name: string; role: string; is_service: boolean }[];
  agency_client: null | {
    id: string;
    status: string;
    started_at: string | null;
    created_at: string;
    created_by: string | null;
    from_lead: boolean;
    likely_created_by: string;
  };
  billing: null | {
    status: string;
    stripe_customer: boolean;
    stripe_subscription: boolean;
    monthly_net_grosze: number;
    ad_client: boolean;
  };
  stripe_events: { paid: number; failed: number; other: number };
  orders: {
    total: number;
    by_status: Record<string, { n: number; grosze: number }>;
    paid_grosze: number;
    stripe_invoices: number;
    manual_paid: number;
    months_paid: string[];
  };
  payouts_in_paid_months: { month: string; grosze: number }[];
  proposal: Proposal;
  confirm_required: boolean;
  reasons: string[];
};

const BAROWO = /barowo/i;
const TEST = /\b(test|e2e|demo|próbn|probn)/i;

export async function orgRelationsReport(db: Database): Promise<OrgRelationRow[]> {
  const orgs = await db.query<{
    id: string;
    name: string;
    industry_preset: string;
    created_at: string;
  }>(
    "select id, name, industry_preset, created_at::text from public.organizations order by created_at",
  );
  const out: OrgRelationRow[] = [];
  for (const o of orgs.rows) {
    const members = (
      await db.query<{ name: string; role: string; is_service: boolean }>(
        `select coalesce(nullif(m.display_name,''), nullif(p.full_name,''), u.email, m.user_id::text) as name,
                m.role::text as role, m.is_service
           from public.memberships m
           left join public.profiles p on p.user_id = m.user_id
           left join auth.users u on u.id = m.user_id
          where m.organization_id = $1 order by m.role, name`,
        [o.id],
      )
    ).rows;
    const ac = (
      await db.query<{
        id: string;
        status: string;
        started_at: string | null;
        created_at: string;
        created_by: string | null;
        lead_id: string | null;
        org_created: string;
      }>(
        `select ac.id, ac.status, ac.started_at::text, ac.created_at::text, ac.created_by, ac.lead_id,
                (c.created_at at time zone 'Europe/Warsaw')::date::text as org_created
           from public.agency_clients ac join public.organizations c on c.id = ac.client_org_id
          where ac.client_org_id = $1 order by ac.created_at limit 1`,
        [o.id],
      )
    ).rows[0];
    const billing = (
      await db.query<{
        status: string;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        monthly_net_grosze: number;
        ad_client: boolean;
      }>(
        `select status, stripe_customer_id, stripe_subscription_id, monthly_net_grosze::int, ad_client
           from public.organization_billing where organization_id = $1`,
        [o.id],
      )
    ).rows[0];
    const ev = (
      await db.query<{ paid: number; failed: number; other: number }>(
        `select count(*) filter (where type = 'invoice.paid')::int as paid,
                count(*) filter (where type = 'invoice.payment_failed')::int as failed,
                count(*) filter (where type not in ('invoice.paid','invoice.payment_failed'))::int as other
           from public.billing_events where organization_id = $1`,
        [o.id],
      )
    ).rows[0];
    const orders = (
      await db.query<{
        status: string;
        n: number;
        grosze: number;
        stripe: number;
        manual_paid: number;
      }>(
        `select ao.status, count(*)::int as n, coalesce(sum(ao.amount_grosze),0)::bigint as grosze,
                count(ao.stripe_invoice_id)::int as stripe,
                count(*) filter (where ao.status = 'paid' and ao.stripe_invoice_id is null)::int as manual_paid
           from public.agency_orders ao join public.agency_clients ac
             on ac.organization_id = ao.organization_id and ac.id = ao.client_id
          where ac.client_org_id = $1 group by ao.status`,
        [o.id],
      )
    ).rows;
    const months = (
      await db.query<{ month: string }>(
        `select distinct to_char(ao.period_month,'YYYY-MM') as month
           from public.agency_orders ao join public.agency_clients ac
             on ac.organization_id = ao.organization_id and ac.id = ao.client_id
          where ac.client_org_id = $1 and ao.status = 'paid' order by 1`,
        [o.id],
      )
    ).rows.map((r) => r.month);
    // Выплаты партнёрам считаются по месяцам, не по заказам: показываем выплаты агентства
    // в месяцах, где у этой организации есть оплаченные заказы (возможная связь — проверить вручную).
    const payouts = months.length
      ? (
          await db.query<{ month: string; grosze: number }>(
            `select to_char(p.period_month,'YYYY-MM') as month, sum(p.amount_grosze)::bigint as grosze
               from public.agency_payouts p
              where p.organization_id = (select organization_id from public.agency_clients where client_org_id = $1 order by created_at limit 1)
                and to_char(p.period_month,'YYYY-MM') = any($2::text[])
              group by 1 order by 1`,
            [o.id, months],
          )
        ).rows.map((r) => ({ month: r.month, grosze: Number(r.grosze) }))
      : [];

    const byStatus = Object.fromEntries(
      orders.map((r) => [r.status, { n: r.n, grosze: Number(r.grosze) }]),
    );
    const paidGrosze = byStatus.paid?.grosze ?? 0;
    const stripeInvoices = orders.reduce((s, r) => s + r.stripe, 0);
    const manualPaid = orders.reduce((s, r) => s + r.manual_paid, 0);

    let likely = "brak";
    if (ac)
      likely = ac.lead_id
        ? "z leada agencji (przycisk «Dodaj klienta agencji»)"
        : ac.created_by
          ? "ręcznie / «Nowy biznes» (created_by ustawione)"
          : ac.started_at === ac.org_created
            ? "automatycznie — linkBusinessesToAgency (brak created_by, start = data utworzenia firmy)"
            : "nieznany (brak created_by)";

    const reasons: string[] = [];
    let proposal: Proposal;
    let confirm = false;
    if (o.industry_preset === "agency") {
      proposal = "agency";
      reasons.push("Kabinet agencji — nie klasyfikowany.");
    } else if (BAROWO.test(o.name)) {
      proposal = "service";
      reasons.push("Barowo — firma Ivana, nie klient OWO Ads (decyzja właściciela, D-02).");
      if (paidGrosze || stripeInvoices)
        reasons.push(
          "UWAGA: istnieją zamówienia agencji dla tej firmy — do raportu finansowego Barowo (M1.5).",
        );
    } else if (TEST.test(o.name)) {
      proposal = "none";
      reasons.push("Nazwa wskazuje na firmę testową.");
    } else if (ac && (ac.created_by || ac.lead_id)) {
      proposal = "client";
      reasons.push(
        `Związek utworzony jawnie (${likely}) — nowy biznes założony przez OWO jest klientem (D-02).`,
      );
    } else if (ac) {
      proposal = "decide";
      confirm = true;
      reasons.push(
        `Wpis w agency_clients pochodzi ze starego automatycznego przypisania (${likely}) — decyzja właściciela: client / service / brak.`,
      );
      if (members.some((m) => m.is_service))
        reasons.push(
          "Zespół OWO ma dostęp serwisowy — bez decyzji proponowane minimum: «service».",
        );
    } else if (members.some((m) => m.is_service)) {
      proposal = "service";
      reasons.push("Brak wpisu w agency_clients; zespół OWO ma dostęp serwisowy.");
    } else {
      proposal = "none";
      reasons.push("Brak wpisu w agency_clients i dostępu serwisowego OWO.");
    }
    if (stripeInvoices || manualPaid || paidGrosze)
      reasons.push(
        `Historia (informacyjnie, nie kryterium): opłacone zamówienia agencji ${paidGrosze / 100} zł, w tym faktury Stripe: ${stripeInvoices}, ręczne: ${manualPaid}.`,
      );
    if (billing && billing.status !== "none")
      reasons.push(`Historia Stripe (informacyjnie): status subskrypcji «${billing.status}».`);

    out.push({
      organization_id: o.id,
      name: o.name,
      industry_preset: o.industry_preset,
      created_at: o.created_at,
      members,
      agency_client: ac
        ? {
            id: ac.id,
            status: ac.status,
            started_at: ac.started_at,
            created_at: ac.created_at,
            created_by: ac.created_by,
            from_lead: Boolean(ac.lead_id),
            likely_created_by: likely,
          }
        : null,
      billing: billing
        ? {
            status: billing.status,
            stripe_customer: Boolean(billing.stripe_customer_id),
            stripe_subscription: Boolean(billing.stripe_subscription_id),
            monthly_net_grosze: Number(billing.monthly_net_grosze),
            ad_client: billing.ad_client,
          }
        : null,
      stripe_events: ev,
      orders: {
        total: orders.reduce((s, r) => s + r.n, 0),
        by_status: byStatus,
        paid_grosze: paidGrosze,
        stripe_invoices: stripeInvoices,
        manual_paid: manualPaid,
        months_paid: months,
      },
      payouts_in_paid_months: payouts,
      proposal,
      confirm_required: confirm,
      reasons,
    });
  }
  return out;
}
