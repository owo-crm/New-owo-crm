import { createHash, createHmac } from "node:crypto";
import type { Queryable } from "../../db/core.ts";

/**
 * M1.7 — интерфейс хранения файлов (D-22, docs/architecture/OWO_CRM_MIGRATION_PLAN.md M1.7).
 *
 * Пока ТОЛЬКО интерфейс и реализации: приложение по-прежнему читает и пишет файлы как раньше
 * (bytea в lead_attachments, document_files, organization_templates). Переключение — M3/M3.x.
 *
 * Правила безопасности:
 *  - хранилище НЕ проверяет права — это делает маршрут приложения ДО обращения к хранилищу;
 *  - публичных объектов нет: S3 — приватный bucket, доступ только подписанной ссылкой;
 *  - подписанная ссылка живёт не дольше MAX_SIGNED_URL_SECONDS (5 минут);
 *  - целостность — sha256, считается при записи и проверяется при переносе.
 */

export const MAX_SIGNED_URL_SECONDS = 300;

export type PutOptions = { contentType: string; sha256?: string };
export type ObjectInfo = { size: number; sha256: string | null; contentType: string | null };

export interface FileStorage {
  readonly kind: "postgres" | "s3";
  put(key: string, body: Uint8Array, options: PutOptions): Promise<{ sha256: string }>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<ObjectInfo | null>;
  delete(key: string): Promise<void>;
  /** Короткоживущая ссылка на скачивание; null — хранилище отдаёт содержимое только через приложение. */
  signedUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string | null>;
}

export const sha256Hex = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

export class StorageError extends Error {}

// ───────────────────────── PostgreSQL (текущее хранение, только чтение) ─────────────────────────

/** Ключ существующего файла: «pg:<таблица>:<uuid>». Только таблицы из белого списка. */
const PG_SOURCES = {
  lead_attachments: { contentType: "content_type" },
  document_files: { contentType: null },
  organization_templates: { contentType: null },
  template_files: { contentType: "content_type" },
} as const;
type PgTable = keyof typeof PG_SOURCES;

export function pgKey(table: PgTable, id: string) {
  return `pg:${table}:${id}`;
}

function parsePgKey(key: string): { table: PgTable; id: string; idColumn: string } {
  const m = /^pg:([a-z_]+):([0-9a-f-]{36})$/.exec(key);
  if (!m || !(m[1] in PG_SOURCES)) throw new StorageError(`Nieprawidłowy klucz: ${key}`);
  // organization_templates адресуется по organization_id (одна строка на вид шаблона).
  return {
    table: m[1] as PgTable,
    id: m[2],
    idColumn: m[1] === "organization_templates" ? "organization_id" : "id",
  };
}

/**
 * Текущие файлы в bytea. Запись и удаление — через существующий код приложения (как и раньше),
 * поэтому здесь они запрещены: эта реализация нужна для чтения при переносе (M3.x) и как fallback.
 */
export class PostgresStorage implements FileStorage {
  readonly kind = "postgres" as const;
  constructor(private readonly db: Queryable) {}

  async put(): Promise<{ sha256: string }> {
    throw new StorageError("PostgresStorage jest tylko do odczytu (stare pliki).");
  }
  async delete(): Promise<void> {
    throw new StorageError("PostgresStorage jest tylko do odczytu (stare pliki).");
  }
  async get(key: string) {
    const { table, id, idColumn } = parsePgKey(key);
    const { rows } = await this.db.query<{ content: Buffer }>(
      `select content from public.${table} where ${idColumn} = $1 limit 1`,
      [id],
    );
    return rows[0] ? new Uint8Array(rows[0].content) : null;
  }
  async head(key: string) {
    const content = await this.get(key);
    if (!content) return null;
    const { table, id, idColumn } = parsePgKey(key);
    const ct = PG_SOURCES[table].contentType;
    const type = ct
      ? ((
          await this.db.query<{ t: string }>(
            `select ${ct} as t from public.${table} where ${idColumn} = $1 limit 1`,
            [id],
          )
        ).rows[0]?.t ?? null)
      : null;
    return { size: content.byteLength, sha256: sha256Hex(content), contentType: type };
  }
  async signedUrl() {
    return null;
  }
}

// ───────────────────────── S3-совместимое хранилище (приватный bucket) ─────────────────────────

export type S3Config = {
  endpoint: string; // https://<host> (без bucket)
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetchImpl?: typeof fetch;
};

/** Конфигурация из переменных Railway; без них — null (хранилище не подключено). */
export function s3ConfigFromEnv(env: Record<string, string | undefined>): S3Config | null {
  const {
    FILES_S3_ENDPOINT,
    FILES_S3_REGION,
    FILES_S3_BUCKET,
    FILES_S3_ACCESS_KEY_ID,
    FILES_S3_SECRET_ACCESS_KEY,
  } = env;
  if (
    !FILES_S3_ENDPOINT ||
    !FILES_S3_BUCKET ||
    !FILES_S3_ACCESS_KEY_ID ||
    !FILES_S3_SECRET_ACCESS_KEY
  )
    return null;
  return {
    endpoint: FILES_S3_ENDPOINT.replace(/\/+$/, ""),
    region: FILES_S3_REGION || "auto",
    bucket: FILES_S3_BUCKET,
    accessKeyId: FILES_S3_ACCESS_KEY_ID,
    secretAccessKey: FILES_S3_SECRET_ACCESS_KEY,
  };
}

const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();
const amzDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
// RFC 3986: кодируем всё, кроме unreserved; «/» в пути объекта сохраняем.
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const encPath = (s: string) => s.split("/").map(enc).join("/");

function signingKey(secret: string, date: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
}

/** Подписанная ссылка (SigV4, query string). Экспортировано для проверки на эталоне AWS. */
export function presignS3(
  cfg: Pick<S3Config, "endpoint" | "region" | "bucket" | "accessKeyId" | "secretAccessKey">,
  method: string,
  key: string,
  expires: number,
  now: Date,
  extraQuery: Record<string, string> = {},
  virtualHost = false,
) {
  const url = new URL(cfg.endpoint);
  const host = virtualHost ? `${cfg.bucket}.${url.host}` : url.host;
  const path = virtualHost ? `/${encPath(key)}` : `/${enc(cfg.bucket)}/${encPath(key)}`;
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    ...extraQuery,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join("&");
  const canonical = [method, path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, date, cfg.region), toSign).toString("hex");
  return `${url.protocol}//${host}${path}?${qs}&X-Amz-Signature=${signature}`;
}

export class S3Storage implements FileStorage {
  readonly kind = "s3" as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly cfg: S3Config) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async request(
    method: string,
    key: string,
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ) {
    const url = new URL(this.cfg.endpoint);
    const path = `/${enc(this.cfg.bucket)}/${encPath(key)}`;
    const stamp = amzDate(new Date());
    const date = stamp.slice(0, 8);
    const scope = `${date}/${this.cfg.region}/s3/aws4_request`;
    const payloadHash = sha256Hex(body ?? "");
    const all: Record<string, string> = {
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()])),
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
    };
    const names = Object.keys(all).sort();
    const canonical = [
      method,
      path,
      "",
      names.map((n) => `${n}:${all[n]}\n`).join(""),
      names.join(";"),
      payloadHash,
    ].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
    const signature = hmac(
      signingKey(this.cfg.secretAccessKey, date, this.cfg.region),
      toSign,
    ).toString("hex");
    const { host: _host, ...sendHeaders } = all;
    void _host;
    return this.fetchImpl(`${url.protocol}//${url.host}${path}`, {
      method,
      body: body ? Buffer.from(body) : undefined,
      headers: {
        ...sendHeaders,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
    });
  }

  async put(key: string, body: Uint8Array, options: PutOptions) {
    const sha256 = sha256Hex(body);
    if (options.sha256 && options.sha256 !== sha256)
      throw new StorageError("Suma kontrolna nie zgadza się z treścią pliku.");
    const res = await this.request("PUT", key, body, {
      "content-type": options.contentType || "application/octet-stream",
      "x-amz-meta-sha256": sha256,
    });
    if (!res.ok) throw new StorageError(`S3 PUT ${res.status}`);
    return { sha256 };
  }
  async get(key: string) {
    const res = await this.request("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new StorageError(`S3 GET ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async head(key: string) {
    const res = await this.request("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new StorageError(`S3 HEAD ${res.status}`);
    return {
      size: Number(res.headers.get("content-length") ?? 0),
      sha256: res.headers.get("x-amz-meta-sha256"),
      contentType: res.headers.get("content-type"),
    };
  }
  async delete(key: string) {
    const res = await this.request("DELETE", key);
    if (!res.ok && res.status !== 404) throw new StorageError(`S3 DELETE ${res.status}`);
  }
  async signedUrl(key: string, ttlSeconds: number, downloadName?: string) {
    const ttl = Math.max(1, Math.min(MAX_SIGNED_URL_SECONDS, Math.floor(ttlSeconds)));
    const extra: Record<string, string> = downloadName
      ? { "response-content-disposition": `attachment; filename*=UTF-8''${enc(downloadName)}` }
      : {};
    return presignS3(this.cfg, "GET", key, ttl, new Date(), extra);
  }
}
