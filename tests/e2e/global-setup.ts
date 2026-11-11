import { execSync } from "node:child_process";
import pg from "pg";

/** Чистая база для e2e: пересоздаём схему, миграции, пользователь + фирма + канал сайта. */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("E2E wymaga DATABASE_URL (osobna, testowa baza!)");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;",
  );
  await client.end();
  execSync("npm run db:migrate", { stdio: "inherit" });
  execSync("npm run user:create -- --email e2e@owo.test --name 'E2E Tester' --org 'Firma E2E'", {
    stdio: "inherit",
    env: { ...process.env, USER_PASSWORD: "e2e-haslo-123" },
  });
  const c2 = new pg.Client({ connectionString: url });
  await c2.connect();
  await c2.query(
    `insert into public.channels(organization_id,type,name,public_key)
     select id,'website','Strona','00000000-0000-4000-8000-000000000e2e' from public.organizations`,
  );
  await c2.query(
    "update public.organizations set document_engine='barowo', email='e2e@owo.test', phone='+48 500 000 000'",
  );
  // Кабинет агентства (пресет agency) для того же пользователя — tests/e2e/agency.spec.ts.
  // Создаётся после каналов: у агентства своего канала сайта в тестах нет.
  await c2.query(
    `with o as (insert into public.organizations (name, slug, industry_preset)
                values ('OWO Ads E2E','owo-ads-e2e','agency') returning id)
     insert into public.memberships (organization_id, user_id, role)
     select o.id, u.id, 'owner' from o, auth.users u where u.email='e2e@owo.test'`,
  );
  await c2.end();
}
