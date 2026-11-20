import { expect, test } from "@playwright/test";
import pg from "pg";
/**
 * Узкий телефон (320 px — так выглядит 412 px с крупным шрифтом Android): ни один блок
 * не выходит за экран. Горизонтально прокручиваемые ленты (.overflow-x-auto) — норма.
 */
test("telefon 320 px: nic nie wychodzi poza ekran", async ({ page }) => {
  test.setTimeout(300_000);
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const org = (
    await c.query(
      "select o.id from organizations o join memberships m on m.organization_id=o.id join auth.users u on u.id=m.user_id where u.email='e2e@owo.test' and o.industry_preset='event-services' limit 1",
    )
  ).rows[0].id;
  for (let i = 0; i < 6; i++)
    await c.query(
      "insert into leads (organization_id, client_name, email, phone_e164, stage_key, event_date, venue, event_type) values ($1,$2,$3,'+48452892393',$4,'2027-03-06','Ostrzyce Zabi dwor','Urodziny / 18-tka')",
      [
        org,
        ["Dominika Murková", "Aneta ( Knight Frank )", "Ewelina", "Dawid", "Alicja", "Agata"][i],
        `x${i}${Date.now()}@krusel.pl`,
        ["contacted", "offer_sent", "contract_sent", "new", "contacted", "offer_sent"][i],
      ],
    );
  const lead = (
    await c.query(
      "select id from leads where organization_id=$1 and email is not null order by created_at desc limit 1",
      [org],
    )
  ).rows[0].id;
  await c.end();
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
  for (const w of [320]) {
    await page.setViewportSize({ width: w, height: 700 });
    for (const url of [
      "/leady",
      "/poczta?tab=rozsylki",
      `/poczta?lead=${lead}&tpl=00000000-0000-4000-8000-000000000000`,
      `/leady/${lead}`,
      "/dzisiaj",
      "/kalendarz",
      "/ustawienia/poczta",
      "/statystyka",
      "/umowy",
      "/ustawienia",
      "/reklama",
    ]) {
      await page.goto(url);
      await page.waitForTimeout(600);
      const res = await page.evaluate((vw) => {
        const out: string[] = [];
        document.querySelectorAll("main *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > vw + 1 && !el.closest(".overflow-x-auto"))
            out.push(`${el.tagName}.${String(el.className).slice(0, 80)} w=${Math.round(r.width)}`);
        });
        const first = [...document.querySelectorAll("main *")]
          .filter((el) => !el.closest(".overflow-x-auto"))
          .find((el) => el.getBoundingClientRect().right > vw + 1) as HTMLElement | undefined;
        const chain: string[] = [];
        let e: HTMLElement | null = first ?? null;
        while (e && e.tagName !== "BODY") {
          const cs = getComputedStyle(e);
          chain.push(
            `${e.tagName}.${String(e.className).slice(0, 50)} w=${Math.round(e.getBoundingClientRect().width)} d=${cs.display} gtc=${cs.gridTemplateColumns.slice(0, 20)}`,
          );
          e = e.parentElement;
        }
        return chain;
      }, w);
      expect(res, url).toEqual([]);
    }
  }
});
