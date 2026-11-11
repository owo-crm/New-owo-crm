// Применяет миграции к DATABASE_URL. Railway запускает это перед стартом приложения.
import path from "node:path";
import pg from "pg";
import { migrate } from "../lib/db/migrate.ts";
import { bootstrapAdmin, ensureAgencyWorkspace, ensurePlatformAdmin } from "../lib/db/bootstrap.ts";
import type { Database } from "../lib/db/core.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Brak DATABASE_URL");
  process.exit(1);
}
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
const db: Database = {
  query: (sql: string, params?: unknown[]) => client.query(sql, params) as never,
  async transaction(fn) {
    await client.query("begin");
    try {
      const result = await fn(db);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  },
};
try {
  const applied = await migrate(
    db,
    path.resolve(import.meta.dirname, "../db/migrations"),
    console.log,
  );
  console.log(applied.length ? `Zastosowano migracji: ${applied.length}` : "Baza aktualna.");
  await bootstrapAdmin(db, process.env);
  await ensurePlatformAdmin(db, process.env);
  await ensureAgencyWorkspace(db, process.env);
} finally {
  await client.end();
}
