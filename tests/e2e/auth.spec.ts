import { expect, test } from "@playwright/test";

test("гость попадает на страницу входа", async ({ page }) => {
  await page.goto("/dzisiaj");
  await expect(page).toHaveURL(/\/logowanie/);
  await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
});

test("вход: пустая форма показывает польские ошибки", async ({ page }) => {
  await page.goto("/logowanie");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(
    page.getByText("Login: 3–32 znaki (a–z, 0–9, . _ -) albo poprawny e-mail."),
  ).toBeVisible();
  await expect(page.getByText("Podaj hasło.")).toBeVisible();
});

test("регистрация: без согласия нельзя создать аккаунт", async ({ page }) => {
  await page.goto("/rejestracja");
  await page.getByLabel("Login", { exact: true }).fill("ivan");
  await page.getByLabel("Hasło").fill("bardzo-dlugie-haslo");
  await page.getByRole("button", { name: "Załóż konto" }).click();
  await expect(page.getByText("Aby założyć konto, zaakceptuj warunki.")).toBeVisible();
});

test("страницы входа: скриншоты для визуальной проверки", async ({ page }, info) => {
  for (const path of ["/logowanie", "/rejestracja", "/reset-hasla"]) {
    await page.goto(path);
    await page.screenshot({
      path: `tests/screenshots/${info.project.name}${path.replace("/", "-")}.png`,
      fullPage: true,
    });
  }
});

test("rejestracja loginem i hasłem → firma → Dzisiaj, potem logowanie loginem", async ({
  page,
}, info) => {
  const login = `ivan.${info.project.name}${Date.now() % 100000}`;
  await page.goto("/rejestracja");
  await page.getByLabel("Login", { exact: true }).fill(login);
  await page.getByLabel("Hasło").fill("bardzo-dlugie-haslo");
  await page.getByText(/Akceptuję regulamin/).click();
  await page.getByRole("button", { name: "Załóż konto" }).click();
  await expect(page).toHaveURL(/\/firma/);
  await page.getByLabel("Nazwa firmy").fill("Barowo " + info.project.name);
  await page.locator("main button[type=submit], form button[type=submit]").first().click();
  await expect(page).toHaveURL(/\/dzisiaj/);
  await page.context().clearCookies();
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill(login.toUpperCase());
  await page.getByLabel("Hasło").fill("bardzo-dlugie-haslo");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
});
