import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Database } from "./core.ts";

/**
 * Применяет новые файлы из db/migrations по порядку имён, каждый — в своей транзакции.
 * Уже применённые записываются в public.schema_migrations и не запускаются второй раз.
 */
export async function migrate(db: Database, dir: string, log: (msg: string) => void = () => {}) {
  await db.query(`create table if not exists public.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  // Один мигратор за раз, даже если Railway запустил два контейнера.
  return db.transaction(async (lockTx) => {
    await lockTx.query("select pg_advisory_xact_lock(727274)");
    const { rows } = await lockTx.query<{ name: string }>(
      "select name from public.schema_migrations",
    );
    const done = new Set(rows.map((r) => r.name));
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), "utf8");
      await lockTx.query(`savepoint m`);
      try {
        await (lockTx.exec ? lockTx.exec(sql) : lockTx.query(sql));
        await lockTx.query("insert into public.schema_migrations(name) values ($1)", [file]);
        await lockTx.query(`release savepoint m`);
      } catch (error) {
        throw new Error(`Migracja ${file} nie powiodła się: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`✓ ${file}`);
    }
    return applied;
  });
}
