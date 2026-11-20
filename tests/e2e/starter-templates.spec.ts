import { expect, test } from "@playwright/test";
import pg from "pg";

/** Решение 053: стартовые шаблоны документов добавляются кнопкой в «Ustawienia → Poczta». */
test("zestaw startowy → przyciski dokumentów w karcie leada", async ({ page }, info) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  // Nowa firma bez szablonów, z generatorem Barowo — jak świeży gabinet klienta.
  const user = (
    await c.query<{ id: string }>("select id from auth.users where email='e2e@owo.test'")
  ).rows[0].id;
  await c.query("begin");
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  await c.query("set local role authenticated");
  const slug = `starter-${info.project.name}-${Date.now()}`;
  const org = (
    await c.query<{ id: string }>("select public.create_organization($1, $2) as id", [
      `Starter ${info.project.name}`,
      slug,
    ])
  ).rows[0];
  await c.query("commit");
  await c.query("update public.organizations set document_engine='barowo' where id=$1", [org.id]);
  const lead = (
    await c.query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, email, phone_e164, stage_key)
       values ($1, $2, 'starter@example.com', '+48500100200', 'new') returning id`,
      [org.id, `Starter ${info.project.name}`],
    )
  ).rows[0].id;
  await c.end();

  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
  await page.context().addCookies([{ name: "owo_org", value: org.id, url: page.url() }]);

  await page.goto(`/leady/${lead}`);
  await expect(page.locator("[data-quick-actions]")).toHaveCount(0);
  await page.goto("/ustawienia/poczta");
  await page.getByRole("button", { name: "Dodaj zestaw startowy" }).click();
  await expect(page.locator('[data-template="Oferta Simple"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Dodaj zestaw startowy" })).toHaveCount(0);
  await page.goto(`/leady/${lead}`);
  await expect(page.locator("[data-quick-actions]").getByRole("link")).toHaveCount(6);
  // Na telefonie nic nie wychodzi poza ekran.
  for (const url of [`/leady/${lead}`, "/ustawienia/poczta"]) {
    await page.goto(url);
    const wide = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll("main *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          // poziomo przewijane listy (chipy) są w porządku — liczy się tylko to, co ucieka z ekranu
          const scroller = el.closest("[data-hscroll], .overflow-x-auto");
          return r.width > 0 && r.right > vw + 1 && !scroller;
        })
        .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    });
    expect(wide, url).toEqual([]);
  }
});
