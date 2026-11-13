import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import {
  readOrganizationAvatar,
  readProfileAvatar,
  saveOrganizationAvatar,
  saveProfileAvatar,
} from "@/lib/avatars/repository";

/** Аватарки (решение 039): логотип кабинета меняют owner/admin, фото — только сам человек. */
const ANNA = "00000000-0000-4000-8000-0000000000a1"; // владелец A
const CELINA = "00000000-0000-4000-8000-0000000000c1"; // сотрудник A
const BARTEK = "00000000-0000-4000-8000-0000000000b1"; // владелец B
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let pg: PGlite;
let db: Database;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (q: { query: PGlite["query"]; exec: PGlite["exec"] }) => ({
    query: (sql: string, params?: unknown[]) => q.query(sql, params, { parsers }) as never,
    exec: (sql: string) => q.exec(sql),
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
  await createUser(pg, ANNA, "Anna");
  await createUser(pg, CELINA, "Celina");
  await createUser(pg, BARTEK, "Bartek");
  const make = (u: string, n: string) =>
    asUser(pg, u, async () => {
      const r = await pg.query<{ id: string }>("select public.create_organization($1,$2) as id", [
        n,
        n,
      ]);
      return r.rows[0].id;
    });
  orgA = await make(ANNA, "firma-a");
  orgB = await make(BARTEK, "firma-b");
  await pg.query(
    "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'member')",
    [orgA, CELINA],
  );
});

describe("аватарки", () => {
  it("владелец ставит логотип кабинета, сотрудник его видит", async () => {
    await saveOrganizationAvatar(db, ANNA, orgA, { content: PNG, type: "image/png" });
    const seen = await readOrganizationAvatar(db, CELINA, orgA);
    expect(seen?.content_type).toBe("image/png");
    expect(Buffer.from(seen!.content).equals(PNG)).toBe(true);
  });

  it("сотрудник (member) не может менять логотип", async () => {
    await expect(
      saveOrganizationAvatar(db, CELINA, orgA, { content: PNG, type: "image/png" }),
    ).rejects.toThrow();
  });

  it("чужая фирма не видит и не меняет логотип", async () => {
    expect(await readOrganizationAvatar(db, BARTEK, orgA)).toBeNull();
    await expect(
      saveOrganizationAvatar(db, BARTEK, orgA, { content: PNG, type: "image/png" }),
    ).rejects.toThrow();
    expect(await readOrganizationAvatar(db, ANNA, orgB)).toBeNull();
  });

  it("фото человека видят коллеги, но не чужие", async () => {
    await saveProfileAvatar(db, CELINA, { content: PNG, type: "image/png" });
    expect(await readProfileAvatar(db, ANNA, CELINA)).not.toBeNull();
    expect(await readProfileAvatar(db, BARTEK, CELINA)).toBeNull();
  });

  it("удаление возвращает инициалы", async () => {
    await saveProfileAvatar(db, CELINA, null);
    expect(await readProfileAvatar(db, CELINA, CELINA)).toBeNull();
  });
});
