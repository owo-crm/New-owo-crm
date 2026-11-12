import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/**
 * Рассылки: отписавшийся не получает письмо, даже если его отметили в списке.
 * Это не настройка интерфейса, а закон, поэтому проверяется на уровне базы.
 */
const OWNER = "d0000000-0000-4000-8000-000000000001";
let db: PGlite;
let org: string;
let leadA: string;
let leadB: string;

const lead = (name: string, email: string) =>
  db
    .query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, email, stage_key)
       values ($1,$2,$3,'new') returning id`,
      [org, name, email],
    )
    .then((r) => r.rows[0].id);

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, OWNER);
  org = (
    await asUser(db, OWNER, () =>
      db.query<{ id: string }>("select public.create_organization('Barowo','mailing') as id"),
    )
  ).rows[0].id;
  leadA = await lead("Anna Kowalska", "anna@example.com");
  leadB = await lead("Piotr Nowak", "piotr@example.com");
});
afterAll(() => db.close());

describe("рассылки", () => {
  it("контакты берутся из лидов с почтой", async () => {
    const { rows } = await asUser(db, OWNER, () =>
      db.query<{ email: string }>("select * from public.mailing_contacts($1)", [org]),
    );
    expect(rows.map((r) => r.email).sort()).toEqual(["anna@example.com", "piotr@example.com"]);
  });

  it("отписавшийся помечен и не попадает в кампанию", async () => {
    await asUser(db, OWNER, () =>
      db.query("insert into public.mail_optouts (organization_id, email) values ($1,$2)", [
        org,
        "piotr@example.com",
      ]),
    );
    const contacts = await asUser(db, OWNER, () =>
      db.query<{ email: string; unsubscribed: boolean }>(
        "select * from public.mailing_contacts($1)",
        [org],
      ),
    );
    expect(contacts.rows.find((r) => r.email === "piotr@example.com")?.unsubscribed).toBe(true);

    // В кампанию отмечаем обоих — попасть должен только один.
    const campaign = await asUser(db, OWNER, () =>
      db.query<{ id: string }>("select public.mailing_start($1,$2::jsonb,$3::uuid[]) as id", [
        org,
        JSON.stringify({ subject: "Wolne terminy", body: "Cześć {imie}" }),
        [leadA, leadB],
      ]),
    );
    const { rows } = await db.query<{ email: string }>(
      "select email from public.mailing_recipients where campaign_id=$1",
      [campaign.rows[0].id],
    );
    expect(rows.map((r) => r.email)).toEqual(["anna@example.com"]);
  });

  it("кампания закрывается, когда разослана", async () => {
    const id = (
      await asUser(db, OWNER, () =>
        db.query<{ id: string }>("select public.mailing_start($1,$2::jsonb,$3::uuid[]) as id", [
          org,
          JSON.stringify({ subject: "Dziękujemy", body: "Dzięki!" }),
          [leadA],
        ]),
      )
    ).rows[0].id;
    const next = await asUser(db, OWNER, () =>
      db.query<{ recipient_id: string }>("select * from public.mailing_next($1,10)", [org]),
    );
    expect(next.rows.length).toBeGreaterThan(0);
    for (const row of next.rows)
      await asUser(db, OWNER, () =>
        db.query("select public.mailing_mark($1,$2,true,null)", [org, row.recipient_id]),
      );
    const { rows } = await db.query<{ status: string }>(
      "select status from public.mailing_campaigns where id=$1",
      [id],
    );
    expect(rows[0].status).toBe("done");
  });
});
