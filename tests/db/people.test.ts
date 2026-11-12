import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/**
 * Разделение «Leady · Klienci · Umowy»: один человек с двумя обращениями — одна строка
 * в клиентах и две умовы, если подписал дважды.
 */
const OWNER = "c0000000-0000-4000-8000-000000000001";
let db: PGlite;
let org: string;

const newLead = (name: string, phone: string | null, stage: string, email?: string) =>
  db
    .query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, phone_e164, email, stage_key, event_date)
       values ($1,$2,$3,$4,$5, current_date + 30) returning id`,
      [org, name, phone, email ?? null, stage],
    )
    .then((r) => r.rows[0].id);

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, OWNER);
  org = (
    await asUser(db, OWNER, () =>
      db.query<{ id: string }>("select public.create_organization('Barowo','people-test') as id"),
    )
  ).rows[0].id;
});
afterAll(() => db.close());

describe("клиенты и умовы", () => {
  it("пока умову не выслали — человек не клиент", async () => {
    await newLead("Anna Nowak", "+48600100200", "contacted");
    const { rows } = await asUser(db, OWNER, () =>
      db.query("select * from public.clients_list($1,null)", [org]),
    );
    expect(rows).toHaveLength(0);
  });

  it("выслали умову — появился клиент", async () => {
    await newLead("Piotr Lis", "+48600100300", "contract_sent");
    const { rows } = await asUser(db, OWNER, () =>
      db.query<{ client_name: string; contracts: string }>(
        "select * from public.clients_list($1,null)",
        [org],
      ),
    );
    expect(rows.map((r) => r.client_name)).toEqual(["Piotr Lis"]);
    expect(Number(rows[0].contracts)).toBe(0);
  });

  it("два обращения одного телефона — один клиент и две умовы", async () => {
    await newLead("Ewa Zielińska", "+48600100400", "contract_signed");
    await newLead("Ewa Z.", "+48600100400", "deposit_paid");
    const { rows } = await asUser(db, OWNER, () =>
      db.query<{ client_name: string; leads: string; contracts: string }>(
        "select * from public.clients_list($1,'600100400')",
        [org],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].leads)).toBe(2);
    expect(Number(rows[0].contracts)).toBe(2);

    const signed = await asUser(db, OWNER, () =>
      db.query("select * from public.contracts_list($1,'600100400')", [org]),
    );
    expect(signed.rows).toHaveLength(2);
  });

  // В базе почта всегда в нижнем регистре (ограничение таблицы), поэтому склейка надёжна.
  it("без телефона человека узнаём по почте", async () => {
    await newLead("Hotel Mors", null, "contract_sent", "biuro@mors.pl");
    await newLead("Mors sp. z o.o.", null, "contract_signed", "biuro@mors.pl");
    const { rows } = await asUser(db, OWNER, () =>
      db.query<{ leads: string }>("select * from public.clients_list($1,'mors')", [org]),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].leads)).toBe(2);
  });

  it("отказ в клиенты не попадает", async () => {
    await newLead("Spam Spamowy", "+48600100500", "rejected");
    const { rows } = await asUser(db, OWNER, () =>
      db.query("select * from public.clients_list($1,'600100500')", [org]),
    );
    expect(rows).toHaveLength(0);
  });
});
