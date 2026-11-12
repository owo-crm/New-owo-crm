import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/**
 * Доступ команды OWO Ads к кабинетам клиентов следует из участия в кабинете агентства:
 * второй владелец видит клиента, даже если бизнес создавал не он.
 */
const NIKON = "e0000000-0000-4000-8000-000000000001";
const IVAN = "e0000000-0000-4000-8000-000000000002";
const HELPER = "e0000000-0000-4000-8000-000000000003"; // обычный участник агентства
const CLIENT = "e0000000-0000-4000-8000-000000000004"; // владелец кабинета клиента
let pg: PGlite;
let agency: string;
let client: string;

const access = async (user: string) =>
  (
    await pg.query<{ role: string; is_service: boolean }>(
      "select role, is_service from public.memberships where organization_id=$1 and user_id=$2",
      [client, user],
    )
  ).rows;

beforeAll(async () => {
  pg = await createTestDb();
  for (const id of [NIKON, IVAN, HELPER, CLIENT]) await createUser(pg, id);
  agency = (
    await asUser(pg, NIKON, () =>
      pg.query<{ id: string }>(
        "select public.create_organization('OWO Ads','owo-ads','agency') as id",
      ),
    )
  ).rows[0].id;
  await pg.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'owner'),($1,$3,'member')",
    [agency, IVAN, HELPER],
  );
  client = (
    await asUser(pg, CLIENT, () =>
      pg.query<{ id: string }>(
        "select public.create_organization('Kwiaciarnia','kwiaciarnia') as id",
      ),
    )
  ).rows[0].id;
  await pg.query(
    `insert into public.agency_clients (organization_id, name, client_org_id, status, started_at, created_by)
     values ($1,'Kwiaciarnia',$2,'active',current_date,$3)`,
    [agency, client, NIKON],
  );
});
afterAll(() => pg.close());

describe("сервисный доступ агентства", () => {
  it("даётся владельцам агентства, даже тем, кто бизнес не создавал", async () => {
    expect(await access(NIKON)).toEqual([{ role: "admin", is_service: true }]);
    expect(await access(IVAN)).toEqual([{ role: "admin", is_service: true }]);
  });

  it("не даётся обычному участнику агентства", async () => {
    expect(await access(HELPER)).toEqual([]);
  });

  it("оставляет клиента единственным владельцем своего кабинета", async () => {
    const { rows } = await pg.query<{ n: number }>(
      "select count(*)::int as n from public.memberships where organization_id=$1 and role='owner'",
      [client],
    );
    expect(rows[0].n).toBe(1);
  });

  it("уведомления в чужом кабинете выключены по умолчанию", async () => {
    const { rows } = await pg.query<{ enabled: boolean }>(
      "select distinct enabled from public.notification_settings where organization_id=$1 and user_id=$2",
      [client, IVAN],
    );
    expect(rows).toEqual([{ enabled: false }]);
  });

  it("повышение участника агентства открывает доступ, понижение — закрывает", async () => {
    await pg.query(
      "update public.memberships set role='admin' where organization_id=$1 and user_id=$2",
      [agency, HELPER],
    );
    expect(await access(HELPER)).toEqual([{ role: "admin", is_service: true }]);
    await pg.query(
      "update public.memberships set role='member' where organization_id=$1 and user_id=$2",
      [agency, HELPER],
    );
    expect(await access(HELPER)).toEqual([]);
  });

  it("владелец агентства, он же владелец кабинета клиента, остаётся настоящим владельцем", async () => {
    // Случай Вани: wlaściciel и в OWO Ads, и в Barowo одновременно.
    expect(
      (
        await pg.query<{ role: string; is_service: boolean }>(
          "select role, is_service from public.memberships where organization_id=$1 and user_id=$2",
          [client, CLIENT],
        )
      ).rows,
    ).toEqual([{ role: "owner", is_service: false }]);

    await pg.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'owner')",
      [agency, CLIENT],
    );
    expect(await access(CLIENT)).toEqual([{ role: "owner", is_service: false }]);
    const seats = await pg.query<{ n: number }>("select public.billable_seats($1) as n", [client]);
    expect(seats.rows[0].n).toBe(1); // он сам; команда агентства местами не считается
  });

  it("уход из агентства забирает доступ ко всем клиентам", async () => {
    await pg.query("delete from public.memberships where organization_id=$1 and user_id=$2", [
      agency,
      IVAN,
    ]);
    expect(await access(IVAN)).toEqual([]);
  });
});
