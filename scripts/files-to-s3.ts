/**
 * M3.x — перенос файлов из PostgreSQL (bytea) в приватный bucket (Cloudflare R2, D-22).
 *
 * По умолчанию — ПРОБНЫЙ запуск (ничего не пишет): проверяет, что исходные файлы читаются и их
 * sha256 совпадает с реестром `files`. Перенос — только с флагом --apply.
 * ПЕРЕД --apply: резервная копия БД. bytea не удаляется (очистка — M9).
 *
 *   DATABASE_URL=... FILES_S3_ENDPOINT=... FILES_S3_BUCKET=... FILES_S3_ACCESS_KEY_ID=... \
 *   FILES_S3_SECRET_ACCESS_KEY=... npm run files:to-s3 -- [--apply] [--org <uuid>] [--limit N]
 */
import pg from "pg";
import { s3ConfigFromEnv, S3Storage } from "../lib/platform/files/storage.ts";
import { migrateFilesToS3 } from "../lib/platform/files/migrate-to-s3.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Brak DATABASE_URL");
  const cfg = s3ConfigFromEnv(process.env);
  if (!cfg) throw new Error("Brak FILES_S3_* — magazyn nie jest skonfigurowany");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const report = await migrateFilesToS3(client, new S3Storage(cfg), {
      dryRun: !args.includes("--apply"),
      organizationId: arg("--org"),
      limit: arg("--limit") ? Number(arg("--limit")) : undefined,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length) process.exitCode = 2;
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
