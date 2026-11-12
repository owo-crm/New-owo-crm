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
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
  await page.goto("/leady");
  await page.getByText(name).click();
  await expect(page).toHaveURL(/\/leady\/[0-9a-f-]{36}/);

  // Документы живут на своей вкладке карточки лида (решение 035).
  await page.getByRole("tab", { name: "Dokumenty" }).click();
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
  // Этап виден дорожкой, а не списком (решение 035).
  await expect(page.getByRole("button", { name: "Umowa wysłana" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await page.getByRole("tab", { name: "Dane" }).click();
  await expect(page.getByText("Hotel Łazienki")).toBeVisible();
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-dokumenty.png`,
    fullPage: true,
  });
});

test("zespół: link zaproszenia tworzy konto w tym samym biznesie", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);

  await page.goto("/ustawienia/zespol");
  await page.getByLabel("Dla kogo (notatka)").fill(`Artem ${info.project.name}`);
  await page.getByRole("button", { name: "Utwórz link zaproszenia" }).click();
  const url = await page.getByTestId("invite-url").innerText();
  expect(url).toContain("/zaproszenie/");

  const login = `artem.${info.project.name}${Date.now() % 100000}`;
  const guest = await browser.newPage();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: /Zaproszenie do: Firma E2E/ })).toBeVisible();
  await guest.getByLabel("Imię i nazwisko").fill("Artem Test");
  await guest.getByLabel("Login", { exact: true }).fill(login);
  await guest.getByLabel("Hasło").fill("artem-haslo-123");
  await guest.getByRole("button", { name: "Utwórz konto i dołącz" }).click();
  await expect(guest).toHaveURL(/\/dzisiaj/);
  // Новый человек попадает в тот же бизнес, а не в пустой свой.
  // Переключатель есть и в боковом меню, и в шапке телефона — проверяем видимый.
  await expect(guest.getByText("Firma E2E").locator("visible=true").first()).toBeVisible();
  await guest.goto(url);
  await expect(guest.getByText(/wygasło albo zostało już użyte/)).toBeVisible();
  await guest.close();

  await page.goto("/ustawienia/zespol");
  await expect(page.getByText("Artem Test").first()).toBeVisible();
});

test("kalendarz pokazuje potwierdzone i wstępne terminy", async ({ page, request }, info) => {
  const name = `Termin ${info.project.name}`;
  const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  await request.post(`/api/intake/${KEY}`, {
    data: { name, phone: "600 900 800", event_date: future, consent: true },
    headers: ip(),
  });
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
  const month = future.slice(0, 7);
  await page.goto(`/kalendarz?m=${month}`);
  await expect(page.getByText("Wstępne").first()).toBeVisible();
  await expect(page.getByRole("link", { name }).first()).toBeVisible();
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-kalendarz.png`,
    fullPage: true,
  });
});
