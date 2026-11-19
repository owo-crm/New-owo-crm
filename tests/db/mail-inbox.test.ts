import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser as addUser, asUser } from "./harness";
import { encryptSecret } from "@/lib/mail/secret";
import {
  loadInboundSecret,
  recordOutgoing,
  retryPendingBodies,
  storeInbound,
} from "@/lib/mail/inbox";
import type { Queryable } from "@/lib/db/core";

/** Переписка (решение 051): входящие от Resend, повторы, тело письма, права. */
let db: PGlite;
const OWNER = "30000000-0000-4000-8000-000000000001";
const MEMBER = "30000000-0000-4000-8000-000000000002";
const STRANGER = "30000000-0000-4000-8000-000000000003";
let org: string;
let other: string;
let leadId: string;
const q = () => db as unknown as Queryable;

const event = (id: string, from = '"Anna Nowak" <Anna@Example.com>') => ({
  type: "email.received",
  data: {
    email_id: id,
    from,
    to: ["kontakt@barowo.com"],
    subject: "Re: Oferta",
    message_id: `<${id}@mail.example.com>`,
    attachments: [],
  },
});

const resendOk = (text: string) =>
  vi.fn(async () =>
    Response.json({ text, html: null, headers: { from: "Anna Nowak <anna@example.com>" } }),
  );

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
  await db.query(
    `insert into public.organization_mail_settings
       (organization_id, transport, from_email, secret_ciphertext, inbound_secret_ciphertext)
     values ($1, 'resend', 'kontakt@barowo.com', $2, $3)`,
    [org, encryptSecret("re_full_access"), encryptSecret("whsec_abc")],
  );
  const stage = (
    await db.query<{ key: string }>(
      "select key from public.pipeline_stages where organization_id=$1 order by position limit 1",
      [org],
    )
  ).rows[0]?.key;
  leadId = (
    await db.query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, email, stage_key)
       values ($1, 'Anna Nowak', 'anna@example.com', $2) returning id`,
      [org, stage ?? "new"],
    )
  ).rows[0].id;
});
afterAll(() => db.close());

describe("входящие письма", () => {
  it("секрет вебхука читается сервером, у фирмы без приёма — null", async () => {
    expect(await loadInboundSecret(q(), org)).toBe("whsec_abc");
    expect(await loadInboundSecret(q(), other)).toBeNull();
  });

  it("письмо привязывается к лиду по адресу, тело забирается из Resend", async () => {
    const fetch = resendOk("Bierzemy Premium!\n\nW dniu 1.06 Barowo napisał(a):\n> oferta");
    const result = await storeInbound(q(), org, event("e1"), { fetch });
    expect(result).toMatchObject({ stored: true, leadId });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails/receiving/e1",
      expect.objectContaining({ headers: { Authorization: "Bearer re_full_access" } }),
    );
    const row = (
      await db.query<{
        counterpart: string;
        body_text: string;
        body_pending: boolean;
        counterpart_name: string;
      }>(
        "select counterpart, body_text, body_pending, counterpart_name from public.mail_messages where provider_id='e1'",
      )
    ).rows[0];
    expect(row).toMatchObject({
      counterpart: "anna@example.com",
      body_pending: false,
      counterpart_name: "Anna Nowak",
    });
    expect(row.body_text).toContain("Bierzemy Premium!");
  });

  it("повтор того же вебхука не создаёт второе письмо", async () => {
    const again = await storeInbound(q(), org, event("e1"), { fetch: resendOk("x") });
    expect(again).toMatchObject({ stored: false, reason: "duplicate" });
    const n = (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.mail_messages where provider_id='e1'",
      )
    ).rows[0].n;
    expect(n).toBe(1);
  });

  it("Resend недоступен → тело догружается фоновой очередью", async () => {
    const down = vi.fn(async () => new Response("no", { status: 503 }));
    await storeInbound(q(), org, event("e2", "nowy@klient.pl"), { fetch: down });
    expect(
      (
        await db.query<{ p: boolean }>(
          "select body_pending p from public.mail_messages where provider_id='e2'",
        )
      ).rows[0].p,
    ).toBe(true);
    expect(
      await retryPendingBodies(q(), { fetch: resendOk("Dzień dobry, pytanie o termin") }),
    ).toBe(1);
    expect(
      (
        await db.query<{ t: string }>(
          "select body_text t from public.mail_messages where provider_id='e2'",
        )
      ).rows[0].t,
    ).toBe("Dzień dobry, pytanie o termin");
  });

  it("письмо с собственного адреса фирмы в переписку не попадает", async () => {
    const r = await storeInbound(q(), org, event("e3", "kontakt@barowo.com"), {
      fetch: resendOk("x"),
    });
    expect(r).toMatchObject({ stored: false, reason: "own_address" });
  });

  it("исходящее — в ту же ленту; участник видит, чужая фирма — нет; править текст нельзя", async () => {
    await recordOutgoing(q(), {
      organizationId: org,
      leadId,
      to: "anna@example.com",
      subject: "Re: Oferta",
      text: "Świetnie!",
      html: null,
      inReplyTo: "<e1@mail.example.com>",
      sentBy: OWNER,
    });
    await asUser(db, MEMBER, async () => {
      const rows = (
        await db.query<{ direction: string }>(
          "select direction from public.mail_messages where organization_id=$1 and counterpart='anna@example.com' order by created_at",
          [org],
        )
      ).rows;
      expect(rows.map((r) => r.direction)).toEqual(["in", "out"]);
      await db.query("update public.mail_messages set read_at=now() where organization_id=$1", [
        org,
      ]);
      await expect(
        db.query("update public.mail_messages set body_text='x' where organization_id=$1", [org]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(
          "insert into public.mail_messages (organization_id, direction, counterpart) values ($1,'in','fake@x.pl')",
          [org],
        ),
      ).rejects.toThrow();
    });
    await asUser(db, STRANGER, async () => {
      const n = (await db.query<{ n: number }>("select count(*)::int n from public.mail_messages"))
        .rows[0].n;
      expect(n).toBe(0);
    });
  });
});

describe("статусы отправленных писем (решение 052)", () => {
  it("доставлено → открыто; позднее «доставлено» не откатывает; отказ перекрывает", async () => {
    const { applyStatus } = await import("@/lib/mail/inbox");
    await recordOutgoing(q(), {
      organizationId: org,
      leadId,
      to: "anna@example.com",
      subject: "Re: Oferta",
      text: "Statusy",
      html: null,
      inReplyTo: null,
      sentBy: OWNER,
      providerId: "re_out_1",
    });
    const status = async () =>
      (
        await db.query<{ status: string; opened_at: string | null; status_detail: string | null }>(
          "select status, opened_at, status_detail from public.mail_messages where provider_id='re_out_1'",
        )
      ).rows[0];
    expect((await status()).status).toBe("sent");
    const ev = (type: string, extra = {}) => ({
      type,
      created_at: "2026-11-19T19:00:00.000Z",
      data: { email_id: "re_out_1", ...extra },
    });
    await applyStatus(q(), org, ev("email.delivered") as never);
    await applyStatus(q(), org, ev("email.opened") as never);
    expect(await applyStatus(q(), org, ev("email.delivered") as never)).toEqual({ updated: 0 });
    expect(await status()).toMatchObject({ status: "opened" });
    expect((await status()).opened_at).not.toBeNull();
    await applyStatus(
      q(),
      org,
      ev("email.bounced", { bounce: { message: "Mailbox full" } }) as never,
    );
    expect(await status()).toMatchObject({ status: "bounced", status_detail: "Mailbox full" });
    // чужая фирма не может поменять статус чужого письма
    expect(await applyStatus(q(), other, ev("email.delivered") as never)).toEqual({ updated: 0 });
  });
});
