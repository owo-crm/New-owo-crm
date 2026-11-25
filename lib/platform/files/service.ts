import type { Queryable } from "../../db/core.ts";
import { S3Storage, s3ConfigFromEnv, type FileStorage } from "./storage.ts";

/**
 * M3.x — чтение содержимого файла с учётом места хранения (D-22).
 *
 * Пока bytea в старых таблицах не удалён (до M9), вызывающий код по-прежнему выбирает `content`
 * из своей таблицы и передаёт его сюда как запасной вариант. Если запись `files` говорит, что файл
 * уже в bucket, читаем оттуда и сверяем размер; при любой ошибке и FILES_FALLBACK_POSTGRES≠"false"
 * отдаём bytea и пишем предупреждение (без ключей и содержимого).
 */
export type LegacySource = {
  table: "lead_attachments" | "document_files" | "organization_templates";
  id: string;
};

let cached: { storage: FileStorage | null } | null = null;
/** S3-хранилище из переменных FILES_S3_*; null — не подключено. */
export function objectStorage(
  env: Record<string, string | undefined> = process.env,
): FileStorage | null {
  if (env === process.env && cached) return cached.storage;
  const cfg = s3ConfigFromEnv(env);
  const storage = cfg ? new S3Storage(cfg) : null;
  if (env === process.env) cached = { storage };
  return storage;
}
/** Только для тестов. */
export function resetObjectStorage(storage?: FileStorage | null) {
  cached = storage === undefined ? null : { storage };
}

export async function fileContent(
  db: Queryable,
  organizationId: string,
  source: LegacySource,
  legacy: Uint8Array | null,
  options: { storage?: FileStorage | null; fallback?: boolean } = {},
): Promise<Uint8Array | null> {
  const { rows } = await db.query<{
    storage: string;
    storage_key: string;
    size_bytes: string;
    id: string;
  }>(
    `select id, storage, storage_key, size_bytes from public.files
      where organization_id=$1 and source_table=$2 and source_id=$3 and deleted_at is null`,
    [organizationId, source.table, source.id],
  );
  const meta = rows[0];
  if (!meta || meta.storage !== "s3") return legacy;
  const storage = options.storage === undefined ? objectStorage() : options.storage;
  const fallback = options.fallback ?? process.env.FILES_FALLBACK_POSTGRES !== "false";
  try {
    if (!storage) throw new Error("storage not configured");
    const body = await storage.get(meta.storage_key);
    if (!body) throw new Error("object missing");
    if (body.byteLength !== Number(meta.size_bytes)) throw new Error("size mismatch");
    return body;
  } catch (error) {
    console.warn(
      `[files] s3 read failed for file ${meta.id}: ${(error as Error).message}${fallback ? " — fallback postgres" : ""}`,
    );
    if (fallback) return legacy;
    throw error;
  }
}
