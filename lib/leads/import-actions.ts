"use server";
import { revalidatePath } from "next/cache";
import { getDb, one } from "@/lib/db";
import { requireOrganization } from "@/lib/auth/session";
import { prepareCsvImport } from "./import";
import { isBarowoSheet, prepareBarowoImport } from "./import-barowo";

export type ImportState = {
  error?: string;
  report?: {
    format: string;
    total: number;
    valid: number;
    skipped: number;
    errors: { row: number; code: string }[];
    inserted?: number;
    existing?: number;
  };
};

/** Импорт лидов из CSV: сначала проверка (ничего не пишет), потом — запись. Повтор безопасен. */
export async function importLeadsAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { organization } = await requireOrganization();
  if (!["owner", "admin"].includes(organization.role))
    return { error: "Import może uruchomić właściciel lub administrator." };
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Wybierz plik CSV." };
  if (file.size > 5 * 1024 * 1024) return { error: "Plik jest za duży (maks. 5 MB)." };
  const csv = await file.text();
  const delimiter =
    (csv.split("\n", 1)[0].match(/;/g)?.length ?? 0) >
    (csv.split("\n", 1)[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const apply = form.get("apply") === "1";
  try {
    const barowo = isBarowoSheet(csv, delimiter);
    const plan = barowo
      ? prepareBarowoImport(csv, delimiter)
      : { ...prepareCsvImport(csv, undefined, delimiter), skipped: 0 };
    const report: NonNullable<ImportState["report"]> = {
      format: barowo ? "Arkusz „Lidy” (bot Barowo)" : "CSV ogólny",
      total: plan.total,
      valid: plan.valid.length,
      skipped: plan.skipped,
      errors: plan.errors.slice(0, 50),
    };
    if (!apply) return { report };
    const db = getDb();
    let inserted = 0,
      existing = 0;
    for (const { row, value } of plan.valid) {
      try {
        await db.transaction(async (tx) => {
          const res = await one<{ r: { id: string; inserted: boolean } }>(
            tx,
            "select public.import_legacy_lead($1,$2,$3,$4,$5,$6,$7,$8) as r",
            [
              organization.id,
              value.uid,
              value.lead,
              value.stage,
              value.createdAt,
              value.firstResponseAt,
              value.source,
              "raw" in value ? value.raw : {},
            ],
          );
          if (!res!.r.inserted) return void existing++;
          inserted++;
          if ("extras" in value)
            await tx.query("select public.import_legacy_extras($1,$2,$3,$4,$5)", [
              organization.id,
              res!.r.id,
              value.extras,
              value.note,
              value.assignedName,
            ]);
        });
      } catch {
        report.errors.push({ row, code: "database_error" });
      }
    }
    revalidatePath("/", "layout");
    return { report: { ...report, inserted, existing } };
  } catch (error) {
    return {
      error: `Nie udało się odczytać pliku (${(error as Error).message.slice(0, 80)}). Wyeksportuj arkusz jako CSV.`,
    };
  }
}
