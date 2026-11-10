import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { zipSync, strToU8 } from "fflate";

/**
 * Генераторы документов Barowo из рабочего бота (v48) — исходный .gs код без переписывания.
 * Он выполняется в изолированном контексте vm; Google-сервисы заменены минимальными заглушками:
 * Utilities.newBlob / zip / base64Decode. Функции, которые трогают Drive/Docs/Telegram, не вызываются.
 */
const FILES = [
  "Helpers.gs",
  "Documents.gs",
  "OfferCatalog.gs",
  "BrandFontData.gs",
  "BrandLogoData.gs",
  "BrandedOffer.gs",
  "GuestMenu.gs",
  "GuestMenuWord.gs",
];

type Blob = {
  bytes: Uint8Array;
  name: string;
  type: string;
  setContentType(t: string): Blob;
  setName(n: string): Blob;
};

function blob(data: string | Uint8Array, type: string, name: string): Blob {
  const b: Blob = {
    bytes: typeof data === "string" ? strToU8(data) : data,
    type,
    name,
    setContentType(t) {
      b.type = t;
      return b;
    },
    setName(n) {
      b.name = n;
      return b;
    },
  };
  return b;
}

const Utilities = {
  newBlob: (data: string | Uint8Array, type: string, name: string) => blob(data, type, name),
  base64Decode: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
  zip(blobs: Blob[], name: string) {
    const entries: Record<string, Uint8Array> = {};
    for (const b of blobs) entries[b.name] = b.bytes;
    return blob(zipSync(entries), "application/zip", name);
  },
  getUuid: () => crypto.randomUUID(),
};

// Публичные функции движка (имена как в .gs).
type Engine = {
  BAROWO_OFFER_CATALOG: Record<string, { name: string; menu: [string, string][] }>;
  defaultOfferValues_(pkg: string): Record<string, string>;
  suggestedOfferPrice_(pkg: string, guests: string): number | "";
  offerSnapshot_(lead: string[], pkg: string, values: Record<string, unknown>): OfferSnapshot;
  brandedOfferPdf_(s: OfferSnapshot, number: string, filename: string): Blob;
  brandedOfferDocx_(s: OfferSnapshot, number: string, filename: string): Blob;
  guestMenuSnapshot_(values: { menu: string }, lead: string[]): GuestMenuSnapshot;
  guestMenuPdf_(s: GuestMenuSnapshot, filename: string): Blob;
  guestMenuDocx_(s: GuestMenuSnapshot, filename: string): Blob;
  parseDocumentHours_(v: string): string;
  parseDocumentGuests_(v: string): number;
  parseDocumentMoney_(v: string): number;
  parseDocumentDate_(v: string): Date;
  formatDocumentMoney_(v: number): string;
  formatDate(v: unknown): string;
  COL: Record<string, number>;
};

export type OfferSnapshot = {
  clientName: string;
  eventDate: string;
  eventType: string;
  city: string;
  venue: string;
  guests: number;
  hours: string;
  packageName: string;
  price: number;
  listPrice: number;
  discount: number;
  menu: [string, string][];
  message: string;
  service: string;
  alcohol: string;
  softs: string;
  ice: string;
  additions: string;
  brandLayoutVersion?: number;
  contact?: string;
};
export type GuestMenuSnapshot = {
  guestMenuVersion: 1;
  subtitle: string;
  menu: [string, string][];
  clientName: string;
  packageName: string;
  price: 0;
};

let engine: Engine | null = null;

export function barowoEngine(): Engine {
  if (engine) return engine;
  const dir = path.join(process.cwd(), "lib/documents/barowo/legacy");
  const source = FILES.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n;\n");
  const exportNames = [
    "BAROWO_OFFER_CATALOG",
    "defaultOfferValues_",
    "suggestedOfferPrice_",
    "offerSnapshot_",
    "brandedOfferPdf_",
    "brandedOfferDocx_",
    "guestMenuSnapshot_",
    "guestMenuPdf_",
    "guestMenuDocx_",
    "parseDocumentHours_",
    "parseDocumentGuests_",
    "parseDocumentMoney_",
    "parseDocumentDate_",
    "formatDocumentMoney_",
    "formatDate",
    "COL",
  ];
  const context = vm.createContext({
    Utilities,
    console,
    __exports: {} as Record<string, unknown>,
  });
  vm.runInContext(`${source}\n;__exports = { ${exportNames.join(", ")} };`, context, {
    filename: "barowo-legacy.js",
    timeout: 10_000,
  });
  engine = context.__exports as unknown as Engine;
  return engine;
}

/** Строка «как в листе Lidy» для функций бота, которые читают лида по номерам колонок. */
export function legacyLeadRow(lead: {
  client_name: string;
  client_full_name?: string | null;
  client_address?: string | null;
  event_type?: string | null;
  event_date?: string | null;
  event_city?: string | null;
  guests?: number | null;
  package_name?: string | null;
  service_hours?: string | null;
}) {
  const e = barowoEngine();
  const row = new Array<string>(37).fill("");
  const iso = lead.event_date;
  row[e.COL.NAME - 1] = lead.client_name;
  row[e.COL.CLIENT_FULL_NAME - 1] = lead.client_full_name ?? "";
  row[e.COL.CLIENT_ADDRESS - 1] = lead.client_address ?? "";
  row[e.COL.EVENT - 1] = lead.event_type ?? "";
  row[e.COL.DATE - 1] = iso ? iso.split("-").reverse().join(".") : "";
  row[e.COL.CITY - 1] = lead.event_city ?? "";
  row[e.COL.GUESTS - 1] = lead.guests ? String(lead.guests) : "";
  row[e.COL.PACKAGE - 1] = lead.package_name ?? "";
  row[e.COL.HOURS - 1] = lead.service_hours ?? "";
  return row;
}

export const PACKAGE_KEYS = ["simple", "standard", "premium"] as const;
export type PackageKey = (typeof PACKAGE_KEYS)[number];
