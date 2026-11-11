import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/auth/session";
import { withOrg } from "@/lib/db/user";
import { one, type Queryable } from "@/lib/db";
import { isAgency } from "@/lib/presets";
import { DEFAULT_SHARES, totalsBySplit, type Shares, type SplitLine } from "./split";
import type { ClientInput, ClientStatus, OrderInput, OrderKind, OrderStatus } from "./schemas";

/**
 * Чтение и запись кабинета агентства. Всё — через withOrg (RLS): чужая фирма ничего не увидит,
 * даже если здесь забыть фильтр. Формула раздела — в SQL (agency_order_split).
 */

/** Экраны /agencja открываются только в организации с пресетом agency. */
export async function requireAgency() {
  const ctx = await requireOrganization();
  if (!isAgency(ctx.organization.industryPreset)) notFound();
  return ctx;
}

/** withOrg + проверка пресета: запросы кабинета агентства. */
async function withAgency<T>(fn: Parameters<typeof withOrg<T>>[0]) {
  await requireAgency();
  return withOrg(fn);
}

export type Member = { userId: string; name: string };

async function members(tx: Queryable, org: string): Promise<Member[]> {
  const { rows } = await tx.query<{ user_id: string; name: string | null; login: string }>(
    "select user_id, name, login from public.team_members($1) order by coalesce(name, login)",
    [org],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name || r.login }));
}

async function shares(tx: Queryable, org: string): Promise<Shares> {
  const row = await one<{ s: number; c: number; w: number }>(
    tx,
    `select agency_share_sale_bp as s, agency_share_company_bp as c, agency_share_work_bp as w
     from public.organizations where id=$1`,
    [org],
  );
  return row ? { saleBp: row.s, companyBp: row.c, workBp: row.w } : DEFAULT_SHARES;
}

export type ClientOption = { id: string; name: string; status: ClientStatus };

/** Всё, что нужно форме заказа: клиенты, люди, доли. */
export const getOrderFormData = cache(async () =>
  withAgency(async (tx, { organization, user }) => {
    const { rows: clients } = await tx.query<ClientOption>(
      `select id, name, status from public.agency_clients where organization_id=$1
       order by case status when 'active' then 0 when 'lead' then 1 when 'paused' then 2 else 3 end, name`,
      [organization.id],
    );
    return {
      clients,
      members: await members(tx, organization.id),
      shares: await shares(tx, organization.id),
      currentUserId: user.id,
    };
  }),
);

// ───────── Сводка «мозга» ─────────

const n = z.coerce.number();
const summarySchema = z.object({
  month: z.string(),
  invoiced_grosze: n,
  received_grosze: n,
  expected_grosze: n,
  overdue_grosze: n,
  direct_costs_grosze: n,
  ad_budget_grosze: n,
  split: z
    .object({
      user_id: z.string().nullable(),
      role: z.enum(["sale", "work", "company"]),
      amount_grosze: n,
    })
    .array(),
  overdue: z
    .object({
      id: z.string(),
      client_id: z.string(),
      client_name: z.string(),
      title: z.string(),
      amount_grosze: n,
      due_date: z.string(),
    })
    .array(),
  clients: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["lead", "active", "paused", "lost"]),
      client_org_id: z.string().nullable(),
      created_at: z.string(),
      month_grosze: n,
      month_orders: n,
      last_activity: z.string().nullable(),
    })
    .array(),
});

export type ClientRow = z.infer<typeof summarySchema>["clients"][number] & {
  setupDone: number;
  setupTotal: number;
};

/** Нерассчитанная настройка старше этого срока попадает в «Wymaga uwagi». */
export const SETUP_STALE_DAYS = 14;

export const getAgencySummary = cache(async (month: string) =>
  withAgency(async (tx, { organization }) => {
    const row = await one<{ d: unknown }>(tx, "select public.agency_summary($1,$2) as d", [
      organization.id,
      month,
    ]);
    const data = summarySchema.parse(row?.d);
    const { rows: setup } = await tx.query<{ client_id: string; done: number; total: number }>(
      `select client_id, count(done_at)::int as done, count(*)::int as total
       from public.agency_setup_status($1) group by client_id`,
      [organization.id],
    );
    const progress = new Map(setup.map((s) => [s.client_id, s]));
    const people = await members(tx, organization.id);
    const names = new Map(people.map((p) => [p.userId, p.name]));

    const lines: SplitLine[] = data.split.map((s) => ({
      userId: s.user_id,
      role: s.role,
      amountGrosze: s.amount_grosze,
    }));
    const totals = totalsBySplit(lines);

    const clients: ClientRow[] = data.clients.map((c) => ({
      ...c,
      setupDone: progress.get(c.id)?.done ?? 0,
      setupTotal: progress.get(c.id)?.total ?? 0,
    }));

    const staleBefore = Date.now() - SETUP_STALE_DAYS * 86_400_000;
    const attention = {
      overdue: data.overdue,
      // Активные клиенты без заказов в этом месяце (абонемент забыли выставить?).
      noOrders: clients.filter((c) => c.status === "active" && c.month_orders === 0),
      // Настройка CRM начата, но висит дольше двух недель.
      staleSetup: clients.filter(
        (c) =>
          c.status !== "lost" &&
          c.setupTotal > 0 &&
          c.setupDone < c.setupTotal &&
          new Date(c.created_at).getTime() < staleBefore,
      ),
    };

    return {
      ...data,
      totals,
      clients,
      attention,
      nameOf: (id: string) => names.get(id) ?? "—",
      // Сверка: раздел + прямые расходы = Получено (до гроша). Должно быть 0.
      reconciliation: data.received_grosze - totals.totalGrosze - data.direct_costs_grosze,
    };
  }),
);

// ───────── Карточка клиента ─────────

export type SetupStep = {
  key: string;
  auto: boolean;
  doneAt: string | null;
  doneBy: string | null;
  note: string | null;
};

export type OrderRow = {
  id: string;
  title: string;
  kind: OrderKind;
  amount_grosze: number;
  direct_costs_grosze: number;
  ad_budget_grosze: number;
  sold_by: string | null;
  period_month: string;
  status: OrderStatus;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  split: SplitLine[];
};

export type ClientDetails = {
  id: string;
  name: string;
  nip: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  client_org_id: string | null;
  client_org_name: string | null;
  lead_id: string | null;
  status: ClientStatus;
  started_at: string | null;
  note: string | null;
  created_at: string;
};

async function ordersWithSplit(tx: Queryable, org: string, where: string, params: unknown[]) {
  const { rows } = await tx.query<Omit<OrderRow, "split">>(
    `select id, title, kind, amount_grosze, direct_costs_grosze, ad_budget_grosze, sold_by,
            period_month::text as period_month, status, due_date::text as due_date, paid_at, created_at
     from public.agency_orders where organization_id=$1 and ${where}
     order by period_month desc, created_at desc`,
    [org, ...params],
  );
  const { rows: split } = await tx.query<{
    order_id: string;
    user_id: string | null;
    role: SplitLine["role"];
    amount_grosze: number;
  }>(
    `select o.id as order_id, s.user_id, s.role, s.amount_grosze
     from unnest($2::uuid[]) as o(id), public.agency_order_split($1, o.id) s`,
    [org, rows.map((r) => r.id)],
  );
  return rows.map((r) => ({
    ...r,
    amount_grosze: Number(r.amount_grosze),
    direct_costs_grosze: Number(r.direct_costs_grosze),
    ad_budget_grosze: Number(r.ad_budget_grosze),
    split: split
      .filter((s) => s.order_id === r.id)
      .map((s) => ({ userId: s.user_id, role: s.role, amountGrosze: Number(s.amount_grosze) })),
  }));
}

export const getClientCard = cache(async (id: string) =>
  withAgency(async (tx, { organization }) => {
    const client = await one<ClientDetails>(
      tx,
      `select c.id, c.name, c.nip, c.contact_name, c.phone, c.email, c.city, c.client_org_id,
              (select o.name from public.organizations o where o.id = c.client_org_id) as client_org_name,
              c.lead_id, c.status, c.started_at::text as started_at, c.note, c.created_at
       from public.agency_clients c where c.organization_id=$1 and c.id=$2`,
      [organization.id, id],
    );
    if (!client) return null;
    const { rows: steps } = await tx.query<{
      step_key: string;
      auto: boolean;
      done_at: string | null;
      done_by: string | null;
      note: string | null;
    }>(
      "select step_key, auto, done_at, done_by, note from public.agency_setup_status($1,$2) order by step_position",
      [organization.id, id],
    );
    const orders = await ordersWithSplit(tx, organization.id, "client_id=$2", [id]);
    const people = await members(tx, organization.id);
    return {
      client,
      steps: steps.map<SetupStep>((s) => ({
        key: s.step_key,
        auto: s.auto,
        doneAt: s.done_at,
        doneBy: s.done_by,
        note: s.note,
      })),
      orders,
      members: people,
    };
  }),
);

export const getOrder = cache(async (id: string) =>
  withAgency(async (tx, { organization }) => {
    const [order] = await ordersWithSplit(tx, organization.id, "id=$2", [id]);
    if (!order) return null;
    const row = await one<{ client_id: string; note: string | null }>(
      tx,
      "select client_id, note from public.agency_orders where organization_id=$1 and id=$2",
      [organization.id, id],
    );
    const { rows: work } = await tx.query<{ user_id: string; hours: string; note: string | null }>(
      "select user_id, hours::text as hours, note from public.agency_order_work where organization_id=$1 and order_id=$2 order by created_at, id",
      [organization.id, id],
    );
    return {
      ...order,
      client_id: row!.client_id,
      note: row!.note,
      work: work.map((w) => ({ userId: w.user_id, hours: Number(w.hours), note: w.note ?? "" })),
    };
  }),
);

// ───────── Запись ─────────

/** Создаёт или обновляет заказ вместе со строками часов (одна транзакция). */
export async function saveOrder(input: OrderInput) {
  return withAgency(async (tx, { organization, user }) => {
    const org = organization.id;
    const paid = input.status === "paid";
    const values = [
      org,
      input.clientId,
      input.title,
      input.kind,
      input.amountGrosze,
      input.directCostsGrosze,
      input.adBudgetGrosze,
      input.soldBy,
      `${input.periodMonth}-01`,
      input.status,
      input.dueDate,
      input.note || null,
    ];
    let id = input.id;
    if (id) {
      const row = await one<{ id: string }>(
        tx,
        `update public.agency_orders set client_id=$2, title=$3, kind=$4, amount_grosze=$5,
           direct_costs_grosze=$6, ad_budget_grosze=$7, sold_by=$8, period_month=$9::date, status=$10,
           due_date=$11::date, note=$12,
           paid_at = case when $10 = 'paid' then coalesce(paid_at, now()) end
         where organization_id=$1 and id=$13 returning id`,
        [...values, id],
      );
      if (!row) return null;
      await tx.query(
        "delete from public.agency_order_work where organization_id=$1 and order_id=$2",
        [org, id],
      );
    } else {
      const row = await one<{ id: string }>(
        tx,
        `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze,
           direct_costs_grosze, ad_budget_grosze, sold_by, period_month, status, due_date, note, paid_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11::date,$12, case when $13 then now() end, $14)
         returning id`,
        [...values, paid, user.id],
      );
      id = row!.id;
    }
    for (const w of input.work) {
      await tx.query(
        "insert into public.agency_order_work (organization_id, order_id, user_id, hours, note) values ($1,$2,$3,$4,$5)",
        [org, id, w.userId, w.hours.toFixed(2), w.note || null],
      );
    }
    return id;
  });
}

/** Быстрая смена статуса из списка: «Wystawiono», «Opłacono» (дата оплаты — сейчас). */
export async function setOrderStatus(id: string, status: OrderStatus) {
  return withAgency(async (tx, { organization }) => {
    const row = await one<{ client_id: string }>(
      tx,
      `update public.agency_orders set status=$3,
         paid_at = case when $3 = 'paid' then coalesce(paid_at, now()) end
       where organization_id=$1 and id=$2 returning client_id`,
      [organization.id, id, status],
    );
    return row?.client_id ?? null;
  });
}

export async function repeatRetainers(month: string) {
  return withAgency(async (tx, { organization }) => {
    const row = await one<{ n: number }>(
      tx,
      "select public.agency_repeat_retainers($1,$2::date) as n",
      [organization.id, `${month}-01`],
    );
    return row?.n ?? 0;
  });
}

export async function saveClient(input: ClientInput) {
  return withAgency(async (tx, { organization, user }) => {
    const values = [
      organization.id,
      input.name,
      input.nip,
      input.contactName,
      input.phone,
      input.email,
      input.city,
      input.status,
      input.startedAt,
      input.note,
    ];
    if (input.id) {
      const row = await one<{ id: string }>(
        tx,
        `update public.agency_clients set name=$2, nip=$3, contact_name=$4, phone=$5, email=$6, city=$7,
           status=$8, started_at=$9::date, note=$10
         where organization_id=$1 and id=$11 returning id`,
        [...values, input.id],
      );
      return row?.id ?? null;
    }
    const row = await one<{ id: string }>(
      tx,
      `insert into public.agency_clients (organization_id, name, nip, contact_name, phone, email, city, status,
         started_at, note, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11) returning id`,
      [...values, user.id],
    );
    return row!.id;
  });
}

/** Ручная отметка шага (только шаги без факта в базе — проверяет и база). */
export async function setSetupMark(clientId: string, step: string, done: boolean) {
  return withAgency(async (tx, { organization, user }) => {
    if (done) {
      await tx.query(
        `insert into public.agency_setup_marks (organization_id, client_id, step_key, done_by)
         values ($1,$2,$3,$4) on conflict do nothing`,
        [organization.id, clientId, step, user.id],
      );
    } else {
      await tx.query(
        "delete from public.agency_setup_marks where organization_id=$1 and client_id=$2 and step_key=$3",
        [organization.id, clientId, step],
      );
    }
  });
}

/** Привязать клиента к его организации в CRM (или отвязать: null). */
export async function linkClientOrg(clientId: string, orgId: string | null) {
  return withAgency(async (tx, { organization }) => {
    await tx.query(
      "update public.agency_clients set client_org_id=$3 where organization_id=$1 and id=$2",
      [organization.id, clientId, orgId],
    );
  });
}

export async function clientFromLead(leadId: string) {
  return withAgency(async (tx, { organization }) => {
    const row = await one<{ id: string }>(
      tx,
      "select public.agency_client_from_lead($1,$2) as id",
      [organization.id, leadId],
    );
    return row!.id;
  });
}

/** Клиент агентства, заведённый из этого лида (для кнопки в карточке лида). */
export async function clientIdForLead(leadId: string) {
  return withOrg(async (tx, { organization }) => {
    if (!isAgency(organization.industryPreset)) return null;
    const row = await one<{ id: string }>(
      tx,
      "select id from public.agency_clients where organization_id=$1 and lead_id=$2",
      [organization.id, leadId],
    );
    return row?.id ?? null;
  });
}
