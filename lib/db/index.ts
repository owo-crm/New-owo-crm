import "server-only";
import pg from "pg";
import { TYPE_PARSERS, type Database, type Queryable } from "./core";

export * from "./core";

for (const [oid, parse] of Object.entries(TYPE_PARSERS)) pg.types.setTypeParser(Number(oid), parse);

const globalForDb = globalThis as typeof globalThis & { __owoPool?: pg.Pool };

export function getPool() {
  if (!globalForDb.__owoPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Brak DATABASE_URL (patrz .env.example).");
    const pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
    pool.on("connect", (client) => void client.query("set timezone to 'UTC'"));
    globalForDb.__owoPool = pool;
  }
  return globalForDb.__owoPool;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb(): Database {
  const pool = getPool();
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const tx: Queryable = { query: (sql, params) => client.query(sql, params) as never };
        const result = await fn(tx);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
