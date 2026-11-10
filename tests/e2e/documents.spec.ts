import { expect, test } from "@playwright/test";

const KEY = "00000000-0000-4000-8000-000000000e2e";
// Każda zgłoszenie z innego IP — limit 10/h na IP działa naprawdę i nie blokuje testów.
const ip = () => ({
  "x-real-ip": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
});

test("oferta → menu → umowa: PDF + Word, dane wracają do karty, etap rośnie", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const name = `Klient Dok ${info.project.name}`;
  await request.post(`/api/intake/${KEY}`, {
    data: { name, phone: "600 700 800", event_date: "2099-06-12", city: "Sopot", consent: true },
    headers: ip(),
  });
  await page.goto("/logowanie");
  await page.getByLabel("E-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
  await page.goto("/leady");
  await page.getByText(name).click();
  await expect(page).toHaveURL(/\/leady\/[0-9a-f-]{36}/);

  await page.getByRole("link", { name: "Premium" }).click();
  await page.getByLabel("Goście").fill("70");
  await page.getByLabel("Miejsce").fill("Hotel Łazienki");
  await page.getByLabel("Godziny (np. 18:00-02:00)").fill("17:00-01:00");
  await page.getByLabel("Cena (zł)").fill("8800");
  await page.locator("main").getByRole("button", { name: "Generuj PDF + Word" }).click();
  await expect(page.getByText(/Gotowe: Oferta/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: /Menu dla gości/ }).click();
  await page.locator("main").getByRole("button", { name: "Generuj PDF + Word" }).click();
  await expect(page.getByText(/Gotowe: Menu/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: /Umowa/ }).click();
  await expect(page.getByLabel("Cena umowy (zł)")).toHaveValue("8800");
  await page.getByLabel("Adres klienta").fill("ul. Testowa 5, 81-001 Gdynia");
  await page.locator("main").getByRole("button", { name: "Generuj PDF + Word" }).click();
  await expect(page.getByText(/Gotowe: Umowa/)).toBeVisible({ timeout: 90_000 });

  const files = await page
    .locator('a[href^="/api/documents/"]')
    .evaluateAll((a) => a.map((x) => x.getAttribute("href")!));
  expect(files).toHaveLength(6);
  for (const href of files) expect((await page.request.get(href)).status()).toBe(200);
  await expect(page.locator("main select").first()).toHaveValue("contract_sent");
  await expect(page.getByText("Hotel Łazienki")).toBeVisible();
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-dokumenty.png`,
    fullPage: true,
  });
});
