import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/**
 * Лид агентства: услуги и рекламный бюджет, выбранные на этапе лида, должны переехать
 * в карточку клиента вместе с ним — иначе их пришлось бы вводить второй раз.
 */
const IWAN = "b0000000-0000-4000-8000-000000000001";
const NIKON = "b0000000-0000-4000-8000-000000000002";

let db: PGlite;
let org: string;
let lead: string;
let adsService: string;
let crmService: string;

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [IWAN, NIKON]) await createUser(db, id);
  org = (
    await asUser(db, IWAN, () =>
      db.query<{ id: string }>(
        "select public.create_organization('OWO Ads','owo-ads-lead','agency') as id",
      ),
    )
  ).rows[0].id;
  await db.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'admin')",
    [org, NIKON],
  );
  // Зашитые услуги заводит миграция только существующим кабинетам — здесь создаём руками.
  const made = await asUser(db, IWAN, () =>
    db.query<{ id: string; system_key: string }>(
      `insert into public.agency_services (organization_id, name, owner_id, kind, system_key)
       values ($1,'Abonament CRM',$2,'retainer','crm'), ($1,'Reklama',$2,'retainer','ads')
       returning id, system_key`,
      [org, IWAN],
    ),
  );
  crmService = made.rows.find((r) => r.system_key === "crm")!.id;
  adsService = made.rows.find((r) => r.system_key === "ads")!.id;

  lead = (
    await db.query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, phone_e164, email, event_city, stage_key)
       values ($1,'Sopot Barber','+48600100200','kontakt@barber.pl','Sopot','new') returning id`,
      [org],
    )
  ).rows[0].id;
});
afterAll(() => db.close());

describe("лид агентства", () => {
  it("хранит, кто привёл, бюджет и выбранные услуги", async () => {
    await asUser(db, IWAN, async () => {
      await db.query(
        `insert into public.agency_lead_details
           (organization_id, lead_id, referred_by, contact_name, monthly_budget_grosze, note)
         values ($1,$2,$3,'Marek Nowak',250000,'Chce reklamę i stronę')`,
        [org, lead, NIKON],
      );
      await db.query(
        `insert into public.agency_lead_services (organization_id, lead_id, service_id) values ($1,$2,$3), ($1,$2,$4)`,
        [org, lead, adsService, crmService],
      );
    });
    const { rows } = await db.query<{ referred_by: string; monthly_budget_grosze: string }>(
      "select referred_by, monthly_budget_grosze from public.agency_lead_details where lead_id=$1",
      [lead],
    );
    expect(rows[0].referred_by).toBe(NIKON);
    expect(Number(rows[0].monthly_budget_grosze)).toBe(250000);
  });

  it("при превращении в клиента услуги и бюджет переезжают", async () => {
    const client = (
      await asUser(db, IWAN, () =>
        db.query<{ id: string }>("select public.agency_client_from_lead($1,$2) as id", [org, lead]),
      )
    ).rows[0].id;
    const { rows } = await db.query<{
      system_key: string;
      monthly_budget_grosze: string | null;
    }>(
      `select s.system_key, cs.monthly_budget_grosze
       from public.agency_client_services cs
       join public.agency_services s on s.id = cs.service_id
       where cs.client_id=$1 order by s.system_key`,
      [client],
    );
    const { rows: card } = await db.query<{ contact_name: string }>(
      "select contact_name from public.agency_clients where id=$1",
      [client],
    );
    // Контактное лицо приезжает из лида, а не подставляется названием фирмы.
    expect(card[0].contact_name).toBe("Marek Nowak");
    expect(rows.map((r) => r.system_key)).toEqual(["ads", "crm"]);
    // Бюджет достаётся только рекламе.
    expect(Number(rows[0].monthly_budget_grosze)).toBe(250000);
    expect(rows[1].monthly_budget_grosze).toBeNull();
  });

  it("повторное превращение не создаёт второго клиента", async () => {
    await asUser(db, IWAN, () =>
      db.query("select public.agency_client_from_lead($1,$2)", [org, lead]),
    );
    const { rows } = await db.query<{ n: string }>(
      "select count(*) as n from public.agency_clients where organization_id=$1",
      [org],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("зашитую услугу нельзя удалить или переименовать", async () => {
    await expect(
      asUser(db, IWAN, () =>
        db.query("delete from public.agency_services where id=$1", [adsService]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(db, IWAN, () =>
        db.query("update public.agency_services set name='Inna' where id=$1", [adsService]),
      ),
    ).rejects.toThrow();
    // Ответственного менять можно.
    await asUser(db, IWAN, () =>
      db.query("update public.agency_services set owner_id=$2 where id=$1", [adsService, NIKON]),
    );
    const { rows } = await db.query<{ owner_id: string }>(
      "select owner_id from public.agency_services where id=$1",
      [adsService],
    );
    expect(rows[0].owner_id).toBe(NIKON);
  });
});
