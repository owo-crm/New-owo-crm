import { expect, test } from "@playwright/test";

test("гость попадает на страницу входа", async ({ page }) => {
  await page.goto("/dzisiaj");
  await expect(page).toHaveURL(/\/logowanie/);
  await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
});

test("вход: пустая форма показывает польские ошибки", async ({ page }) => {
  await page.goto("/logowanie");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page.getByText("Podaj poprawny adres e-mail.")).toBeVisible();
  await expect(page.getByText("Podaj hasło.")).toBeVisible();
});

test("регистрация: без согласия нельзя создать аккаунт", async ({ page }) => {
  await page.goto("/rejestracja");
  await page.getByLabel("Imię i nazwisko").fill("Ivan Tarasiuk");
  await page.getByLabel("E-mail").fill("ivan@barowo.com");
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
