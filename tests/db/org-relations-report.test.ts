import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";
import { TYPE_PARSERS, type Database } from "@/lib/db/core";
import { ensureAgencyWorkspace, linkBusinessesToAgency } from "@/lib/db/bootstrap";
import { orgRelationsReport } from "@/lib/platform/org-relations-report";

/** M1.2: отчёт классификации — только чтение; Barowo = service; явное создание = client; старая автопривязка = решение владельца. */
const ADMIN = "c1000000-0000-4000-8000-000000000001";
const IVAN = "c1000000-0000-4000-8000-000000000002";
let pg: PGlite;
let db: Database;
const ids: Record<string, string> = {};

beforeAll(async () => {
  pg = await createTestDb();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([k, v]) => [Number(k), v]));
  const wrap = (x: { query: PGlite["query"] }) => ({
    query: (sql: string, params?: unknown[]) => x.query(sql, params, { parsers }) as never,
  });
  db = { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx as never))) };
  for (const id of [ADMIN, IVAN]) await createUser(pg, id);
  await pg.query("update auth.users set is_platform_admin=true where id=$1", [ADMIN]);
  await ensureAgencyWorkspace(db, {}, () => {});
  for (const [key, name, by] of [
    ["barowo", "Barowo", IVAN],
    ["paid", "Studio Płatne", ADMIN],
    ["test", "Firma E2E", ADMIN],
    ["empty", "Kawiarnia", ADMIN],
  ] as const)
    ids[key] = (
      await asUser(pg, by, () =>
        pg.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          name,
          `m12-${key}`,
        ]),
      )
    ).rows[0].id;
  // Как «Nowy biznes»: участие админа платформы помечается обслуживающим.
  for (const key of ["paid", "empty"])
    await asUser(pg, ADMIN, () =>
      pg.query("select public.mark_service_membership($1)", [ids[key]]),
    );
  await linkBusinessesToAgency(db, () => {}); // старая автопривязка при старте (created_by пуст)
  // «Nowy biznes»: явная связь с created_by.
  ids.fresh = (
    await asUser(pg, ADMIN, () =>
      pg.query<{ id: string }>("select public.create_organization('Nowa Firma','m12-fresh') as id"),
    )
  ).rows[0].id;
  await pg.query(
    `insert into public.agency_clients (organization_id, name, client_org_id, status, started_at, created_by)
     select o.id, 'Nowa Firma', $1, 'active', current_date, $2 from public.organizations o where o.industry_preset='agency'`,
    [ids.fresh, ADMIN],
  );
  // Оплаченный счёт Stripe у «Studio Płatne» и (ошибочно) у Barowo.
  for (const key of ["paid", "barowo"])
    await pg.query(
      `insert into public.agency_orders (organization_id, client_id, title, kind, amount_grosze, period_month, status, paid_at, stripe_invoice_id)
       select ac.organization_id, ac.id, 'Abonament', 'retainer', 3900, date_trunc('month', now())::date, 'paid', now(), $2
         from public.agency_clients ac where ac.client_org_id = $1`,
      [ids[key], `in_${key}`],
    );
});
afterAll(() => pg.close());

it("классификация по D-02 и ничего не записывается", async () => {
  const counts = async () =>
    (
      await pg.query<{ c: string }>(
        `select (select count(*) from public.agency_clients)||'/'||(select count(*) from public.agency_orders)
                ||'/'||(select count(*) from public.memberships)||'/'||(select count(*) from public.organizations) as c`,
      )
    ).rows[0].c;
  const before = await counts();
  const rows = await orgRelationsReport(db);
  expect(await counts()).toBe(before);

  const by = (name: string) => rows.find((r) => r.name === name)!;
  expect(by("OWO Ads").proposal).toBe("agency");
  expect(by("Barowo")).toMatchObject({ proposal: "service", confirm_required: false });
  expect(by("Barowo").reasons.join(" ")).toMatch(/M1\.5/);
  // Оплата Stripe — не критерий (D-23): старая автопривязка → решение владельца.
  expect(by("Studio Płatne")).toMatchObject({ proposal: "decide", confirm_required: true });
  expect(by("Studio Płatne").orders.stripe_invoices).toBe(1);
  expect(by("Studio Płatne").reasons.join(" ")).toMatch(/nie kryterium/);
  // Явное создание через OWO → client без подтверждения.
  expect(by("Nowa Firma")).toMatchObject({ proposal: "client", confirm_required: false });
  expect(by("Firma E2E").proposal).toBe("none");
  // Есть строка agency_clients (автопривязка), но нет оплат — это не «client».
  expect(by("Kawiarnia").agency_client?.likely_created_by).toMatch(/automatycznie/);
  expect(by("Kawiarnia").proposal).toBe("decide");
});
