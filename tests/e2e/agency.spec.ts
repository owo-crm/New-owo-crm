import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/** Кабинет агентства: клиент → заказ с живым расчётом → сводка «мозга». Телефон и компьютер. */
test.describe.configure({ mode: "serial" });

async function agencyId() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query<{ id: string }>(
    "select id from public.organizations where slug='owo-ads-e2e'",
  );
  await c.end();
  return r.rows[0].id;
}

async function login(page: Page) {
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
}

test("в обычном бизнесе кабинета агентства нет", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("link", { name: "Agencja" })).toHaveCount(0);
  const res = await page.goto("/agencja");
  expect(res?.status()).toBe(404);
});

test("клиент → заказ с расчётом до сохранения → раздел в сводке", async ({ page }, info) => {
  await login(page);
  await page
    .context()
    .addCookies([{ name: "owo_org", value: await agencyId(), url: "http://localhost:3200" }]);
  await page.goto("/agencja");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Agencja");

  const client = `Studio ${info.project.name} ${Date.now() % 100000}`;
  await page.goto("/agencja/klienci/nowy");
  await page.getByLabel("Nazwa firmy").fill(client);
  await page.getByLabel("NIP").fill("123-456-78-90");
  await page.getByRole("button", { name: "Zapisz klienta" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(client);
  await expect(page.getByTestId("setup-checklist").getByRole("listitem")).toHaveCount(12);
  // Ручной шаг отмечается кликом, автоматический — нет.
  await page.getByRole("checkbox", { name: /Nazwa, kolor, logo/ }).click();
  await expect(page.getByRole("checkbox", { name: /Nazwa, kolor, logo/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.getByRole("link", { name: "Nowe zlecenie" }).click();
  await expect(page).toHaveURL(/zlecenia\/nowe\?klient=/);
  await page.getByLabel("Nazwa zlecenia").fill("Landing page");
  await page.getByLabel("Kwota netto (zł)").fill("1100");
  await page.getByLabel("Koszty bezpośrednie (zł)").fill("100");
  await page.getByLabel("Budżet reklamowy klienta (zł)").fill("5000");
  const preview = page.getByTestId("split-preview");
  // Без часов работа видна как нераспределённая.
  await expect(preview).toContainText("Nierozdzielone");
  await page.getByRole("button", { name: "Dodaj wykonawcę" }).click();
  await page.getByLabel("Godziny").fill("2,5");
  // База 1000 zł: 10 % sprzedaż + 65 % praca = 750 zł — видно до сохранения.
  await expect(preview).toContainText(/Ty dostaniesz: 750,00\s*zł/);
  await expect(preview).not.toContainText("Nierozdzielone");
  await page.getByLabel("Status").selectOption("paid");
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-agencja-zlecenie.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Zapisz zlecenie" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(client);
  await expect(page.getByTestId("client-orders")).toContainText("Landing page");
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-agencja-klient.png`,
    fullPage: true,
  });

  await page.goto("/agencja");
  const split = page.getByTestId("agency-split");
  await expect(split).toContainText("E2E Tester");
  await expect(split).toContainText("Koszty bezpośrednie");
  await expect(page.getByText(/nie zgadza się/)).toHaveCount(0);
  await expect(page.getByTestId("agency-clients")).toContainText(client);

  // Ничего не вылезает за ширину экрана (телефон 390 px).
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({
      path: `tests/screenshots/${info.project.name}-agencja-${scheme}.png`,
      fullPage: true,
    });
  }
});

test("абонемент: CRM клиента с модулями, закрытый модуль, «Poproś o moduł» доходит до агентства", async ({
  page,
}, info) => {
  await login(page);
  const agency = await agencyId();
  await page
    .context()
    .addCookies([{ name: "owo_org", value: agency, url: "http://localhost:3200" }]);
  const client = `Foto ${info.project.name} ${Date.now() % 100000}`;
  await page.goto("/agencja/klienci/nowy");
  await page.getByLabel("Nazwa firmy").fill(client);
  await page.getByRole("button", { name: "Zapisz klienta" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(client);

  // Мастер: только база «Leady» → 39 zł netto, 47,97 zł brutto.
  const wizard = page.getByTestId("crm-wizard");
  await expect(wizard.getByTestId("price-table")).toContainText(/47,97\s*zł/);
  await wizard.getByRole("button", { name: "Utwórz CRM" }).click();
  const panel = page.getByTestId("subscription-panel");
  await expect(panel).toBeVisible();
  // Добавили модуль — цена растёт сразу, до сохранения.
  await panel.getByLabel("Oferty i umowy").check();
  await expect(panel.getByTestId("price-table")).toContainText(/98,00\s*zł/);
  await panel.getByRole("button", { name: "Zapisz i zaktualizuj płatność" }).click();
  await expect(panel.getByRole("status")).toContainText("Zapisano");
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-abonament-agencja.png`,
    fullPage: true,
  });

  // В CRM клиента календаря нет: экран модуля с «Poproś o moduł».
  await page.getByRole("button", { name: "Otwórz CRM klienta" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
  await expect(
    page.getByRole("navigation", { name: "Menu główne" }).getByRole("link", { name: "Kalendarz" }),
  ).toHaveCount(0);
  await page.goto("/kalendarz");
  await expect(page.getByText("Moduł „Kalendarz” nie jest włączony")).toBeVisible();
  await page.getByRole("button", { name: "Poproś o moduł" }).click();
  await expect(page.getByText("Zgłoszenie wysłane")).toBeVisible();
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-modul-zablokowany.png`,
    fullPage: true,
  });
  await page.goto("/ustawienia/abonament");
  await expect(page.getByTestId("price-table")).toContainText(/98,00\s*zł/);

  await page
    .context()
    .addCookies([{ name: "owo_org", value: agency, url: "http://localhost:3200" }]);
  await page.goto("/agencja");
  await expect(page.getByText("Klienci proszą o moduły")).toBeVisible();
  await expect(page.getByRole("link", { name: client }).first()).toBeVisible();
});
