import { expect, test } from "@playwright/test";

/** Универсальный вебхук и экран «Źródła leadów» (решение 044). Телефон и компьютер. */
test.describe.configure({ mode: "serial" });

test("webhook: создать, принять заявку как от Zapier, проверить кнопкой «Wyślij test»", async ({
  page,
  request,
}, info) => {
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);

  const name = `Zapier ${info.project.name} ${Date.now() % 100000}`;
  await page.goto("/ustawienia/zrodla");
  await page.getByLabel("Nazwa (np. Zapier — Tally)").fill(name);
  await page.getByRole("button", { name: "Dodaj webhook" }).click();
  const card = page.getByTestId("channel-card").filter({ hasText: name });
  await expect(card).toBeVisible();
  const url = (await card.locator("code").first().textContent())!.trim();
  expect(url).toMatch(/\/api\/hook\/[0-9a-f-]{36}$/);

  // Zapier шлёт JSON с польскими названиями полей — CRM распознаёт их сама.
  const client = `Webhook ${info.project.name} ${Date.now() % 100000}`;
  const res = await request.post(new URL(url).pathname, {
    data: { "Imię i nazwisko": client, Telefon: "500 600 700", Budżet: "5000" },
  });
  expect(res.status()).toBe(200);

  await page.reload();
  await expect(card.getByText("przyjęte").first()).toBeVisible();
  await expect(card.getByText("Budżet")).toBeVisible();

  await card.getByRole("button", { name: "Wyślij test" }).click();
  await expect(card.getByText("Test przyjęty")).toBeVisible();
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-zrodla.png`,
    fullPage: true,
  });

  await page.goto("/leady");
  await expect(page.getByText(client)).toBeVisible();
});
