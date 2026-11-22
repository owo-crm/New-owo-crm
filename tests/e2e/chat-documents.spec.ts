import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Решение 053: карточка лида → «Szybkie działania» → чат с шаблоном → PDF → «Wyślij» →
 * переписка с вложением → этап. Resend заменён локальным приёмником (RESEND_API_URL в
 * playwright.config.ts): запросы настоящие, письма никуда не уходят.
 */
test.describe.configure({ mode: "serial" });

type Sent = {
  to: string[];
  subject: string;
  attachments?: { filename: string; content: string }[];
  key: string;
};
const inbox: Sent[] = [];
let server: Server;
let orgId: string;

const db = async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      inbox.push({ ...json, key: String(req.headers["idempotency-key"] ?? "") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `re_e2e_${randomUUID()}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(3299, "127.0.0.1", resolve));

  const c = await db();
  const org = (
    await c.query<{ id: string; slug: string }>(
      `select o.id, o.slug from public.organizations o join public.memberships m on m.organization_id=o.id
         join auth.users u on u.id=m.user_id
        where u.email='e2e@owo.test' and o.industry_preset <> 'agency' order by o.created_at limit 1`,
    )
  ).rows[0];
  orgId = org.id;
  process.env.MAIL_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const { encryptSecret } = await import("../../lib/mail/secret.ts");
  await c.query(
    `insert into public.organization_mail_settings (organization_id, transport, from_name, from_email, secret_ciphertext, daily_limit)
     values ($1,'resend','Firma E2E','kontakt@firma.test',$2,1000)
     on conflict (organization_id) do update set transport='resend', from_email='kontakt@firma.test',
       secret_ciphertext=excluded.secret_ciphertext, daily_limit=1000`,
    [orgId, encryptSecret("re_e2e")],
  );
  await c.end();
  // Стартовые шаблоны Barowo — тем же скриптом, что в продакшене (повтор ничего не дублирует).
  execSync(`npm run templates:import -- --org ${org.slug} --file templates/barowo.json --apply`, {
    stdio: "inherit",
  });
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function login(page: Page) {
  await page.goto("/logowanie");
  await page.getByLabel("Login lub e-mail").fill("e2e@owo.test");
  await page.getByLabel("Hasło").fill("e2e-haslo-123");
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await expect(page).toHaveURL(/\/dzisiaj/);
}

async function newLead(name: string, email: string | null) {
  const c = await db();
  const stage = (
    await c.query<{ id: string }>(
      `insert into public.leads (organization_id, client_name, email, phone_e164, stage_key, event_date, guests, venue, service_hours, event_city)
       values ($1,$2,$3,'+48500100200','contacted','2027-06-12',80,'Dwór Oliwski','18:00-02:00','Gdańsk') returning id`,
      [orgId, name, email],
    )
  ).rows[0];
  await c.end();
  return stage.id;
}

async function stageOf(id: string) {
  const c = await db();
  const s = (await c.query<{ s: string }>("select stage_key s from public.leads where id=$1", [id]))
    .rows[0].s;
  await c.end();
  return s;
}

const sentTo = (email: string) => inbox.filter((m) => m.to.includes(email));

test("Simple: karta leada → czat → zmiana gości → podgląd PDF → wysyłka → historia i etap", async ({
  page,
}, info) => {
  const email = `simple-${info.project.name}-${Date.now()}@example.com`;
  const lead = await newLead("Anna Simple", email);
  await login(page);
  await page.goto(`/leady/${lead}`);
  // Następny kontakt i Przypisane do zniknęły z «Szybkie działania», «Prowadzi» jest w nagłówku.
  await expect(page.getByText("Następny kontakt")).toHaveCount(0);
  await expect(page.locator("[data-assignee]")).toContainText("Prowadzi");
  const actions = page.locator("[data-quick-actions]");
  await expect(actions.getByRole("link")).toHaveText([
    "Simple",
    "Standard",
    "Premium",
    "Oferta personalna",
    "Umowa",
    "Menu",
  ]);
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-lead-szybkie.png` });
  await actions.getByRole("link", { name: "Simple" }).click();

  await expect(page).toHaveURL(/\/poczta\?lead=.*&tpl=/);
  const card = page.locator("[data-document-card]");
  await expect(card.getByLabel("Goście")).toHaveValue("80");
  await card.getByLabel("Goście").fill("50");
  await card.getByLabel("Goście").blur();
  await expect(card.getByText(/Sugerowana cena: 4500/)).toBeVisible();
  await expect(card.getByLabel("Cena (zł)")).toHaveValue("4500");
  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Podgląd PDF" }).click();
  await (await popup).close();
  expect(await stageOf(lead)).toBe("contacted"); // podgląd nie zmienia etapu
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-czat-oferta.png` });

  // Podwójne kliknięcie — jedna wiadomość.
  const send = page.getByRole("button", { name: "Wyślij" });
  await send.dblclick();
  await expect(page.locator("section ol").getByRole("link", { name: /\.pdf$/ })).toBeVisible({
    timeout: 30_000,
  });
  expect(sentTo(email)).toHaveLength(1);
  const mail = sentTo(email)[0];
  expect(mail.subject).toBe("Oferta Barowo — pakiet Simple");
  expect(mail.attachments?.[0].filename).toMatch(/\.pdf$/);
  expect(Buffer.from(mail.attachments![0].content, "base64").subarray(0, 4).toString()).toBe(
    "%PDF",
  );
  expect(mail.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(await stageOf(lead)).toBe("offer_sent");
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-czat-wyslano.png` });

  // PDF w czacie — prawdziwe pobranie przez chroniony adres.
  const href = await page
    .locator("section ol")
    .getByRole("link", { name: /\.pdf$/ })
    .getAttribute("href");
  const file = await page.request.get(href!);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  // Historia leada: wysyłka zapisana jako zdarzenie
  const c = await db();
  const events = await c.query(
    "select 1 from public.lead_events where lead_id=$1 and type='email_sent'",
    [lead],
  );
  await c.end();
  expect(events.rows).toHaveLength(1);
});

test("Standard i Premium wysyłają się z czatu", async ({ page }, info) => {
  await login(page);
  for (const pkg of ["Standard", "Premium"]) {
    const email = `${pkg.toLowerCase()}-${info.project.name}-${Date.now()}@example.com`;
    const lead = await newLead(`Anna ${pkg}`, email);
    await page.goto(`/leady/${lead}`);
    await page
      .locator("[data-quick-actions]")
      .getByRole("link", { name: pkg, exact: true })
      .click();
    await expect(page.locator("[data-document-card]").getByLabel("Goście")).toHaveValue("80");
    await page.getByRole("button", { name: "Wyślij" }).click();
    await expect(page.locator("section ol").getByRole("link", { name: /\.pdf$/ })).toBeVisible({
      timeout: 30_000,
    });
    expect(sentTo(email)[0].subject).toBe(`Oferta Barowo — pakiet ${pkg}`);
  }
});

test("Oferta personalna, Umowa i Menu: formularz → czat z PDF → wysyłka", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await login(page);
  const email = `forms-${info.project.name}-${Date.now()}@example.com`;
  const lead = await newLead("Anna Formularz", email);
  const chatPdf = page.locator("section ol").getByRole("link", { name: /\.pdf$/ });

  // Oferta personalna z wyborem pakietu
  await page.goto(`/leady/${lead}`);
  await page
    .locator("[data-quick-actions]")
    .getByRole("link", { name: "Oferta personalna" })
    .click();
  await page
    .locator("nav")
    .filter({ hasText: "Simple" })
    .getByRole("link", { name: "Premium", exact: true })
    .click();
  await expect(page).toHaveURL(/pakiet=premium/);
  await page.screenshot({ path: `tests/screenshots/${info.project.name}-oferta-personalna.png` });
  await page.getByRole("button", { name: /Generuj/ }).click();
  await expect(page).toHaveURL(/\/poczta\?lead=.*&doc=/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: /^Oferta_.*\.pdf$/ })).toBeVisible();
  await page.getByRole("button", { name: "Wyślij" }).click();
  await expect(chatPdf).toHaveCount(1, { timeout: 30_000 });
  expect(await stageOf(lead)).toBe("offer_sent");

  // Menu — bez zmiany etapu
  await page.goto(`/leady/${lead}`);
  await page.locator("[data-quick-actions]").getByRole("link", { name: "Menu" }).click();
  await page.getByRole("button", { name: /Generuj/ }).click();
  await expect(page).toHaveURL(/\/poczta\?lead=.*&doc=/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Wyślij" }).click();
  await expect(chatPdf).toHaveCount(2, { timeout: 30_000 });
  expect(await stageOf(lead)).toBe("offer_sent");

  // Umowa — etap «Umowa wysłana» dopiero po wysłaniu
  await page.goto(`/leady/${lead}`);
  await page.locator("[data-quick-actions]").getByRole("link", { name: "Umowa" }).click();
  await page.locator('[name="clientName"]').fill("Anna Formularz");
  await page.locator('[name="address"]').fill("ul. Długa 1, 80-001 Gdańsk");
  await page.locator('[name="price"]').fill("7450");
  await page.getByRole("button", { name: /Generuj/ }).click();
  await expect(page).toHaveURL(/\/poczta\?lead=.*&doc=/, { timeout: 90_000 });
  expect(await stageOf(lead)).toBe("offer_sent"); // generowanie nie zmienia etapu
  await page.getByRole("button", { name: "Wyślij" }).click();
  await expect(chatPdf).toHaveCount(3, { timeout: 30_000 });
  expect(await stageOf(lead)).toBe("contract_sent");
  expect(sentTo(email).map((m) => m.subject)).toEqual([
    "Oferta Barowo przygotowana dla Państwa",
    "Menu dla gości — Barowo",
    "Umowa — Barowo",
  ]);
});

test("lead bez e-maila: przyciski dokumentów nieaktywne", async ({ page }, info) => {
  const lead = await newLead(`Bez maila ${info.project.name}`, null);
  await login(page);
  await page.goto(`/leady/${lead}`);
  const actions = page.locator("[data-quick-actions]");
  await expect(actions.getByRole("link")).toHaveCount(0);
  await expect(actions.getByText("Simple")).toHaveAttribute("aria-disabled", "true");
  await expect(actions.getByText("Dodaj e-mail klienta, żeby wysłać").first()).toBeVisible();
});

test("zwykła odpowiedź działa jak wcześniej; rozsyłki nie pokazują szablonów dokumentów", async ({
  page,
}, info) => {
  const email = `tekst-${info.project.name}-${Date.now()}@example.com`;
  const lead = await newLead("Anna Tekst", email);
  await login(page);
  await page.goto(`/poczta?lead=${lead}&tab=wiadomosci`);
  await page.getByPlaceholder("Napisz odpowiedź…").fill("Dzień dobry, potwierdzamy termin.");
  await page.getByRole("button", { name: "Wyślij" }).click();
  await expect(
    page.locator("section ol").getByText("Dzień dobry, potwierdzamy termin."),
  ).toBeVisible({ timeout: 20_000 });
  expect(sentTo(email)[0].attachments ?? []).toHaveLength(0);
  expect(await stageOf(lead)).toBe("contacted");

  await page.goto("/poczta?tab=rozsylki");
  await expect(page.getByText("Oferta Simple")).toHaveCount(0);
});
