import { expect, test } from "@playwright/test";
import pg from "pg";

/** Меню, аватарки и скрытый спам (решение 039). */
const KEY = "00000000-0000-4000-8000-000000000e2e";
const ip = () => ({ "x-real-ip": `10.9.${Math.floor(Math.random() * 250)}.1` });
// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.configure({ mode: "serial" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
}

test("spam widać dopiero po wybraniu chipu «Spam»", async ({ page, request }, info) => {
  const name = `Spamer ${info.project.name} ${Date.now()}`;
  const res = await request.post(`/api/intake/${KEY}`, {
    data: { name, phone: "500 900 900", consent: true },
    headers: ip(),
  });
  expect(res.status()).toBe(200);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("update public.leads set stage_key='spam' where client_name=$1", [name]);
  await db.end();

  await login(page);
  await page.goto("/leady");
  await expect(page.getByRole("link", { name: "Spam", exact: true })).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  await page.getByRole("link", { name: "Spam", exact: true }).click();
  await expect(page).toHaveURL(/stage=spam/);
  await expect(page.getByText(name)).toHaveCount(1);
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-leady-spam.png` });
});

test("menu zwija się przyciskiem i stoi w miejscu przy przewijaniu", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "menu boczne jest tylko na komputerze");
  await login(page);
  const nav = page.locator("#nav");
  const label = nav.getByText("Leady", { exact: true });
  await expect(label).toBeVisible();
  await page.getByRole("button", { name: "Zwiń albo rozwiń menu" }).click();
  await expect(label).toBeHidden();
  expect((await nav.boundingBox())!.width).toBeLessThan(80);
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-menu-rail.png` });
  await page.reload();
  await expect(label).toBeHidden(); // stan zapamiętany w cookie
  await page.getByRole("button", { name: "Zwiń albo rozwiń menu" }).click();
  await expect(label).toBeVisible();

  await page.goto("/leady");
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(300);
  expect((await nav.boundingBox())!.y).toBe(0);
});

test("logo gabinetu i zdjęcie konta", async ({ page }, info) => {
  await login(page);
  await page.goto("/ustawienia/firma");
  await page.locator('input[type="file"]').setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const logo = page.locator('img[src^="/api/awatar/o/"]').filter({ visible: true });
  await expect(logo.first()).toBeVisible({ timeout: 10_000 });
  const ok = await page.evaluate(
    async (src) => (await fetch(src)).status,
    (await logo.first().getAttribute("src"))!,
  );
  expect(ok).toBe(200);
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-logo.png` });

  await page.goto("/ustawienia");
  await page.locator('input[type="file"]').setInputFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(
    page.locator('img[src^="/api/awatar/u/"]').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
});
