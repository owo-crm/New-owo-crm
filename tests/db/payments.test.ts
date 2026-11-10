import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

const OWNER = "70000000-0000-4000-8000-000000000001";
const OTHER = "70000000-0000-4000-8000-000000000002";
let db: PGlite;
let org: string;
let lead: string;

const plan = (rows: object[]) =>
  asUser(db, OWNER, () =>
    db.query("select public.set_contract_payments($1,$2,$3)", [org, lead, JSON.stringify(rows)]),
  );
const payments = () =>
  db
    .query<{ label: string; amount_grosze: number; paid_at: string | null; due_date: string }>(
      "select label, amount_grosze, paid_at, due_date::text from public.lead_payments where lead_id=$1 order by position",
      [lead],
    )
    .then((r) => r.rows);

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, OWNER);
  await createUser(db, OTHER);
  org = (
    await asUser(db, OWNER, () =>
      db.query<{ id: string }>("select public.create_organization('Barowo','pay-barowo') as id"),
    )
  ).rows[0].id;
  lead = (
    await db.query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, phone_e164, event_date, stage_key)
       values ($1,'Anna','+48600100200', current_date + 40, 'contract_sent') returning id`,
      [org],
    )
  ).rows[0].id;
});
afterAll(() => db.close());

const schedule = [
  { kind: "deposit", label: "Zaliczka rezerwacyjna", amount_grosze: 50000, due_date: "2027-01-10" },
  { kind: "deposit", label: "Druga zaliczka", amount_grosze: 100000, due_date: "2027-06-05" },
  {
    kind: "balance",
    label: "Wynagrodzenie końcowe",
    amount_grosze: 500000,
    due_date: "2027-06-12",
  },
];

describe("płatności", () => {
  it("umowa tworzy plan płatności", async () => {
    await plan(schedule);
    const rows = await payments();
    expect(rows.map((r) => [r.label, r.amount_grosze])).toEqual([
      ["Zaliczka rezerwacyjna", 50000],
      ["Druga zaliczka", 100000],
      ["Wynagrodzenie końcowe", 500000],
    ]);
  });

  it("ponowna umowa nie kasuje wpłaconych pieniędzy", async () => {
    await db.query(
      "update public.lead_payments set paid_at=now() where label='Zaliczka rezerwacyjna'",
    );
    await plan([{ ...schedule[0], amount_grosze: 70000 }, schedule[1], schedule[2]]);
    const rows = await payments();
    const reservation = rows.filter((r) => r.label === "Zaliczka rezerwacyjna");
    // Оплаченный платёж остаётся как был, дубль не создаётся.
    expect(reservation).toHaveLength(1);
    expect(reservation[0].amount_grosze).toBe(50000);
    expect(reservation[0].paid_at).not.toBeNull();
  });

  it("лид помечается оплатившим задаток только когда оплачены все задатки", async () => {
    const flag = async () =>
      (
        await db.query<{ d: string | null }>(
          "select deposit_paid_at d from public.leads where id=$1",
          [lead],
        )
      ).rows[0].d;
    expect(await flag()).toBeNull();
    await db.query("update public.lead_payments set paid_at=now() where label='Druga zaliczka'");
    expect(await flag()).not.toBeNull();
    await db.query("update public.lead_payments set paid_at=null where label='Druga zaliczka'");
    expect(await flag()).toBeNull();
  });

  it("przypomnienia: 3 dni, termin dziś i po terminie — osobno na każdą płatność", async () => {
    await db.query("delete from public.notification_deliveries");
    await db.query(`update public.lead_payments set paid_at=null, due_date=case label
       when 'Zaliczka rezerwacyjna' then (now() at time zone 'Europe/Warsaw')::date + 3
       when 'Druga zaliczka' then (now() at time zone 'Europe/Warsaw')::date
       else (now() at time zone 'Europe/Warsaw')::date - 2 end`);
    await db.query("select public.prepare_notification_jobs()");
    const { rows } = await db.query<{ kind: string; label: string }>(
      `select d.kind, p.label from public.notification_deliveries d
       join public.lead_payments p on p.id=d.payment_id where d.kind like 'payment%' order by d.kind`,
    );
    expect(rows).toEqual([
      { kind: "payment_3d", label: "Zaliczka rezerwacyjna" },
      { kind: "payment_overdue", label: "Wynagrodzenie końcowe" },
      { kind: "payment_today", label: "Druga zaliczka" },
    ]);
    // Оплата снимает напоминание.
    await db.query(
      "update public.lead_payments set paid_at=now() where label='Wynagrodzenie końcowe'",
    );
    await db.query("select public.prepare_notification_jobs()");
    const skipped = await db.query<{ status: string }>(
      "select status from public.notification_deliveries where kind='payment_overdue'",
    );
    expect(skipped.rows.every((r) => r.status === "skipped")).toBe(true);
  });

  it("чужая фирма не видит и не меняет платежи", async () => {
    const visible = await asUser(db, OTHER, () =>
      db.query("select id from public.lead_payments where organization_id=$1", [org]),
    );
    expect(visible.rows).toHaveLength(0);
    await expect(
      asUser(db, OTHER, () =>
        db.query("select public.set_contract_payments($1,$2,'[]'::jsonb)", [org, lead]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("сводка считает оплачено, ожидается и просрочено", async () => {
    const { rows } = await asUser(db, OWNER, () =>
      db.query<{ d: { paid_grosze: number; overdue_grosze: number; by_source: unknown[] } }>(
        "select public.finance_summary($1) as d",
        [org],
      ),
    );
    const d = rows[0].d;
    expect(Number(d.paid_grosze)).toBe(500000);
    expect(Number(d.overdue_grosze)).toBe(0);
    expect(d.by_source).toHaveLength(1);
  });
});
