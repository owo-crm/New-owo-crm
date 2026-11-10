// Создать аккаунт (и при желании фирму) без открытой регистрации.
// npm run user:create -- --email ivan@barowo.com --name "Ivan" --org "Barowo" [--platform-admin]
// Пароль берётся из переменной USER_PASSWORD (не пишется в историю терминала аргументом).
import { parseArgs } from "node:util";
import pg from "pg";
import { createUser } from "../lib/auth/repository.ts";
import { slugify } from "../lib/organizations/slug.ts";
import type { Database } from "../lib/db/core.ts";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    org: { type: "string" },
    preset: { type: "string", default: "event-services" },
    "platform-admin": { type: "boolean", default: false },
    // barowo = фирменные оферты, меню и договоры Barowo
    engine: { type: "string" },
  },
});
const password = process.env.USER_PASSWORD ?? "";
if (!values.email || !values.name || password.length < 10) {
  console.error(
    "Użycie: USER_PASSWORD='min. 10 znaków' npm run user:create -- --email a@b.pl --name 'Imię' [--org 'Firma']",
  );
  process.exit(1);
}
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
const db: Database = {
  query: (sql, params) => client.query(sql, params) as never,
  async transaction(fn) {
    await client.query("begin");
    try {
      const r = await fn(db);
      await client.query("commit");
      return r;
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  },
};
try {
  const userId = await createUser(db, {
    email: values.email,
    password,
    fullName: values.name,
    platformAdmin: values["platform-admin"],
  });
  console.log(`Użytkownik: ${userId}`);
  if (values.org) {
    const org = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      return (
        await tx.query<{ id: string }>("select public.create_organization($1,$2,$3) as id", [
          values.org,
          slugify(values.org!),
          values.preset,
        ])
      ).rows[0].id;
    });
    if (values.engine)
      await db.query("update public.organizations set document_engine=$1 where id=$2", [
        values.engine,
        org,
      ]);
    console.log(
      `Firma: ${org} (właściciel: ${values.email})${values.engine ? `, dokumenty: ${values.engine}` : ""}`,
    );
  }
} finally {
  await client.end();
}
