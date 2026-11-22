// Импорт шаблонов писем и документов в одну фирму (решение 053).
//   npm run templates:import -- --org barowo --file templates/barowo.json            # только отчёт
//   npm run templates:import -- --org barowo --file templates/barowo.json --apply    # запись
//   ... --apply --overwrite   # заменить шаблоны с теми же именами (правки владельца пропадут!)
// Готовые PDF (document_kind = "file"): путь в поле "file" — относительно JSON-файла.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import type { Database } from "../lib/db/core.ts";
import {
  applyImport,
  importFile,
  planImport,
  type PdfBytes,
} from "../lib/mailing/import-templates.ts";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    file: { type: "string" },
    apply: { type: "boolean", default: false },
    overwrite: { type: "boolean", default: false },
  },
});
if (!values.org || !values.file) {
  console.error(
    "Użycie: npm run templates:import -- --org <slug> --file <plik.json> [--apply] [--overwrite]",
  );
  process.exit(1);
}
const parsed = importFile.safeParse(JSON.parse(readFileSync(values.file, "utf8")));
if (!parsed.success) {
  for (const issue of parsed.error.issues)
    console.error(`✗ ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const templates = parsed.data.templates;
const files: PdfBytes = {};
for (const x of templates)
  if (x.file) {
    const full = path.resolve(path.dirname(values.file), x.file);
    files[x.file] = new Uint8Array(readFileSync(full));
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
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  },
};
try {
  const org = (
    await client.query<{ id: string; name: string; document_engine: string | null }>(
      "select id, name, document_engine from public.organizations where slug=$1",
      [values.org],
    )
  ).rows[0];
  if (!org) throw new Error(`Nie ma firmy o slugu „${values.org}”`);
  const options = { overwrite: values.overwrite, files, engine: org.document_engine };
  const count = async () =>
    (
      await client.query<{ n: number }>(
        "select count(*)::int as n from public.mailing_templates where organization_id=$1",
        [org.id],
      )
    ).rows[0].n;
  console.log(`Firma: ${org.name} (${values.org}) · szablonów przed: ${await count()}`);
  const plan = values.apply
    ? await applyImport(db, org.id, templates, options)
    : await planImport(client as never, org.id, templates, options);
  for (const row of plan)
    console.log(`${row.action.padEnd(12)} ${row.name}${row.reason ? ` — ${row.reason}` : ""}`);
  if (values.apply) console.log(`Zapisano. Szablonów po: ${await count()}`);
  else console.log("Tylko podgląd. Dodaj --apply, żeby zapisać.");
  if (plan.some((r) => r.action === "error")) process.exitCode = 1;
} catch (error) {
  console.error("✗", (error as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
