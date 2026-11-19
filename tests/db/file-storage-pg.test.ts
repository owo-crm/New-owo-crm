import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Queryable } from "@/lib/db/core";
import { PostgresStorage, StorageError, pgKey, sha256Hex } from "@/lib/platform/files/storage";

/** M1.7: текущие файлы в bytea читаются через FileStorage; запись — только старым кодом. */
const OWNER = "f3000000-0000-4000-8000-000000000001";
let pg: PGlite;
let db: Queryable;
let fileId: string;
const content = Buffer.from("plan sali");

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  db = { query: (sql: string, params?: unknown[]) => pg.query(sql, params, { parsers }) as never };
  await createUser(pg, OWNER);
  const org = (
    await asUser(pg, OWNER, () =>
      pg.query<{ id: string }>("select public.create_organization('Firma','fs-pg') as id"),
    )
  ).rows[0].id;
  const lead = (
    await pg.query<{ id: string }>(
      "insert into public.leads (organization_id, client_name, email) values ($1,'Anna','a@x.pl') returning id",
      [org],
    )
  ).rows[0].id;
  fileId = (
    await pg.query<{ id: string }>(
      `insert into public.lead_attachments (organization_id, lead_id, filename, content_type, size_bytes, content)
       values ($1,$2,'plan.pdf','application/pdf',$3,$4) returning id`,
      [org, lead, content.byteLength, content],
    )
  ).rows[0].id;
});
afterAll(() => pg.close());

it("читает существующий файл, считает sha256; запись и удаление запрещены; чужие таблицы — нет", async () => {
  const storage = new PostgresStorage(db);
  const key = pgKey("lead_attachments", fileId);
  expect(Buffer.from((await storage.get(key))!).toString()).toBe("plan sali");
  expect(await storage.head(key)).toEqual({
    size: content.byteLength,
    sha256: sha256Hex(content),
    contentType: "application/pdf",
  });
  expect(await storage.signedUrl()).toBeNull();
  await expect(storage.put()).rejects.toBeInstanceOf(StorageError);
  await expect(storage.delete()).rejects.toBeInstanceOf(StorageError);
  await expect(storage.get(`pg:leads:${fileId}`)).rejects.toBeInstanceOf(StorageError);
  expect(
    await storage.get(pgKey("lead_attachments", "00000000-0000-4000-8000-000000000000")),
  ).toBeNull();
});
