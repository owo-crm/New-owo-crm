import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { asUser, createUser } from "./harness";
import { S3Storage, s3ConfigFromEnv, sha256Hex } from "@/lib/platform/files/storage";
import { fileContent } from "@/lib/platform/files/service";
import { migrateFilesToS3 } from "@/lib/platform/files/migrate-to-s3";
import { addPropertyPhoto, createProperty } from "@/lib/realestate/properties";

/**
 * Проверка на настоящем S3-API (staging-бакет R2 или локальный эмулятор). Запускается только при
 * заданных FILES_S3_TEST_* (тест не трогает production и пишет только под префиксом org/<uuid>/):
 *   FILES_S3_TEST_ENDPOINT, FILES_S3_TEST_BUCKET, FILES_S3_TEST_ACCESS_KEY_ID, FILES_S3_TEST_SECRET_ACCESS_KEY
 */
const env = process.env;
const cfg = s3ConfigFromEnv({
  FILES_S3_ENDPOINT: env.FILES_S3_TEST_ENDPOINT,
  FILES_S3_REGION: env.FILES_S3_TEST_REGION,
  FILES_S3_BUCKET: env.FILES_S3_TEST_BUCKET,
  FILES_S3_ACCESS_KEY_ID: env.FILES_S3_TEST_ACCESS_KEY_ID,
  FILES_S3_SECRET_ACCESS_KEY: env.FILES_S3_TEST_SECRET_ACCESS_KEY,
});
const OWNER = "c3000000-0000-4000-8000-000000000001";

describe.skipIf(!cfg)("S3 staging: перенос, чтение, фото объектов", () => {
  const s3 = cfg ? new S3Storage(cfg) : (null as unknown as S3Storage);
  let db: PGlite;
  let org: string;
  let attachment: string;
  const pdf = new Uint8Array(Buffer.from("%PDF-1.4 staging test " + Date.now()));

  beforeAll(async () => {
    db = new PGlite();
    const dir = path.resolve(__dirname, "../../db/migrations");
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(path.join(dir, f), "utf8"));
    await createUser(db, OWNER);
    org = (
      await asUser(db, OWNER, () =>
        db.query<{ id: string }>(
          "select public.create_organization('Staging Nieruchomości','staging','real-estate') as id",
        ),
      )
    ).rows[0].id;
    const lead = (
      await db.query<{ id: string }>(
        "insert into public.leads (organization_id, client_name, phone_e164) values ($1,'Test','+48500000001') returning id",
        [org],
      )
    ).rows[0].id;
    attachment = (
      await db.query<{ id: string }>(
        `insert into public.lead_attachments (organization_id, lead_id, filename, content_type, size_bytes, content)
         values ($1,$2,'umowa.pdf','application/pdf',$3,$4) returning id`,
        [org, lead, pdf.byteLength, Buffer.from(pdf)],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await s3.delete(`org/${org}/${attachment}`).catch(() => undefined);
    await db.close();
  });

  it("put/head/get/delete и подпись SigV4 принимаются сервером", async () => {
    const key = `org/${org}/probe`;
    const { sha256 } = await s3.put(key, new Uint8Array([1, 2, 3]), {
      contentType: "application/octet-stream",
    });
    expect(await s3.head(key)).toMatchObject({ size: 3, sha256 });
    expect(Array.from((await s3.get(key))!)).toEqual([1, 2, 3]);
    const url = (await s3.signedUrl(key, 60, "probe.bin"))!;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    await s3.delete(key);
    expect(await s3.head(key)).toBeNull();
  });

  it("M3.x: перенос с проверкой размера и sha256, количество и контрольная сумма совпадают, bytea на месте", async () => {
    const dry = await migrateFilesToS3(db, s3, { organizationId: org });
    const run = await migrateFilesToS3(db, s3, { organizationId: org, dryRun: false });
    expect(run.failed).toEqual([]);
    expect(run.moved).toBe(1);
    expect(run.byOrganization[0]).toMatchObject({ total: 1, in_s3: 1, in_postgres: 0 });
    expect(run.byOrganization[0].checksum).toBe(dry.byOrganization[0].checksum);
    const head = await s3.head(`org/${org}/${attachment}`);
    expect(head).toMatchObject({ size: pdf.byteLength, sha256: sha256Hex(pdf) });
    const bytea = await db.query<{ n: number }>(
      "select octet_length(content) as n from public.lead_attachments where id=$1",
      [attachment],
    );
    expect(bytea.rows[0].n).toBe(pdf.byteLength);
  });

  it("чтение после переноса идёт из bucket; при недоступном bucket — fallback на bytea", async () => {
    const src = { table: "lead_attachments" as const, id: attachment };
    const fromS3 = await fileContent(db, org, src, new Uint8Array([0]), { storage: s3 });
    expect(Buffer.from(fromS3!).equals(Buffer.from(pdf))).toBe(true);
    const down = new S3Storage({ ...cfg!, endpoint: "http://127.0.0.1:9" });
    const fallback = await fileContent(db, org, src, pdf, { storage: down, fallback: true });
    expect(fallback).toBe(pdf);
  });

  it("фото объекта попадает в bucket, sha256 в метаданных совпадает", async () => {
    const id = await asUser(db, OWNER, () =>
      createProperty(db, org, OWNER, { title: "Test staging", slug: "test-staging" }),
    );
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("staging")]);
    await asUser(db, OWNER, () =>
      addPropertyPhoto(db, s3, org, id, { filename: "a.jpg", bytes: jpeg }),
    );
    const file = await db.query<{ storage_key: string; sha256: string }>(
      "select f.storage_key, f.sha256 from public.files f join public.property_media m on m.file_id=f.id where m.property_id=$1",
      [id],
    );
    const head = await s3.head(file.rows[0].storage_key);
    expect(head).toMatchObject({
      size: jpeg.byteLength,
      sha256: file.rows[0].sha256,
      contentType: "image/jpeg",
    });
    await s3.delete(file.rows[0].storage_key);
  });
});
