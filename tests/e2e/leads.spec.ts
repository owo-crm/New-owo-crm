import { expect, test } from "@playwright/test";

const KEY = "00000000-0000-4000-8000-000000000e2e";
// Każda zgłoszenie z innego IP — limit 10/h na IP działa naprawdę i nie blokuje testów.
const ip = () => ({
  "x-real-ip": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
});

test.describe.configure({ mode: "serial" });

test("заявка с сайта → вход → лид в списке, повтор не дублирует, новый появляется вживую", async ({
  page,
  request,
}, info) => {
  const sub = `sub-${info.project.name}-${Date.now()}`;
  const name = `Anna ${info.project.name}`;
  const body = { name, phone: "500 100 200", event_date: "2027-06-12", consent: true };
  for (let i = 0; i < 2; i++) {
    const res = await request.post(`/api/intake/${KEY}`, {
      data: body,
      headers: { "idempotency-key": sub, ...ip() },
    });
    expect(res.status()).toBe(200);
  }

  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("zle-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page.getByText("Nieprawidłowy login lub hasło.")).toBeVisible();
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);

  await page.goto("/leady");
  await expect(page.getByText(name)).toHaveCount(1);
  // Подписи о связи больше нет (решение 033), но состояние помечено в разметке:
  // ждём установленного соединения, иначе лид ниже может прийти раньше подписки.
  await expect(page.locator('[data-live="on"]')).toBeAttached({ timeout: 10_000 });

  const live = `Marek ${info.project.name} ${Date.now()}`;
  await request.post(`/api/intake/${KEY}`, {
    data: { name: live, email: "m@example.com", consent: true },
    headers: ip(),
  });
  await expect(page.getByText(live)).toBeVisible({ timeout: 10_000 });

  await page.screenshot({
    path: `tests/screenshots/${info.project.name}-leady.png`,
    fullPage: true,
  });
  await page.getByText(name).click();
  await expect(page).toHaveURL(/\/leady\/[0-9a-f-]{36}/);
});

test("чужой домен и без согласия — отказ", async ({ request }) => {
  const evil = await request.post(`/api/intake/${KEY}`, {
    data: { name: "x", phone: "500100200", consent: true },
    headers: { origin: "https://evil.example", ...ip() },
  });
  expect(evil.status()).toBe(403);
  const noConsent = await request.post(`/api/intake/${KEY}`, {
    data: { name: "x", phone: "500100200" },
    headers: ip(),
  });
  expect(noConsent.status()).toBe(422);
});
