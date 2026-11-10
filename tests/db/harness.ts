import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

/**
 * Поднимает пустую базу в памяти, применяет stub Supabase Auth и ВСЕ миграции по порядку.
 * Так тесты проверяют настоящий SQL из supabase/migrations без Docker.
 */
export async function createTestDb() {
  const db = new PGlite();
  const dir = path.join(root, "db/migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  return db;
}

/** Создаёт пользователя в auth.users (как регистрация). */
export async function createUser(db: PGlite, id: string, fullName = "Test User") {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data, password_hash) values ($1, $2, $3, 'x')`,
    [id, `${id}@example.com`, JSON.stringify({ full_name: fullName })],
  );
}

/** Выполняет запрос от имени пользователя, как будто он вошёл в приложение (роль authenticated). */
export async function asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>) {
  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.exec(userId ? `set role authenticated` : `set role anon`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
