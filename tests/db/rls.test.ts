import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

/**
 * Главный тест безопасности: фирма A никогда не видит данные фирмы B.
 * Запускать после каждой новой миграции с таблицей (добавлять сюда новые таблицы).
 */
const ANNA = "00000000-0000-4000-8000-00000000000a"; // владелец фирмы A
const BARTEK = "00000000-0000-4000-8000-00000000000b"; // владелец фирмы B
const CELINA = "00000000-0000-4000-8000-00000000000c"; // сотрудник фирмы A (member)

let db: PGlite;
let orgA: string;
let orgB: string;

async function createOrg(userId: string, name: string, slug: string) {
  return asUser(db, userId, async () => {
    const res = await db.query<{ id: string }>(`select public.create_organization($1, $2) as id`, [
      name,
      slug,
    ]);
    return res.rows[0].id;
  });
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, ANNA, "Anna Nowak");
  await createUser(db, BARTEK, "Bartek Kowalski");
  await createUser(db, CELINA, "Celina Wiśniewska");
  orgA = await createOrg(ANNA, "Firma A", "firma-a");
  orgB = await createOrg(BARTEK, "Firma B", "firma-a"); // тот же slug → должен получить суффикс
  await db.query(
    `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'member')`,
    [orgA, CELINA],
  );
});

describe("регистрация и создание фирмы", () => {
  it("профиль создаётся автоматически с именем из регистрации", async () => {
    const res = await db.query<{ full_name: string }>(
      `select full_name from public.profiles where user_id = $1`,
      [ANNA],
    );
    expect(res.rows[0].full_name).toBe("Anna Nowak");
  });

  it("создатель фирмы становится владельцем", async () => {
    const res = await db.query<{ role: string }>(
      `select role from public.memberships where organization_id = $1 and user_id = $2`,
      [orgA, ANNA],
    );
    expect(res.rows[0].role).toBe("owner");
  });

  it("занятый адрес фирмы получает уникальный суффикс", async () => {
    const res = await db.query<{ slug: string }>(
      `select slug from public.organizations where id = $1`,
      [orgB],
    );
    expect(res.rows[0].slug).toMatch(/^firma-a-[0-9a-f]{4}$/);
  });

  it("гость не может создать фирму", async () => {
    await expect(
      asUser(db, null, () => db.query(`select public.create_organization('X firma', 'x-firma')`)),
    ).rejects.toThrow();
  });
});

describe("изоляция фирм (RLS)", () => {
  it("владелец A видит только свою фирму", async () => {
    const rows = await asUser(
      db,
      ANNA,
      async () => (await db.query<{ id: string }>(`select id from public.organizations`)).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([orgA]);
  });

  it("владелец B не видит фирму A, её участников и профили", async () => {
    await asUser(db, BARTEK, async () => {
      const orgs = await db.query(`select id from public.organizations where id = $1`, [orgA]);
      const members = await db.query(
        `select * from public.memberships where organization_id = $1`,
        [orgA],
      );
      const profile = await db.query(`select * from public.profiles where user_id = $1`, [ANNA]);
      expect(orgs.rows).toHaveLength(0);
      expect(members.rows).toHaveLength(0);
      expect(profile.rows).toHaveLength(0);
    });
  });

  it("B не может изменить фирму A", async () => {
    await asUser(db, BARTEK, () =>
      db.query(`update public.organizations set name = 'Hacked' where id = $1`, [orgA]),
    );
    const res = await db.query<{ name: string }>(
      `select name from public.organizations where id = $1`,
      [orgA],
    );
    expect(res.rows[0].name).toBe("Firma A");
  });

  it("сотрудник видит коллег, но не может менять данные фирмы", async () => {
    await asUser(db, CELINA, async () => {
      const team = await db.query(
        `select user_id from public.memberships where organization_id = $1`,
        [orgA],
      );
      expect(team.rows).toHaveLength(2);
      const annaProfile = await db.query(
        `select full_name from public.profiles where user_id = $1`,
        [ANNA],
      );
      expect(annaProfile.rows).toHaveLength(1);
      await db.query(`update public.organizations set name = 'Zmiana' where id = $1`, [orgA]);
    });
    const res = await db.query<{ name: string }>(
      `select name from public.organizations where id = $1`,
      [orgA],
    );
    expect(res.rows[0].name).toBe("Firma A");
  });

  it("никто не может сам добавить себя в чужую фирму", async () => {
    await expect(
      asUser(db, BARTEK, () =>
        db.query(
          `insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')`,
          [orgA, BARTEK],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("владелец не может сам продлить пробный период или сменить план", async () => {
    await expect(
      asUser(db, ANNA, () =>
        db.query(`update public.organizations set plan = 'pro' where id = $1`, [orgA]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("владелец может обновить название и цвет своей фирмы", async () => {
    await asUser(db, ANNA, () =>
      db.query(
        `update public.organizations set name = 'Firma A+', brand_color = '#112233' where id = $1`,
        [orgA],
      ),
    );
    const res = await db.query<{ name: string; brand_color: string }>(
      `select name, brand_color from public.organizations where id = $1`,
      [orgA],
    );
    expect(res.rows[0]).toEqual({ name: "Firma A+", brand_color: "#112233" });
  });

  it("владельца нельзя удалить из фирмы", async () => {
    await asUser(db, ANNA, () =>
      db.query(`delete from public.memberships where organization_id = $1 and user_id = $2`, [
        orgA,
        ANNA,
      ]),
    );
    const res = await db.query(
      `select 1 from public.memberships where organization_id = $1 and user_id = $2`,
      [orgA, ANNA],
    );
    expect(res.rows).toHaveLength(1);
  });

  it("гость (anon) не видит ничего", async () => {
    await expect(
      asUser(db, null, () => db.query(`select * from public.organizations`)),
    ).rejects.toThrow(/permission denied/);
  });
});

const leadTables = [
  "pipeline_stages",
  "leads",
  "lead_events",
  "lead_tasks",
  "custom_field_defs",
  "channels",
  "intake_log",
] as const;
const LEAD_A = "10000000-0000-4000-8000-00000000000a";
const CHANNEL_A = "20000000-0000-4000-8000-00000000000a";
const CHANNEL_B = "20000000-0000-4000-8000-00000000000b";

beforeAll(async () => {
  await db.query(
    `insert into public.channels (id, organization_id, type, name, secret_hash) values ($1,$2,'website','Formularz A','private-hash'), ($3,$4,'website','Formularz B','other-hash')`,
    [CHANNEL_A, orgA, CHANNEL_B, orgB],
  );
  await db.query(
    `insert into public.leads (id, organization_id, client_name, phone_e164, source_channel_id) values ($1,$2,'Anna Test','+48600100200',$3)`,
    [LEAD_A, orgA, CHANNEL_A],
  );
  await db.query(
    `insert into public.lead_events (organization_id, lead_id, type, actor_user_id) values ($1,$2,'created',$3)`,
    [orgA, LEAD_A, ANNA],
  );
  await db.query(
    `insert into public.lead_tasks (organization_id, lead_id, title, due_at) values ($1,$2,'Telefon',now())`,
    [orgA, LEAD_A],
  );
  await db.query(
    `insert into public.custom_field_defs (organization_id,key,label_pl,type) values ($1,'test','Test','text')`,
    [orgA],
  );
  await db.query(
    `insert into public.intake_log (organization_id,channel_id,ok) values ($1,$2,true)`,
    [orgA, CHANNEL_A],
  );
});

describe("лиды: изоляция всех семи таблиц", () => {
  for (const table of leadTables) {
    const column = table === "channels" ? "id" : "organization_id";
    it(`${table}: сотрудник A видит записи A, владелец B и гость не видят их`, async () => {
      const own = await asUser(db, CELINA, () =>
        db.query(`select ${column} from public.${table} where organization_id = $1`, [orgA]),
      );
      expect(own.rows.length).toBeGreaterThan(0);
      const foreign = await asUser(db, BARTEK, () =>
        db.query(`select ${column} from public.${table} where organization_id = $1`, [orgA]),
      );
      expect(foreign.rows).toHaveLength(0);
      await expect(
        asUser(db, null, () => db.query(`select ${column} from public.${table}`)),
      ).rejects.toThrow(/permission denied/);
    });
  }

  const foreignInserts = [
    `insert into public.pipeline_stages (organization_id,key,label_pl,position) values ($1,'foreign','X',100)`,
    `insert into public.channels (organization_id,type,name) values ($1,'website','X')`,
    `insert into public.leads (organization_id,client_name) values ($1,'X')`,
    `insert into public.lead_events (organization_id,lead_id,type,actor_user_id) values ($1,'${LEAD_A}','note','${BARTEK}')`,
    `insert into public.lead_tasks (organization_id,lead_id,title,due_at) values ($1,'${LEAD_A}','X',now())`,
    `insert into public.custom_field_defs (organization_id,key,label_pl,type) values ($1,'foreign','X','text')`,
    `insert into public.intake_log (organization_id,channel_id,ok) values ($1,'${CHANNEL_A}',true)`,
  ];
  foreignInserts.forEach((sql, index) => {
    it(`чужая вставка ${index + 1} запрещена`, async () => {
      await expect(asUser(db, BARTEK, () => db.query(sql, [orgA]))).rejects.toThrow(
        /row-level security|permission denied/,
      );
    });
  });

  const updates = [
    ["pipeline_stages", "label_pl = 'Hacked'"],
    ["channels", "name = 'Hacked'"],
    ["leads", "client_name = 'Hacked'"],
    ["lead_tasks", "title = 'Hacked'"],
    ["custom_field_defs", "label_pl = 'Hacked'"],
  ];
  for (const [table, assignment] of updates) {
    it(`${table}: нельзя изменить или удалить строки чужой фирмы`, async () => {
      const update = await asUser(db, BARTEK, () =>
        db.query(`update public.${table} set ${assignment} where organization_id = $1`, [orgA]),
      );
      expect(update.affectedRows).toBe(0);
      if (table !== "leads") {
        const remove = await asUser(db, BARTEK, () =>
          db.query(`delete from public.${table} where organization_id = $1`, [orgA]),
        );
        expect(remove.affectedRows).toBe(0);
      }
    });
  }

  it("историю и журнал приёма нельзя переписывать даже владельцу", async () => {
    for (const table of ["lead_events", "intake_log"]) {
      await expect(
        asUser(db, ANNA, () =>
          db.query(`delete from public.${table} where organization_id = $1`, [orgA]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asUser(db, ANNA, () => db.query(`update public.${table} set organization_id = $1`, [orgA])),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("ключи фирмы и источник/номер лида защищены от переноса", async () => {
    await expect(
      asUser(db, ANNA, () =>
        db.query(`update public.leads set organization_id = $1 where id = $2`, [orgB, LEAD_A]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, () =>
        db.query(`update public.leads set number = 100 where id = $1`, [LEAD_A]),
      ),
    ).rejects.toThrow();
  });

  it("связи с каналом, лидом и сотрудником другой фирмы запрещены даже серверу", async () => {
    await expect(
      db.query(
        `insert into public.leads (organization_id,client_name,email,source_channel_id) values ($1,'X','x@example.com',$2)`,
        [orgA, CHANNEL_B],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into public.leads (organization_id,client_name,email,assigned_to) values ($1,'X','x@example.com',$2)`,
        [orgA, BARTEK],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into public.lead_tasks (organization_id,lead_id,title,due_at) values ($1,$2,'X',now())`,
        [orgB, LEAD_A],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into public.lead_events (organization_id,lead_id,type) values ($1,$2,'created')`,
        [orgB, LEAD_A],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into public.intake_log (organization_id,channel_id,ok) values ($1,$2,true)`,
        [orgA, CHANNEL_B],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(`update public.leads set stage_key = 'not_existing' where id = $1`, [LEAD_A]),
    ).rejects.toThrow(/foreign key/);
  });

  it("сотрудник может создать лид и задачу, но не менять настройки канала", async () => {
    await asUser(db, CELINA, async () => {
      const lead = await db.query<{ id: string }>(
        `insert into public.leads (organization_id,client_name,email,assigned_to) values ($1,'Celina','celina@example.com',$2) returning id`,
        [orgA, CELINA],
      );
      await db.query(
        `insert into public.lead_tasks (organization_id,lead_id,title,due_at) values ($1,$2,'Kontakt',now())`,
        [orgA, lead.rows[0].id],
      );
      const changed = await db.query(`update public.channels set name = 'Hacked' where id = $1`, [
        CHANNEL_A,
      ]);
      expect(changed.affectedRows).toBe(0);
    });
  });

  it("нельзя подделать автора события или прочитать секрет канала", async () => {
    await expect(
      asUser(db, CELINA, () =>
        db.query(
          `insert into public.lead_events (organization_id,lead_id,type,actor_user_id) values ($1,$2,'note',$3)`,
          [orgA, LEAD_A, ANNA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, ANNA, () => db.query(`select secret_hash from public.channels`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("стандартные девять этапов есть у каждой фирмы (0015: umowa podpisana)", async () => {
    const stages = await db.query<{ key: string }>(
      `select key from public.pipeline_stages where organization_id = $1 order by position`,
      [orgB],
    );
    expect(stages.rows.map((s) => s.key)).toEqual([
      "new",
      "contacted",
      "offer_sent",
      "offer_accepted",
      "contract_sent",
      "contract_signed",
      "deposit_paid",
      "rejected",
      "spam",
    ]);
  });
});

describe("telegram_links: RLS и одноразовая привязка", () => {
  it("пользователь создаёт код только себе и не может прочитать хеш или чужую привязку", async () => {
    await asUser(db, ANNA, () =>
      db.query(`select public.create_telegram_link($1,$2)`, [orgA, "a".repeat(64)]),
    );
    await asUser(db, BARTEK, () =>
      db.query(`select public.create_telegram_link($1,$2)`, [orgB, "b".repeat(64)]),
    );
    const own = await asUser(db, ANNA, () => db.query(`select user_id from public.telegram_links`));
    expect(own.rows).toEqual([{ user_id: ANNA }]);
    const team = await asUser(db, CELINA, () =>
      db.query(`select user_id from public.telegram_links where organization_id=$1`, [orgA]),
    );
    expect(team.rows).toHaveLength(0);
    await expect(
      asUser(db, BARTEK, () =>
        db.query(`select public.create_telegram_link($1,$2)`, [orgA, "c".repeat(64)]),
      ),
    ).rejects.toThrow(/not a member/);
    await expect(
      asUser(db, ANNA, () => db.query(`select link_token_hash from public.telegram_links`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, null, () => db.query(`select user_id from public.telegram_links`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, () => db.query(`update public.telegram_links set chat_id=999`)),
    ).rejects.toThrow(/permission denied/);
  });
  it("код нельзя повторить, Telegram не может редактировать лид другой фирмы", async () => {
    const result = await db.query<{ ok: boolean }>(
      `select public.redeem_telegram_link($1,123,456) as ok`,
      ["a".repeat(64)],
    );
    expect(result.rows[0].ok).toBe(true);
    expect(
      (
        await db.query<{ ok: boolean }>(`select public.redeem_telegram_link($1,123,456) as ok`, [
          "a".repeat(64),
        ])
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await db.query<{ ok: boolean }>(`select public.telegram_contact_lead(123,999,$1) as ok`, [
          LEAD_A,
        ])
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await db.query<{ ok: boolean }>(`select public.telegram_contact_lead(123,456,$1) as ok`, [
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
        ])
      ).rows[0].ok,
    ).toBe(false);
    await expect(
      asUser(db, ANNA, () =>
        db.query(`select public.redeem_telegram_link($1,123,456)`, ["a".repeat(64)]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("повтор Telegram update создаёт один лид и пишет правильного автора", async () => {
    const input = JSON.stringify({ client_name: "Telegram test", phone_e164: "+48600100999" });
    const first = await db.query<{ result: { id: string } }>(
      `select public.telegram_ingest(123,456,$1,100) as result`,
      [input],
    );
    const repeat = await db.query<{ result: { id: string } }>(
      `select public.telegram_ingest(123,456,$1,100) as result`,
      [input],
    );
    expect(repeat.rows[0].result.id).toBe(first.rows[0].result.id);
    const events = await db.query<{ actor_user_id: string }>(
      `select actor_user_id from public.lead_events where lead_id=$1 and type='created'`,
      [first.rows[0].result.id],
    );
    expect(events.rows).toEqual([{ actor_user_id: ANNA }]);
  });
});

describe("push_subscriptions: только собственные устройства", () => {
  it("нельзя читать, изменять или удалять чужую подписку, даже коллеге", async () => {
    await asUser(db, ANNA, () =>
      db.query(
        `insert into public.push_subscriptions(organization_id,user_id,endpoint,keys) values($1,$2,'https://fcm.googleapis.com/fcm/send/anna',$3)`,
        [orgA, ANNA, JSON.stringify({ p256dh: "a", auth: "b" })],
      ),
    );
    const own = await asUser(db, ANNA, () =>
      db.query(`select user_id from public.push_subscriptions`),
    );
    expect(own.rows).toEqual([{ user_id: ANNA }]);
    for (const user of [BARTEK, CELINA])
      await asUser(db, user, async () => {
        expect((await db.query(`select id from public.push_subscriptions`)).rows).toHaveLength(0);
        expect(
          (await db.query(`update public.push_subscriptions set user_agent='Hacked'`)).affectedRows,
        ).toBe(0);
        expect((await db.query(`delete from public.push_subscriptions`)).affectedRows).toBe(0);
      });
    await expect(
      asUser(db, BARTEK, () =>
        db.query(
          `insert into public.push_subscriptions(organization_id,user_id,endpoint,keys) values($1,$2,'https://fcm.googleapis.com/foreign',$3)`,
          [orgA, BARTEK, JSON.stringify({ p256dh: "a", auth: "b" })],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, ANNA, () => db.query(`update public.push_subscriptions set user_id=$1`, [CELINA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, null, () => db.query(`select id from public.push_subscriptions`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("notification_settings и notification_deliveries: RLS", () => {
  it("настройки собственные, доставки только своей фирмы, клиент не меняет очередь", async () => {
    const own = await asUser(db, CELINA, () =>
      db.query<{ user_id: string }>(`select user_id from public.notification_settings`),
    );
    expect(own.rows).toHaveLength(3);
    expect(own.rows.every((row) => row.user_id === CELINA)).toBe(true);
    const foreign = await asUser(db, BARTEK, () =>
      db.query(`select id from public.notification_deliveries where organization_id=$1`, [orgA]),
    );
    expect(foreign.rows).toHaveLength(0);
    await asUser(db, BARTEK, async () => {
      expect(
        (
          await db.query(
            `update public.notification_settings set enabled=false where organization_id=$1`,
            [orgA],
          )
        ).affectedRows,
      ).toBe(0);
    });
    await expect(
      asUser(db, ANNA, () =>
        db.query(`update public.notification_settings set user_id=$1`, [CELINA]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, () => db.query(`delete from public.notification_deliveries`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, () => db.query(`update public.notification_deliveries set status='sent'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, () => db.query(`select public.claim_notification_jobs()`)),
    ).rejects.toThrow(/permission denied/);
    for (const table of ["notification_settings", "notification_deliveries"])
      await expect(
        asUser(db, null, () => db.query(`select * from public.${table}`)),
      ).rejects.toThrow(/permission denied/);
  });
});

it("удаление сотрудника снимает назначение и доступ только в этой фирме, сохраняет историю", async () => {
  await db.query(
    `insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`,
    [orgB, CELINA],
  );
  async function staffLead(org: string, email: string) {
    const result = await asUser(db, CELINA, () =>
      db.query<{ result: { id: string } }>(
        `select public.ingest_lead($1,null,'Ręcznie',null,$2) as result`,
        [org, JSON.stringify({ client_name: "Staff", email })],
      ),
    );
    const id = result.rows[0].result.id;
    await asUser(db, CELINA, () =>
      db.query(`update public.leads set assigned_to=$1 where id=$2`, [CELINA, id]),
    );
    return id;
  }
  const a = await staffLead(orgA, "staff-a@example.com");
  const b = await staffLead(orgB, "staff-b@example.com");
  const removed = await asUser(db, ANNA, () =>
    db.query(`delete from public.memberships where organization_id=$1 and user_id=$2`, [
      orgA,
      CELINA,
    ]),
  );
  expect(removed.affectedRows).toBe(1);
  expect(
    (
      await db.query<{ assigned_to: string | null }>(
        `select assigned_to from public.leads where id=$1`,
        [a],
      )
    ).rows[0].assigned_to,
  ).toBeNull();
  const history = await db.query<{ actor_user_id: string | null }>(
    `select actor_user_id from public.lead_events where lead_id=$1 and type='created'`,
    [a],
  );
  expect(history.rows).toEqual([{ actor_user_id: null }]);
  expect(
    (
      await db.query<{ assigned_to: string }>(`select assigned_to from public.leads where id=$1`, [
        b,
      ])
    ).rows[0].assigned_to,
  ).toBe(CELINA);
  expect(
    (await asUser(db, CELINA, () => db.query(`select id from public.leads where id=$1`, [a]))).rows,
  ).toHaveLength(0);
  expect(
    (await asUser(db, CELINA, () => db.query(`select id from public.leads where id=$1`, [b]))).rows,
  ).toHaveLength(1);
});
