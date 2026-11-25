import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { asUser, createUser } from "./harness";
import type { FileStorage } from "@/lib/platform/files/storage";
import { PostgresStorage, sha256Hex } from "@/lib/platform/files/storage";
import { fileContent } from "@/lib/platform/files/service";
import { migrateFilesToS3 } from "@/lib/platform/files/migrate-to-s3";
import {
  addPropertyPhoto,
  createProperty,
  detectImage,
  linkLeadToPropertySlug,
  listProperties,
  setPublication,
  updateProperty,
} from "@/lib/realestate/properties";

/**
 * M4.1 (реестр) → M3-files (`files`) → M3.x (перенос, fallback) → properties (ADR 2026-11-25).
 * База как в продакшне: миграции до 0046 → данные → 0046+.
 */
const ADAM = "d4000000-0000-4000-8000-000000000001";
const AGENT = "d4000000-0000-4000-8000-000000000002"; // member у Адама
const OTHER = "d4000000-0000-4000-8000-000000000003"; // владелец другой фирмы
const FIRST_NEW = "20261125000046_entities.sql";
const dir = path.resolve(__dirname, "../../db/migrations");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

/** Хранилище в памяти с интерфейсом FileStorage (S3 проверяется отдельно, files-s3.test.ts). */
function memoryStorage(opts: { failGet?: boolean } = {}) {
  const objects = new Map<string, { body: Uint8Array; sha256: string; type: string }>();
  const s: FileStorage & { objects: typeof objects } = {
    kind: "s3",
    objects,
    async put(key, body, o) {
      const sha256 = sha256Hex(body);
      if (o.sha256 && o.sha256 !== sha256) throw new Error("checksum");
      objects.set(key, { body, sha256, type: o.contentType });
      return { sha256 };
    },
    async get(key) {
      if (opts.failGet) throw new Error("network");
      return objects.get(key)?.body ?? null;
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { size: o.body.byteLength, sha256: o.sha256, contentType: o.type } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async signedUrl() {
      return null;
    },
  };
  return s;
}

describe("реестр сущностей, файлы, объекты недвижимости", () => {
  let db: PGlite;
  let events: string;
  let adamOrg: string;
  let otherOrg: string;
  let oldAttachment: string;

  beforeAll(async () => {
    db = new PGlite();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files)
      if (f < FIRST_NEW) await db.exec(readFileSync(path.join(dir, f), "utf8"));
    for (const id of [ADAM, AGENT, OTHER]) await createUser(db, id);
    events = (
      await asUser(db, OTHER, () =>
        db.query<{ id: string }>("select public.create_organization('Wesela','wesela') as id"),
      )
    ).rows[0].id;
    otherOrg = events;
    adamOrg = (
      await asUser(db, ADAM, () =>
        db.query<{ id: string }>(
          "select public.create_organization('Adam Nieruchomości','adam','real-estate') as id",
        ),
      )
    ).rows[0].id;
    await db.query(
      "insert into public.memberships (organization_id, user_id, role) values ($1,$2,'member')",
      [adamOrg, AGENT],
    );
    // Файл, загруженный до миграции 0047, — должен попасть в реестр с тем же sha256.
    const lead = (
      await db.query<{ id: string }>(
        "insert into public.leads (organization_id, client_name, phone_e164) values ($1,'Klient','+48500000009') returning id",
        [events],
      )
    ).rows[0].id;
    oldAttachment = (
      await db.query<{ id: string }>(
        `insert into public.lead_attachments (organization_id, lead_id, filename, content_type, size_bytes, content)
         values ($1,$2,'umowa.pdf','application/pdf',5,'\\x2550444631'::bytea) returning id`,
        [events, lead],
      )
    ).rows[0].id;
    for (const f of files)
      if (f >= FIRST_NEW) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  });
  afterAll(() => db.close());

  it("M4.1: стандартные сущности зарегистрированы по пресету (storage=table)", async () => {
    const types = async (org: string) =>
      (
        await db.query<{ key: string; storage: string; table_name: string }>(
          "select key, storage, table_name from public.entity_types where organization_id=$1 order by key",
          [org],
        )
      ).rows;
    expect(await types(events)).toEqual([{ key: "leads", storage: "table", table_name: "leads" }]);
    expect(await types(adamOrg)).toEqual([
      { key: "leads", storage: "table", table_name: "leads" },
      { key: "properties", storage: "table", table_name: "properties" },
    ]);
    const fields = await db.query<{ key: string }>(
      `select f.key from public.entity_fields f join public.entity_types t on t.id=f.entity_type_id
        where t.organization_id=$1 and t.key='leads' order by f.position`,
      [adamOrg],
    );
    expect(fields.rows.map((r) => r.key)).not.toContain("guests");
    // Новая организация регистрируется триггером; повтор — без дублей.
    await db.query("select public.register_standard_entities($1)", [adamOrg]);
    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from public.entity_fields where organization_id=$1",
      [adamOrg],
    );
    expect(n.rows[0].n).toBe(18);
    // Чужой реестр не виден, клиент не может писать в реестр.
    const foreign = await asUser(db, ADAM, () =>
      db.query<{ n: number }>(
        "select count(*)::int as n from public.entity_types where organization_id=$1",
        [events],
      ),
    );
    expect(foreign.rows[0].n).toBe(0);
    await expect(
      asUser(db, ADAM, () =>
        db.query(
          "insert into public.entity_types (organization_id,key,storage,label,label_plural) values ($1,'x1','records','X','X')",
          [adamOrg],
        ),
      ),
    ).rejects.toThrow();
  });

  it("M3-files: старые файлы в реестре с верным sha256; новые — триггером; удаление помечается", async () => {
    const f = await db.query<{
      sha256: string;
      storage: string;
      storage_key: string;
      size_bytes: number;
    }>("select sha256, storage, storage_key, size_bytes from public.files where id=$1", [
      oldAttachment,
    ]);
    expect(f.rows[0]).toEqual({
      sha256: sha256Hex(Buffer.from("%PDF1")),
      storage: "postgres",
      storage_key: `pg:lead_attachments:${oldAttachment}`,
      size_bytes: 5,
    });
    await db.query(
      "insert into public.organization_templates (organization_id, kind, filename, content, size_bytes) values ($1,'contract','w.docx','\\x01'::bytea,1)",
      [events],
    );
    const t = await db.query<{ n: number }>(
      "select count(*)::int as n from public.files where source_table='organization_templates' and source_id=$1",
      [events],
    );
    expect(t.rows[0].n).toBe(1);
  });

  it("M3.x: пробный запуск ничего не пишет; перенос сверяет sha256, bytea остаётся; повтор безопасен", async () => {
    const s3 = memoryStorage();
    const before = await migrateFilesToS3(db, s3, { organizationId: events });
    expect(before.dryRun).toBe(true);
    expect(s3.objects.size).toBe(0);
    const run = await migrateFilesToS3(db, s3, { organizationId: events, dryRun: false });
    expect(run.failed).toEqual([]);
    expect(run).toMatchObject({ moved: 2 });
    expect(run.byOrganization[0]).toMatchObject({ total: 2, in_s3: 2, in_postgres: 0 });
    expect(run.byOrganization[0].checksum).toBe(before.byOrganization[0].checksum); // те же файлы
    const content = await db.query<{ n: number }>(
      "select octet_length(content) as n from public.lead_attachments where id=$1",
      [oldAttachment],
    );
    expect(content.rows[0].n).toBe(5); // bytea не удалён
    const again = await migrateFilesToS3(db, s3, { organizationId: events, dryRun: false });
    expect(again.scanned).toBe(0);
  });

  it("чтение после переноса: из bucket; сбой bucket → fallback на bytea; без fallback — ошибка", async () => {
    const legacy = new Uint8Array(Buffer.from("%PDF1"));
    const s3 = memoryStorage();
    await migrateFilesToS3(db, s3, { organizationId: events, dryRun: false });
    // В этом экземпляре файлы уже перенесены в предыдущем тесте; кладём объект под тот же ключ.
    await s3.put(`org/${events}/${oldAttachment}`, legacy, { contentType: "application/pdf" });
    const src = { table: "lead_attachments" as const, id: oldAttachment };
    expect(
      Buffer.from((await fileContent(db, events, src, null, { storage: s3 }))!).toString(),
    ).toBe("%PDF1");
    const broken = memoryStorage({ failGet: true });
    expect(await fileContent(db, events, src, legacy, { storage: broken, fallback: true })).toBe(
      legacy,
    );
    await expect(
      fileContent(db, events, src, legacy, { storage: broken, fallback: false }),
    ).rejects.toThrow();
    // Файл, ещё не перенесённый, читается из PostgreSQL как раньше.
    expect(
      await new PostgresStorage(db).get(`pg:lead_attachments:${oldAttachment}`),
    ).not.toBeNull();
  });

  it("file_mark_s3 не принимает чужой ключ и несовпадающий sha256", async () => {
    await db.query(
      "insert into public.organization_templates (organization_id, kind, filename, content, size_bytes) values ($1,'contract','a.docx','\\x02'::bytea,1)",
      [adamOrg],
    );
    const f = (
      await db.query<{ id: string; sha256: string }>(
        "select id, sha256 from public.files where source_id=$1 and source_table='organization_templates'",
        [adamOrg],
      )
    ).rows[0];
    const mark = (key: string, sha: string) =>
      db.query<{ ok: boolean }>("select public.file_mark_s3($1,$2,1,$3) as ok", [f.id, key, sha]);
    expect((await mark(`org/${events}/${f.id}`, f.sha256)).rows[0].ok).toBe(false);
    expect((await mark(`org/${adamOrg}/${f.id}`, "0".repeat(64))).rows[0].ok).toBe(false);
    await expect(mark("../x", f.sha256)).rejects.toThrow(/invalid key/);
    await expect(
      asUser(db, ADAM, () =>
        db.query("select public.file_mark_s3($1,$2,1,$3)", [
          f.id,
          `org/${adamOrg}/${f.id}`,
          f.sha256,
        ]),
      ),
    ).rejects.toThrow();
  });

  let propertyId: string;
  it("объект: создаёт member, только черновик; чужая организация не видит и не правит", async () => {
    propertyId = await asUser(db, AGENT, () =>
      createProperty(db, adamOrg, AGENT, {
        title: "Mieszkanie 3 pokoje, Wrzeszcz",
        slug: "gdansk-wrzeszcz-3-pokoje",
        city: "Gdańsk",
        district: "Wrzeszcz",
        price_grosze: 75_900_000,
        area_m2: 58,
        rooms: 3,
        features: ["balcony"],
        street_address_private: "ul. Prywatna 1/2",
      }),
    );
    const row = await db.query(
      "select publication_status, listing_status, price_grosze from public.properties where id=$1",
      [propertyId],
    );
    expect(row.rows[0]).toEqual({
      publication_status: "draft",
      listing_status: "active",
      price_grosze: 75900000,
    });
    await expect(
      asUser(db, ADAM, () =>
        createProperty(db, adamOrg, ADAM, { title: "Duplikat", slug: "gdansk-wrzeszcz-3-pokoje" }),
      ),
    ).rejects.toThrow(); // slug уникален в организации
    // Тот же slug в другой организации — можно.
    await asUser(db, OTHER, () =>
      createProperty(db, otherOrg, OTHER, {
        title: "Inny obiekt",
        slug: "gdansk-wrzeszcz-3-pokoje",
      }),
    );
    expect(await asUser(db, OTHER, () => listProperties(db, adamOrg))).toEqual([]);
    await expect(
      asUser(db, OTHER, () => updateProperty(db, adamOrg, OTHER, propertyId, { price_grosze: 1 })),
    ).rejects.toThrow(/property_not_found/);
    // Колонки публикации клиенту напрямую не выданы.
    await expect(
      asUser(db, ADAM, () =>
        db.query("update public.properties set publication_status='published' where id=$1", [
          propertyId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("публикация: member не может; без обложки — нельзя; с фото из bucket — можно; аудит", async () => {
    await expect(
      asUser(db, AGENT, () => setPublication(db, adamOrg, propertyId, "published")),
    ).rejects.toThrow(/not allowed/);
    await expect(
      asUser(db, ADAM, () => setPublication(db, adamOrg, propertyId, "published")),
    ).rejects.toThrow(/cover required/);
    const s3 = memoryStorage();
    await expect(
      asUser(db, ADAM, () =>
        addPropertyPhoto(db, s3, adamOrg, propertyId, {
          filename: "x.jpg",
          bytes: new Uint8Array([1, 2, 3]),
        }),
      ),
    ).rejects.toThrow(/invalid_type/);
    await asUser(db, ADAM, () =>
      addPropertyPhoto(db, s3, adamOrg, propertyId, {
        filename: "Salon ładny.JPG",
        bytes: JPEG,
        alt: "Salon",
      }),
    );
    expect(s3.objects.size).toBe(1);
    const media = await db.query<{ is_cover: boolean; filename: string; storage: string }>(
      `select m.is_cover, f.filename, f.storage from public.property_media m join public.files f on f.id=m.file_id
        where m.property_id=$1`,
      [propertyId],
    );
    expect(media.rows).toEqual([{ is_cover: true, filename: "Salon-adny.jpg", storage: "s3" }]);
    await asUser(db, ADAM, () => setPublication(db, adamOrg, propertyId, "published"));
    await asUser(db, ADAM, () =>
      updateProperty(db, adamOrg, ADAM, propertyId, {
        price_grosze: 74_900_000,
        listing_status: "reserved",
      }),
    );
    const audit = await db.query<{ action: string }>(
      "select action from public.audit_log where organization_id=$1 and entity='properties' order by id",
      [adamOrg],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "property.create",
      "property.media_add",
      "property.publication",
      "property.price",
      "property.listing_status",
    ]);
  });

  it("фото: нельзя привязать файл не из bucket или чужой организации; без хранилища — понятная ошибка", async () => {
    const legacy = (
      await db.query<{ id: string }>(
        "select id from public.files where organization_id=$1 and purpose='legacy' limit 1",
        [adamOrg],
      )
    ).rows[0].id;
    await expect(
      asUser(db, ADAM, () =>
        db.query(
          "insert into public.property_media (organization_id, property_id, file_id) values ($1,$2,$3)",
          [adamOrg, propertyId, legacy],
        ),
      ),
    ).rejects.toThrow(/invalid property media file/);
    await expect(
      asUser(db, OTHER, () =>
        db.query(
          "select public.file_register_s3($1,gen_random_uuid(),'a.jpg','image/jpeg',10,$2,'property_media')",
          [adamOrg, "a".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/not allowed/);
    await expect(
      asUser(db, ADAM, () =>
        addPropertyPhoto(db, null, adamOrg, propertyId, { filename: "a.jpg", bytes: JPEG }),
      ),
    ).rejects.toThrow(/storage_not_configured/);
  });

  it("заявка со страницы объекта: связь только с опубликованным объектом своей организации", async () => {
    const lead = (
      await db.query<{ id: string }>(
        "insert into public.leads (organization_id, client_name, phone_e164) values ($1,'Kupujący','+48600111222') returning id",
        [adamOrg],
      )
    ).rows[0].id;
    expect(await linkLeadToPropertySlug(db, adamOrg, lead, "gdansk-wrzeszcz-3-pokoje")).toBe(true);
    expect(await linkLeadToPropertySlug(db, adamOrg, lead, "nie-ma-takiego")).toBe(false);
    expect(await linkLeadToPropertySlug(db, otherOrg, lead, "gdansk-wrzeszcz-3-pokoje")).toBe(
      false,
    ); // чужой лид / черновик
    expect(await linkLeadToPropertySlug(db, adamOrg, lead, "../../etc")).toBe(false);
    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from public.lead_property_interests where lead_id=$1",
      [lead],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("сигнатуры изображений", () => {
    expect(detectImage(JPEG)).toBe("image/jpeg");
    expect(detectImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(detectImage(new TextEncoder().encode("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(detectImage(new TextEncoder().encode("<svg onload=x>"))).toBeNull();
    expect(detectImage(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});
