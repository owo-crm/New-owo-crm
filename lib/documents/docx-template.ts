import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const run = promisify(execFile);

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Заполняет поля {{NAZWA}} в Word-шаблоне (тело, колонтитулы), сохраняя оформление.
 * Как в боте: неизвестное поле в шаблоне = ошибка, а не пустое место в договоре.
 */
export function fillDocxTemplate(template: Uint8Array, values: Record<string, string | number>) {
  const files = unzipSync(template);
  const parts = Object.keys(files).filter((n) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(n),
  );
  for (const name of parts) {
    const xml = strFromU8(files[name]);
    const filled = xml.replace(/\{\{([A-Z_]+)\}\}/g, (_m, key: string) => {
      if (!(key in values)) throw new Error(`Brak wartości pola szablonu: ${key}`);
      return xmlEscape(String(values[key]));
    });
    if (/\{\{|\}\}/.test(filled.replace(/<[^>]+>/g, "")))
      throw new Error(
        "Pole szablonu jest rozbite formatowaniem w Wordzie — wpisz je ponownie w całości.",
      );
    files[name] = strToU8(filled);
  }
  return zipSync(files);
}

/** DOCX → PDF przez LibreOffice (headless). Każde wywołanie ma własny profil — można równolegle. */
export async function docxToPdf(docx: Uint8Array) {
  const dir = await mkdtemp(path.join(tmpdir(), "owo-pdf-"));
  try {
    const input = path.join(dir, "doc.docx");
    await writeFile(input, docx);
    await run(
      process.env.SOFFICE_PATH || "soffice",
      [
        `-env:UserInstallation=file://${path.join(dir, "profile")}`,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        input,
      ],
      { timeout: 90_000 },
    );
    return new Uint8Array(await readFile(path.join(dir, "doc.pdf")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
