import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser as addUser, asUser } from "./harness";
import { encryptSecret } from "@/lib/mail/secret";
import { sendBusinessMail } from "@/lib/mail/service";
import type { Queryable } from "@/lib/db/core";
import type { SmtpFactory } from "@/lib/mail/transport";

let db: PGlite;
const OWNER = "20000000-0000-4000-8000-000000000001";
const MEMBER = "20000000-0000-4000-8000-000000000002";
const STRANGER = "20000000-0000-4000-8000-000000000003";
let org: string;
let other: string;
const asOwnerDb = () => db as unknown as Queryable;

beforeAll(async () => {
  process.env.MAIL_SECRET_KEY = randomBytes(32).toString("base64");
  db = await createTestDb();
  for (const id of [OWNER, MEMBER, STRANGER]) await addUser(db, id);
  const create = (user: string, name: string, slug: string) =>
    asUser(
      db,
      user,
      async () =>
        (
          await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
            name,
            slug,
          ])
        ).rows[0].id,
    );
  org = await create(OWNER, "Barowo", "barowo");
  other = await create(STRANGER, "Obca", "obca");
  await db.query(
    "insert into public.memberships (organization_id,user_id,role) values ($1,$2,'member')",
    [org, MEMBER],
  );
});
afterAll(() => db.close());

describe("ustawienia poczty: hasło nigdy nie wraca do użytkownika", () => {
  it("owner zapisuje hasło, ale nie może go odczytać; widzi tylko «ustawione»", async () => {
    await asUser(db, OWNER, async () => {
      await db.query(
        "insert into public.organization_mail_settings (organization_id, transport, smtp_host, smtp_port, smtp_user, secret_ciphertext, daily_limit) values ($1,'smtp','smtp.gmail.com',587,'barowo.pl@gmail.com',$2,3)",
        [org, encryptSecret("apppassword")],
      );
      await expect(
        db.query(
          "select secret_ciphertext from public.organization_mail_settings where organization_id=$1",
          [org],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.organization_mail_settings")).rejects.toThrow(
        /permission denied/,
      );
      const ok = await db.query<{ transport: string }>(
        "select transport from public.organization_mail_settings where organization_id=$1",
        [org],
      );
      expect(ok.rows[0].transport).toBe("smtp");
      const set = await db.query<{ s: boolean }>("select public.mail_secret_is_set($1) as s", [
        org,
      ]);
      expect(set.rows[0].s).toBe(true);
      // «ввести заново» — можно, не читая старое
      await db.query(
        "update public.organization_mail_settings set secret_ciphertext=$2 where organization_id=$1",
        [org, encryptSecret("nowehaslo")],
      );
    });
  });

  it("zwykły członek widzi, że poczta działa, ale nie może jej zmienić", async () => {
    await asUser(db, MEMBER, async () => {
      const r = await db.query<{ transport: string }>(
        "select transport from public.organization_mail_settings where organization_id=$1",
        [org],
      );
      expect(r.rows[0].transport).toBe("smtp");
      const upd = await db.query(
        "update public.organization_mail_settings set transport='none' where organization_id=$1",
        [org],
      );
      expect(upd.affectedRows ?? 0).toBe(0);
    });
  });

  it("inna firma nie widzi ustawień ani nie sprawdzi, czy hasło jest", async () => {
    await asUser(db, STRANGER, async () => {
      const r = await db.query(
        "select transport from public.organization_mail_settings where organization_id=$1",
        [org],
      );
      expect(r.rows).toHaveLength(0);
      const set = await db.query<{ s: boolean }>("select public.mail_secret_is_set($1) as s", [
        org,
      ]);
      expect(set.rows[0].s).toBe(false);
      await expect(
        db.query(
          "insert into public.organization_mail_settings (organization_id, transport) values ($1,'none')",
          [org],
        ),
      ).rejects.toThrow();
    });
  });
});

describe("wysyłka: dzienny limit i dziennik", () => {
  it("liczy odbiorców w dzienniku i zatrzymuje się na limicie; błędy też trafiają do dziennika", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const smtp = vi.fn<SmtpFactory>(() => ({ sendMail }));
    const r = await sendBusinessMail(
      asOwnerDb(),
      org,
      { to: ["a@example.com", "b@example.com"], subject: "s", text: "t" },
      { kind: "test", sentBy: OWNER },
      { smtp },
    );
    expect(r).toMatchObject({ recipients: 2, sentToday: 2, limit: 3 });
    expect(smtp.mock.calls[0][0]).toMatchObject({ auth: { pass: "nowehaslo" } }); // расшифровано на сервере
    await expect(
      sendBusinessMail(
        asOwnerDb(),
        org,
        { to: ["c@example.com", "d@example.com"], subject: "s", text: "t" },
        { kind: "mailing" },
        { smtp },
      ),
    ).rejects.toMatchObject({ code: "daily_limit" });

    sendMail.mockRejectedValueOnce({ code: "EAUTH", responseCode: 535, response: "535 bad" });
    await expect(
      sendBusinessMail(
        asOwnerDb(),
        org,
        { to: ["c@example.com"], subject: "s", text: "t" },
        { kind: "document" },
        { smtp },
      ),
    ).rejects.toMatchObject({ code: "auth_failed" });
    const log = await db.query<{ kind: string; ok: boolean; error: string | null }>(
      "select kind, ok, error from public.mail_send_log where organization_id=$1 order by id",
      [org],
    );
    expect(log.rows).toEqual([
      { kind: "test", ok: true, error: null },
      { kind: "document", ok: false, error: "auth_failed" },
    ]);
  });

  it("firma bez skonfigurowanej poczty — not_configured", async () => {
    await expect(
      sendBusinessMail(
        asOwnerDb(),
        other,
        { to: ["a@example.com"], subject: "s", text: "t" },
        { kind: "test" },
      ),
    ).rejects.toMatchObject({ code: "not_configured" });
  });

  it("dziennik wysyłek: członek widzi swoją firmę, obcy — nic, nikt nie dopisze ręcznie", async () => {
    await asUser(db, MEMBER, async () => {
      expect(
        (await db.query("select * from public.mail_send_log where organization_id=$1", [org])).rows
          .length,
      ).toBe(2);
      await expect(
        db.query(
          "insert into public.mail_send_log (organization_id, kind, recipients, ok) values ($1,'test',1,true)",
          [org],
        ),
      ).rejects.toThrow(/permission denied/);
    });
    await asUser(db, STRANGER, async () => {
      expect(
        (await db.query("select * from public.mail_send_log where organization_id=$1", [org])).rows,
      ).toHaveLength(0);
    });
  });
});
