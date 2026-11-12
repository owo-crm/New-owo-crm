import { expect, test } from "@playwright/test";

/** Poczta firmy (decyzja 035): ustawienia SMTP, hasło nigdy nie wraca do przeglądarki, test pokazuje prawdziwy błąd. */
test("poczta: zapis SMTP, hasło tylko do wpisania, test pokazuje błąd serwera", async ({
  page,
}, info) => {
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);

  await page.goto("/ustawienia/poczta");
  await page.getByLabel("Jak wysyłać e-maile do klientów").click();
  await page.getByRole("option", { name: /Własna skrzynka/ }).click();
  await page.getByLabel("Adres e-mail skrzynki").fill("barowo.test@gmail.com");
  await page.getByLabel("Hasło aplikacji").fill("abcd efgh ijkl mnop");
  // Lokalny port bez serwera — test ma pokazać prawdziwą przyczynę, a nie «błąd».
  await page.getByLabel("Serwer SMTP").fill("127.0.0.1");
  await page.getByLabel("Port").fill("2525");
  await page.getByRole("button", { name: "Zapisz ustawienia poczty" }).click();
  await expect(page.getByText(/Zapisano/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Hasło jest zapisane i zaszyfrowane/)).toBeVisible();
  await expect(page.getByLabel("Hasło aplikacji")).toHaveValue("");
  expect(await page.content()).not.toContain("abcdefghijklmnop");
  expect(await page.content()).not.toContain("v1:");

  await page.getByRole("button", { name: "Wyślij wiadomość testową" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /Nie udało się połączyć z serwerem poczty/ }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("alert").filter({ hasText: /ECONNREFUSED/ })).toBeVisible();
  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-mail-settings.png`,
    fullPage: true,
  });
});
