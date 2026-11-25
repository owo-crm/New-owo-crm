import type { Queryable } from "../../db/core.ts";
import { PostgresStorage, sha256Hex, type FileStorage } from "./storage.ts";

/**
 * M3.x — перенос содержимого файлов из bytea в приватный bucket (D-22, план M3.x).
 *
 * По каждому файлу: чтение bytea → сверка sha256 с `files` → put → head (размер и sha256) →
 * `file_mark_s3`. bytea НЕ удаляется (очистка — M9 после резервной копии). Повторный запуск
 * безопасен: уже перенесённые файлы пропускаются. В конце — сверка количества и сумм по организациям.
 */
export type MigrationReport = {
  dryRun: boolean;
  scanned: number;
  moved: number;
  failed: { id: string; reason: string }[];
  byOrganization: {
    organization_id: string;
    total: number;
    in_s3: number;
    in_postgres: number;
    bytes: number;
    checksum: string; // sha256 от отсортированных sha256 файлов — одинаков до и после
  }[];
};

export async function migrateFilesToS3(
  db: Queryable,
  s3: FileStorage,
  options: { dryRun?: boolean; organizationId?: string; limit?: number } = {},
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true;
  const pgStore = new PostgresStorage(db);
  const { rows } = await db.query<{
    id: string;
    organization_id: string;
    storage_key: string;
    size_bytes: string;
    sha256: string;
    content_type: string;
  }>(
    `select id, organization_id, storage_key, size_bytes, sha256, content_type from public.files
      where storage = 'postgres' and deleted_at is null and ($1::uuid is null or organization_id = $1)
      order by created_at limit $2`,
    [options.organizationId ?? null, options.limit ?? 100000],
  );
  const report: MigrationReport = {
    dryRun,
    scanned: rows.length,
    moved: 0,
    failed: [],
    byOrganization: [],
  };
  for (const f of rows) {
    try {
      const body = await pgStore.get(f.storage_key);
      if (!body) throw new Error("source missing");
      const sha = sha256Hex(body);
      if (sha !== f.sha256 || body.byteLength !== Number(f.size_bytes))
        throw new Error("source checksum mismatch");
      if (dryRun) continue;
      const key = `org/${f.organization_id}/${f.id}`;
      await s3.put(key, body, { contentType: f.content_type, sha256: sha });
      const head = await s3.head(key);
      if (!head || head.size !== body.byteLength || head.sha256 !== sha)
        throw new Error("verification failed");
      const { rows: marked } = await db.query<{ ok: boolean }>(
        "select public.file_mark_s3($1,$2,$3,$4) as ok",
        [f.id, key, body.byteLength, sha],
      );
      if (!marked[0]?.ok) throw new Error("mark failed");
      report.moved++;
    } catch (error) {
      report.failed.push({ id: f.id, reason: (error as Error).message });
    }
  }
  const { rows: orgs } = await db.query<MigrationReport["byOrganization"][number]>(
    `select organization_id, count(*)::int as total,
            count(*) filter (where storage='s3')::int as in_s3,
            count(*) filter (where storage='postgres')::int as in_postgres,
            coalesce(sum(size_bytes),0)::bigint::float8 as bytes,
            encode(sha256(convert_to(string_agg(sha256, ',' order by sha256), 'UTF8')), 'hex') as checksum
       from public.files where deleted_at is null and ($1::uuid is null or organization_id = $1)
      group by organization_id order by organization_id`,
    [options.organizationId ?? null],
  );
  report.byOrganization = orgs;
  return report;
}
