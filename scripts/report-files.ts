/**
 * M0 · статистика файлов (D-22). ТОЛЬКО ЧТЕНИЕ: транзакция `read only`, ничего не меняет.
 *
 * Три вида файлов, содержимое которых сейчас хранится в PostgreSQL (`bytea`):
 *   1. пользовательские файлы лидов — public.lead_attachments.content      (0032)
 *   2. сгенерированные документы    — public.document_files.content        (0015)
 *   3. шаблоны организаций          — public.organization_templates.content (0032)
 *
 * Запуск: DATABASE_URL=... node --experimental-strip-types scripts/report-files.ts [--json]
 * Вывод: по каждому виду — количество, суммарный/средний/максимальный размер, типы;
 * разбивка по организациям; размер таблиц на диске (вместе с TOAST).
 */
import pg from "pg";

const KINDS = [
  {
    kind: "user_files",
    table: "public.lead_attachments",
    type: "coalesce(nullif(content_type,''),'(brak)')",
  },
  { kind: "generated_documents", table: "public.document_files", type: "format" },
  { kind: "templates", table: "public.organization_templates", type: "kind" },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin transaction read only");
    const report: Record<string, unknown> = { generated_at: new Date().toISOString() };
    for (const k of KINDS) {
      const total = await client.query(
        `select count(*)::int as files,
                coalesce(sum(octet_length(content)),0)::bigint as bytes,
                coalesce(round(avg(octet_length(content))),0)::bigint as avg_bytes,
                coalesce(max(octet_length(content)),0)::bigint as max_bytes
           from ${k.table}`,
      );
      const byType = await client.query(
        `select ${k.type} as type, count(*)::int as files, sum(octet_length(content))::bigint as bytes
           from ${k.table} group by 1 order by bytes desc nulls last`,
      );
      const byOrg = await client.query(
        `select o.name as organization, count(*)::int as files, sum(octet_length(t.content))::bigint as bytes
           from ${k.table} t join public.organizations o on o.id = t.organization_id
          group by 1 order by bytes desc nulls last`,
      );
      const disk = await client.query(
        `select pg_total_relation_size($1::regclass)::bigint as table_bytes_with_toast`,
        [k.table],
      );
      report[k.kind] = {
        table: k.table,
        ...total.rows[0],
        ...disk.rows[0],
        by_type: byType.rows,
        by_organization: byOrg.rows,
      };
    }
    const db = await client.query(
      "select pg_database_size(current_database())::bigint as database_bytes",
    );
    report.database_bytes = db.rows[0].database_bytes;
    await client.query("rollback");

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const mb = (b: unknown) => `${(Number(b) / 1024 / 1024).toFixed(2)} MB`;
    console.log(`Statystyka plików (${report.generated_at}), baza: ${mb(report.database_bytes)}`);
    for (const k of KINDS) {
      const r = report[k.kind] as Record<string, unknown> & {
        by_type: { type: string; files: number; bytes: string }[];
        by_organization: { organization: string; files: number; bytes: string }[];
      };
      console.log(
        `\n${k.kind} (${k.table}): ${r.files} plików, ${mb(r.bytes)}, śr. ${mb(r.avg_bytes)}, maks. ${mb(r.max_bytes)}, tabela z TOAST ${mb(r.table_bytes_with_toast)}`,
      );
      for (const t of r.by_type) console.log(`  typ ${t.type}: ${t.files} · ${mb(t.bytes)}`);
      for (const o of r.by_organization)
        console.log(`  firma ${o.organization}: ${o.files} · ${mb(o.bytes)}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
