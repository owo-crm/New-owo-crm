import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { z } from "zod";
import { defaultImportMapping, prepareCsvImport, type ImportMapping } from "../lib/leads/import.ts";
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
function localFile(filename: string) {
  const resolved = realpathSync(path.resolve(root, filename));
  if (!resolved.startsWith(root + path.sep)) throw new Error("File must be inside crm-web");
  return resolved;
}
async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      org: { type: "string" },
      mapping: { type: "string" },
      delimiter: { type: "string", default: "," },
      apply: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.file) throw new Error("Use --file data/imports/leads.csv [--org UUID] [--apply]");
  const mapping: ImportMapping = values.mapping
    ? {
        ...defaultImportMapping,
        ...z
          .record(z.string(), z.string())
          .parse(JSON.parse(readFileSync(localFile(values.mapping), "utf8"))),
      }
    : defaultImportMapping;
  const delimiter = z.enum([",", ";", "\t"]).parse(values.delimiter);
  const plan = prepareCsvImport(readFileSync(localFile(values.file), "utf8"), mapping, delimiter);
  console.log(
    JSON.stringify(
      {
        mode: values.apply ? "apply" : "dry-run",
        total: plan.total,
        valid: plan.valid.length,
        errors: plan.errors,
      },
      null,
      2,
    ),
  );
  if (plan.errors.length) {
    process.exitCode = 1;
    return;
  }
  if (!values.apply) return;
  const organization = z.uuid().parse(values.org);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let inserted = 0;
  let skipped = 0;
  try {
    for (const row of plan.valid) {
      const value = row.value;
      let data: unknown;
      try {
        const res = await client.query(
          "select public.import_legacy_lead($1,$2,$3,$4,$5,$6,$7,$8) as r",
          [
            organization,
            value.uid,
            value.lead,
            value.stage,
            value.createdAt,
            value.firstResponseAt,
            value.source,
            value.raw,
          ],
        );
        data = res.rows[0].r;
      } catch (error) {
        throw new Error(
          `Row ${row.row}: database_error (${(error as { code?: string }).code}); earlier rows are safe to rerun`,
        );
      }
      const result = z.object({ inserted: z.boolean() }).parse(data);
      if (result.inserted) inserted++;
      else skipped++;
    }
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ inserted, skipped }));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Import failed");
  process.exitCode = 1;
});
