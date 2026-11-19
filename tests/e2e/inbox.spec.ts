import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

/** Переписка в «Poczta» (решение 051): входящее от Resend → чат → ответ. */
test.describe.configure({ mode: "serial" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
}

async function org() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const id = (
    await db.query<{ id: string }>(
      `select o.id from public.organizations o join public.memberships m on m.organization_id=o.id
         join auth.users u on u.id=m.user_id where u.email='e2e@owo.test' order by o.created_at limit 1`,
    )
  ).rows[0].id;
  return { db, id };
}

test("webhook bez podpisu jest odrzucany", async ({ request }) => {
  const { db, id } = await org();
  await db.end();
  const res = await request.post(`/api/mail/inbound/${id}`, {
    data: { type: "email.received" },
    headers: { "svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,abc" },
  });
  expect([401, 404]).toContain(res.status());
});

test("wiadomość klienta widać jako czat", async ({ page }, info) => {
  const { db, id } = await org();
  const who = `klient-${info.project.name}@example.com`;
  await db.query("delete from public.mail_messages where organization_id=$1 and counterpart=$2", [
    id,
    who,
  ]);
  await db.query(
    `insert into public.mail_messages (organization_id, direction, counterpart, counterpart_name, subject, body_text, created_at, read_at)
     values ($1,'out',$2,null,'Oferta Barowo — wesele 14.06','Dzień dobry Pani Anno,\n\nw załączeniu oferta na wesele. Pakiet Premium obejmuje 6 godzin baru i 12 autorskich koktajli.', now() - interval '2 hours', now()),
            ($1,'in',$2,'Anna Nowak','Re: Oferta Barowo — wesele 14.06','Dziękuję! Czy da się dodać bar bezalkoholowy dla dzieci?\n\nW dniu 12.06 Barowo napisał(a):\n> Dzień dobry', now() - interval '20 minutes', null)`,
    [id, who],
  );
  await db.query(
    `insert into public.organization_mail_settings (organization_id, transport, from_name, from_email)
     values ($1,'resend','Firma E2E','kontakt@firma.test') on conflict (organization_id) do nothing`,
    [id],
  );
  await db.end();

  await login(page);
  await page.goto("/poczta");
  await expect(page.getByText("Anna Nowak").first()).toBeVisible();
  await page.goto(`/poczta?c=${encodeURIComponent(who)}`);
  const chat = page.locator("section ol");
  await expect(chat.getByText("Czy da się dodać bar bezalkoholowy")).toBeVisible();
  // цитата отрезана
  await expect(chat.getByText("napisał(a)")).toHaveCount(0);
  await expect(page.getByPlaceholder("Napisz odpowiedź…")).toBeVisible();
  await page
    .getByPlaceholder("Napisz odpowiedź…")
    .fill("Oczywiście! Dodamy mocktaile — bez dopłaty do 20 osób.");
  await expect(page.getByRole("button", { name: "Wyślij" })).toBeEnabled();
  await expect(page.locator("section header").getByText("Anna Nowak")).toBeVisible();
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-poczta-czat.png` });
});

test("ustawienia: wygląd listów z podglądem", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await login(page);
  await page.goto("/ustawienia/poczta");
  await expect(page.getByText("Wygląd wiadomości")).toBeVisible();
  await page.getByRole("button", { name: "Ciemny", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Podgląd"]');
  await expect(frame.getByText("Zobacz ofertę")).toBeVisible({ timeout: 10_000 });
  await page.locator('iframe[title="Podgląd"]').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-poczta-wyglad.png`,
    fullPage: true,
  });
});
