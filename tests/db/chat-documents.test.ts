import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database, type Queryable } from "@/lib/db/core";
import { encryptSecret } from "@/lib/mail/secret";
import { sendChatMessage, type ChatSendDeps } from "@/lib/mail/chat-send";
import { DEFAULT_LOOK } from "@/lib/mailing/render";
import { applyImport, importFile, planImport } from "@/lib/mailing/import-templates";
import { generateGuestMenu, generateOffer, offerFormDefaults } from "@/lib/documents/service";
import type { PackageKey } from "@/lib/documents/barowo/engine";

/**
 * Работа с клиентом через чат (решение 053): шаблоны-документы, отправка PDF из чата
 * по D-20 (outbox, идемпотентность, unknown без автоповтора), сдвиг этапа, изоляция фирм.
 */
const OWNER = "53000000-0000-4000-8000-000000000001";
const MEMBER = "53000000-0000-4000-8000-000000000002";
const STRANGER = "53000000-0000-4000-8000-000000000003";

let pg: PGlite;
let db: Database;
let org: string;
let other: string;
let otherTemplate: string;
const tpl: Record<string, string> = {};

const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
const wrap = (q: { query: PGlite["query"]; exec: PGlite["exec"] }) => ({
  query: (sql: string, params?: unknown[]) => q.query(sql, params, { parsers }) as never,
  exec: (sql: string) => q.exec(sql),
});

async function newLead(fields: { email?: string | null; stage?: string; guests?: number } = {}) {
  return (
    await pg.query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, email, phone_e164, stage_key, event_date, guests, venue, service_hours)
       values ($1, 'Anna Nowak', $2, '+48500100200', $3, '2027-06-12', $4, 'Dwór Oliwski', '18:00-24:00') returning id`,
      [
        org,
        fields.email === undefined ? "anna@example.com" : fields.email,
        fields.stage ?? "contacted",
        fields.guests ?? 80,
      ],
    )
  ).rows[0].id;
}

/** Resend: принимает письмо и возвращает id; запоминает запросы. */
function resend(behaviour: "ok" | "timeout" | "refused" = "ok") {
  const calls: {
    headers: Record<string, string>;
    body: { attachments?: { filename: string; content: string }[]; subject: string; html: string };
  }[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    if (behaviour === "timeout")
      throw new DOMException("The operation was aborted", "TimeoutError");
    if (behaviour === "refused")
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return Response.json({ id: `re_${calls.length}_${randomUUID().slice(0, 8)}` });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function deps(user: string, mail: ChatSendDeps["mail"], orgId = org): ChatSendDeps {
  return {
    db,
    runAsUser: (fn) => asUser(pg, user, () => fn(wrap(pg) as Queryable)),
    ctx: {
      userId: user,
      organization: {
        id: orgId,
        name: "Barowo",
        documentEngine: "barowo",
        modules: ["documents"],
        email: "kontakt@barowo.com",
        phone: null,
      },
    },
    origin: "https://crm.example.com",
    look: DEFAULT_LOOK,
    mail,
    generateQuickOffer: async (tx, { leadId, pkg, values, operationKey }) => {
      const defaults = await offerFormDefaults(tx, org, leadId, pkg as PackageKey);
      return generateOffer(
        tx,
        { userId: user, orgId: org, operationKey },
        leadId,
        pkg as PackageKey,
        { ...defaults, ...values, listPrice: "" },
        "kontakt@barowo.com",
      );
    },
  };
}

const count = async (sql: string, params: unknown[] = []) =>
  (await pg.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0].n;
const stageOf = async (lead: string) =>
  (await pg.query<{ s: string }>("select stage_key s from public.leads where id=$1", [lead]))
    .rows[0].s;
const quickValues = {
  date: "12.06.2027",
  venue: "Dwór Oliwski",
  guests: "120",
  hours: "18:00-24:00",
  price: "7450",
};

beforeAll(async () => {
  process.env.MAIL_SECRET_KEY = randomBytes(32).toString("base64");
  pg = await createTestDb();
  db = {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never) as never)),
  } as Database;
  for (const id of [OWNER, MEMBER, STRANGER]) await createUser(pg, id);
  const make = (user: string, name: string) =>
    asUser(
      pg,
      user,
      async () =>
        (
          await pg.query<{ id: string }>("select public.create_organization($1,$2) as id", [
            name,
            name.toLowerCase(),
          ])
        ).rows[0].id,
    );
  org = await make(OWNER, "Barowo");
  other = await make(STRANGER, "Obca");
  await pg.query(
    "insert into public.memberships (organization_id,user_id,role) values ($1,$2,'member')",
    [org, MEMBER],
  );
  await pg.query("update public.organizations set document_engine='barowo' where id=$1", [org]);
  for (const o of [org, other])
    await pg.query(
      `insert into public.organization_mail_settings (organization_id, transport, from_name, from_email, secret_ciphertext, daily_limit)
       values ($1,'resend','Barowo','kontakt@barowo.com',$2,1000)`,
      [o, encryptSecret("re_test")],
    );
  // стартовый набор Barowo — тем же импортом, что и в продакшене
  const file = importFile.parse(JSON.parse(readFileSync("templates/barowo.json", "utf8")));
  await applyImport(db, org, file.templates, { engine: "barowo" });
  for (const r of (
    await pg.query<{ id: string; name: string }>(
      "select id, name from public.mailing_templates where organization_id=$1",
      [org],
    )
  ).rows)
    tpl[r.name] = r.id;
  otherTemplate = (
    await pg.query<{ id: string }>(
      `insert into public.mailing_templates (organization_id, name, subject, body) values ($1,'Obcy','x','y') returning id`,
      [other],
    )
  ).rows[0].id;
});
afterAll(() => pg.close());

describe("шаблоны-документы в mailing_templates", () => {
  it("старые и новые обычные шаблоны — purpose='mail'; документный обязан сказать, что прикладывать", async () => {
    const { rows } = await pg.query<{ purpose: string }>(
      "select purpose from public.mailing_templates where id=$1",
      [otherTemplate],
    );
    expect(rows[0].purpose).toBe("mail");
    await expect(
      pg.query(
        `insert into public.mailing_templates (organization_id, name, subject, body, purpose) values ($1,'Zły','s','b','document')`,
        [org],
      ),
    ).rejects.toThrow(/document_shape/);
    await expect(
      pg.query(
        `insert into public.mailing_templates (organization_id, name, subject, body, document_kind) values ($1,'Zły2','s','b','offer')`,
        [org],
      ),
    ).rejects.toThrow(/document_shape/);
  });

  it("сотрудник может править обычные шаблоны, но не документные", async () => {
    await asUser(pg, MEMBER, async () => {
      await pg.query(
        `insert into public.mailing_templates (organization_id, name, subject, body) values ($1,'Moja','s','b')`,
        [org],
      );
      await expect(
        pg.query(
          `insert into public.mailing_templates (organization_id, name, subject, body, purpose, document_kind, document_mode, document_params)
           values ($1,'Moja oferta','s','b','document','offer','quick','{"package":"simple"}')`,
          [org],
        ),
      ).rejects.toThrow();
      const r = await pg.query(
        "update public.mailing_templates set quick_label='X' where organization_id=$1 and name='Oferta Simple'",
        [org],
      );
      expect(r.affectedRows).toBe(0);
    });
  });

  it("импорт: по умолчанию ничего не пишет, повтор — пропуск, без генератора и без этапа — ошибка", async () => {
    const file = importFile.parse(JSON.parse(readFileSync("templates/barowo.json", "utf8")));
    const before = await count("public.mailing_templates where organization_id=$1", [org]);
    const plan = await planImport(db, org, file.templates, { engine: "barowo" });
    expect(plan.every((r) => r.action === "skip_exists")).toBe(true);
    expect(await count("public.mailing_templates where organization_id=$1", [org])).toBe(before);
    await applyImport(db, org, file.templates, { engine: "barowo" });
    expect(await count("public.mailing_templates where organization_id=$1", [org])).toBe(before);
    // у чужой фирмы нет генератора Barowo — документные шаблоны не принимаются
    const foreign = await planImport(db, other, file.templates, { engine: null });
    expect(foreign.filter((r) => r.action === "error").length).toBe(6);
    await expect(applyImport(db, other, file.templates, { engine: null })).rejects.toThrow();
    expect(await count("public.mailing_templates where organization_id=$1", [other])).toBe(1);
    const noStage = await planImport(
      db,
      org,
      [{ ...file.templates[0], name: "Nowa", stage_after: "nie_ma" }],
      { engine: "barowo" },
    );
    expect(noStage[0]).toMatchObject({ action: "error" });
  });

  it("импорт готового PDF: файл проверяется и принадлежит фирме", async () => {
    const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n%cennik\n"));
    const file = importFile.parse({
      templates: [
        {
          name: "Cennik",
          subject: "Cennik",
          body: "W załączniku cennik.",
          purpose: "document",
          document_kind: "file",
          file: "cennik.pdf",
          quick_label: "Cennik",
          quick_position: 90,
        },
      ],
    });
    expect(
      (
        await planImport(db, other, file.templates, {
          files: { "cennik.pdf": new Uint8Array([1, 2, 3, 4, 5]) },
        })
      )[0],
    ).toMatchObject({ action: "error" });
    await applyImport(db, other, file.templates, { files: { "cennik.pdf": pdf } });
    const row = (
      await pg.query<{ attachment_id: string }>(
        "select attachment_id from public.mailing_templates where organization_id=$1 and name='Cennik'",
        [other],
      )
    ).rows[0];
    expect(row.attachment_id).toBeTruthy();
    await asUser(pg, OWNER, async () => {
      expect(
        (await pg.query("select 1 from public.template_files where id=$1", [row.attachment_id]))
          .rows,
      ).toHaveLength(0);
    });
  });
});

describe("отправка документа из чата", () => {
  it("Simple: PDF во вложении, письмо в переписке, документ «sent», этап вперёд, событие в истории", async () => {
    const lead = await newLead();
    const mail = resend();
    const operationId = randomUUID();
    const result = await sendChatMessage(
      {
        operationId,
        leadId: lead,
        templateId: tpl["Oferta Simple"],
        values: quickValues,
        text: "",
      },
      deps(OWNER, { fetch: mail.fetch }),
    );
    expect(result).toMatchObject({
      status: "sent",
      stage: { from: "contacted", to: "offer_sent" },
    });
    expect(mail.calls).toHaveLength(1);
    const sent = mail.calls[0];
    expect(sent.headers["Idempotency-Key"]).toBe(operationId);
    expect(sent.body.attachments).toHaveLength(1);
    expect(sent.body.attachments![0].filename).toMatch(/^Oferta_BAROWO_.*\.pdf$/);
    expect(Buffer.from(sent.body.attachments![0].content, "base64").subarray(0, 4).toString()).toBe(
      "%PDF",
    );
    expect(sent.body.subject).toBe("Oferta Barowo — pakiet Simple");

    const doc = (
      await pg.query<{
        id: string;
        status: string;
        sent_at: string | null;
        snapshot: { packageName: string; guests: string | number; price: number };
      }>(
        "select id, status, sent_at, snapshot from public.documents where organization_id=$1 and lead_id=$2",
        [org, lead],
      )
    ).rows;
    expect(doc).toHaveLength(1);
    expect(doc[0]).toMatchObject({ status: "sent" });
    expect(doc[0].sent_at).not.toBeNull();
    expect(doc[0].snapshot.packageName).toBe("Simple");
    expect(String(doc[0].snapshot.guests)).toBe("120"); // значение из чата, а не из лида (80)
    expect(Number(doc[0].snapshot.price)).toBe(7450);

    const msg = (
      await pg.query<{
        attachments: { fileId: string; filename: string }[];
        document_id: string;
        provider_id: string;
        status: string;
      }>(
        "select attachments, document_id, provider_id, status from public.mail_messages where organization_id=$1 and lead_id=$2",
        [org, lead],
      )
    ).rows;
    expect(msg).toHaveLength(1);
    expect(msg[0]).toMatchObject({ document_id: doc[0].id, status: "sent" });
    expect(msg[0].provider_id).toMatch(/^re_/);
    expect(msg[0].attachments[0].filename).toMatch(/\.pdf$/);
    expect(
      await count("public.document_files where id=$1 and format='pdf'", [
        msg[0].attachments[0].fileId,
      ]),
    ).toBe(1);
    // DOCX остаётся доступным
    expect(
      await count("public.document_files where document_id=$1 and format='docx'", [doc[0].id]),
    ).toBe(1);
    expect(await stageOf(lead)).toBe("offer_sent");
    expect(await count("public.lead_events where lead_id=$1 and type='email_sent'", [lead])).toBe(
      1,
    );
    // в outbox по §4.6 не остаётся текста письма
    const op = (
      await pg.query<{ status: string; params: Record<string, unknown>; finalized_at: string }>(
        "select status, params, finalized_at from public.outbound_messages where step_key=$1",
        [`ui:${operationId}`],
      )
    ).rows[0];
    expect(op.status).toBe("sent");
    expect(op.finalized_at).not.toBeNull();
    expect(op.params.pending).toBeUndefined();

    // повторное нажатие с той же операцией — ни второго письма, ни второго документа
    const again = await sendChatMessage(
      {
        operationId,
        leadId: lead,
        templateId: tpl["Oferta Simple"],
        values: quickValues,
        text: "",
      },
      deps(OWNER, { fetch: mail.fetch }),
    );
    expect(again.status).toBe("sent");
    expect(mail.calls).toHaveLength(1);
    expect(await count("public.documents where lead_id=$1", [lead])).toBe(1);
    expect(await count("public.mail_messages where lead_id=$1", [lead])).toBe(1);
  });

  it("Standard и Premium берут свой пакет; изменённые данные — новый снимок", async () => {
    for (const [name, pkg] of [
      ["Oferta Standard", "Standard"],
      ["Oferta Premium", "Premium"],
    ] as const) {
      const lead = await newLead();
      const r = await sendChatMessage(
        {
          operationId: randomUUID(),
          leadId: lead,
          templateId: tpl[name],
          values: { ...quickValues, guests: "60", price: "5100" },
          text: "",
        },
        deps(OWNER, { fetch: resend().fetch }),
      );
      expect(r.status).toBe("sent");
      const snap = (
        await pg.query<{ snapshot: { packageName: string; guests: number | string } }>(
          "select snapshot from public.documents where lead_id=$1",
          [lead],
        )
      ).rows[0].snapshot;
      expect(snap.packageName).toBe(pkg);
      expect(String(snap.guests)).toBe("60");
    }
  });

  it("нет ответа от Resend → unknown, без автоповтора; документ не дублируется", async () => {
    const lead = await newLead();
    const mail = resend("timeout");
    const operationId = randomUUID();
    const input = {
      operationId,
      leadId: lead,
      templateId: tpl["Oferta Standard"],
      values: quickValues,
      text: "",
    };
    expect((await sendChatMessage(input, deps(OWNER, { fetch: mail.fetch }))).status).toBe(
      "unknown",
    );
    expect((await sendChatMessage(input, deps(OWNER, { fetch: resend().fetch }))).status).toBe(
      "unknown",
    );
    expect(mail.calls).toHaveLength(1);
    expect(await count("public.mail_messages where lead_id=$1", [lead])).toBe(0);
    expect(await stageOf(lead)).toBe("contacted"); // этап — только после подтверждённой отправки
    expect(await count("public.documents where lead_id=$1 and status='generated'", [lead])).toBe(1);
  });

  it("отказ до отправки → ошибка, повтор той же операцией отправляет с тем же документом", async () => {
    const lead = await newLead();
    const operationId = randomUUID();
    const input = {
      operationId,
      leadId: lead,
      templateId: tpl["Oferta Premium"],
      values: quickValues,
      text: "",
    };
    const first = await sendChatMessage(input, deps(OWNER, { fetch: resend("refused").fetch }));
    expect(first).toMatchObject({ status: "error", code: "connection_failed" });
    expect(await count("public.mail_messages where lead_id=$1", [lead])).toBe(0);
    const second = await sendChatMessage(input, deps(OWNER, { fetch: resend().fetch }));
    expect(second.status).toBe("sent");
    expect(await count("public.documents where lead_id=$1", [lead])).toBe(1);
  });

  it("меню из формы (documentId) уходит без смены этапа", async () => {
    const lead = await newLead();
    const doc = await asUser(pg, OWNER, () =>
      generateGuestMenu(
        wrap(pg) as Queryable,
        { userId: OWNER, orgId: org },
        lead,
        "Mojito | Rum, mięta\nHugo | Prosecco",
      ),
    );
    const r = await sendChatMessage(
      {
        operationId: randomUUID(),
        leadId: lead,
        templateId: tpl["Menu dla gości"],
        documentId: doc.id,
        text: "",
      },
      deps(OWNER, { fetch: resend().fetch }),
    );
    expect(r).toMatchObject({ status: "sent", stage: null });
    expect(await stageOf(lead)).toBe("contacted");
  });

  it("лид на won не двигается; без целевого этапа отправка всё равно успешна", async () => {
    const won = await newLead({ stage: "deposit_paid" });
    const r1 = await sendChatMessage(
      {
        operationId: randomUUID(),
        leadId: won,
        templateId: tpl["Oferta Simple"],
        values: quickValues,
        text: "",
      },
      deps(OWNER, { fetch: resend().fetch }),
    );
    expect(r1).toMatchObject({ status: "sent", stage: null });
    expect(await stageOf(won)).toBe("deposit_paid");
    await pg
      .query("update public.mailing_templates set stage_after='nie_ma_takiego' where id=$1", [
        tpl["Oferta Premium"],
      ])
      .catch(() => null);
  });

  it("форма-шаблон без документа и шаблон без генератора — понятная ошибка, письма нет", async () => {
    const lead = await newLead();
    const mail = resend();
    const r = await sendChatMessage(
      { operationId: randomUUID(), leadId: lead, templateId: tpl["Umowa"], text: "" },
      deps(OWNER, { fetch: mail.fetch }),
    );
    expect(r).toMatchObject({ status: "error", code: "document_required" });
    const noEngine = deps(OWNER, { fetch: mail.fetch });
    noEngine.ctx.organization.documentEngine = null;
    const r2 = await sendChatMessage(
      {
        operationId: randomUUID(),
        leadId: lead,
        templateId: tpl["Oferta Simple"],
        values: quickValues,
        text: "",
      },
      noEngine,
    );
    expect(r2).toMatchObject({ status: "error", code: "engine_missing" });
    expect(mail.calls).toHaveLength(0);
  });

  it("лид без e-mail — отправка невозможна, адрес из браузера не подставляется", async () => {
    const lead = await newLead({ email: null });
    const mail = resend();
    const r = await sendChatMessage(
      { operationId: randomUUID(), leadId: lead, to: "hacker@example.com", text: "Cześć" },
      deps(OWNER, { fetch: mail.fetch }),
    );
    expect(r).toMatchObject({ status: "error", code: "no_email" });
    expect(mail.calls).toHaveLength(0);
  });

  it("чужие шаблон, документ и лид недоступны", async () => {
    const lead = await newLead();
    const mail = resend();
    const r1 = await sendChatMessage(
      { operationId: randomUUID(), leadId: lead, templateId: otherTemplate, text: "x" },
      deps(OWNER, { fetch: mail.fetch }),
    );
    expect(r1).toMatchObject({ status: "error", code: "template_not_found" });
    const doc = (
      await pg.query<{ id: string }>(
        "select id from public.documents where organization_id=$1 limit 1",
        [org],
      )
    ).rows[0].id;
    const r2 = await sendChatMessage(
      {
        operationId: randomUUID(),
        leadId: lead,
        templateId: tpl["Menu dla gości"],
        documentId: doc,
        text: "",
      },
      deps(STRANGER, { fetch: mail.fetch }, other),
    );
    expect(r2.status).toBe("error");
    expect(mail.calls).toHaveLength(0);
    // чужой ключ операции не раскрывает чужую операцию
    const op = (
      await pg.query<{ step_key: string }>(
        "select step_key from public.outbound_messages where organization_id=$1 limit 1",
        [org],
      )
    ).rows[0].step_key;
    const r3 = await sendChatMessage(
      { operationId: op.slice(3), to: "x@example.com", text: "x" },
      deps(STRANGER, { fetch: mail.fetch }, other),
    );
    expect(r3).toMatchObject({ status: "error", code: "operation_conflict" });
  });

  it("SMTP: письмо уходит, статус остаётся «sent» без выдуманного provider_id", async () => {
    await pg.query(
      "update public.organization_mail_settings set transport='smtp', smtp_host='smtp.gmail.com', smtp_port=587, smtp_user='kontakt@barowo.com' where organization_id=$1",
      [org],
    );
    const sendMail = vi.fn(async () => ({ messageId: "<x@gmail>" }));
    const lead = await newLead();
    const r = await sendChatMessage(
      { operationId: randomUUID(), leadId: lead, text: "Dzień dobry, potwierdzamy termin." },
      deps(OWNER, { smtp: () => ({ sendMail }) }),
    );
    expect(r.status).toBe("sent");
    expect(sendMail).toHaveBeenCalledTimes(1);
    const msg = (
      await pg.query<{ provider_id: string | null; status: string; body_text: string }>(
        "select provider_id, status, body_text from public.mail_messages where lead_id=$1",
        [lead],
      )
    ).rows[0];
    expect(msg).toMatchObject({
      provider_id: null,
      status: "sent",
      body_text: "Dzień dobry, potwierdzamy termin.",
    });
    await pg.query(
      "update public.organization_mail_settings set transport='resend' where organization_id=$1",
      [org],
    );
  });
});
