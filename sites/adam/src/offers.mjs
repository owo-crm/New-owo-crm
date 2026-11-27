// Oferty Adama — jedno źródło: plik data/offers.json (lub OFFERS_FILE).
// Dziś wypełniany ręcznie; później ten sam format może zapisywać import z CRM Adama
// (np. eksport na portale), bez zmian w szablonach strony.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STATUSES = ["active", "reserved", "sold", "hidden"];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Sprawdza jedną ofertę; zwraca listę błędów (pustą, gdy oferta jest poprawna). */
export function offerErrors(o, i = 0) {
  const at = `oferta #${i + 1}${o && o.id ? ` (${o.id})` : ""}`;
  const errs = [];
  const need = (cond, msg) => cond || errs.push(`${at}: ${msg}`);
  if (!o || typeof o !== "object") return [`${at}: nie jest obiektem`];
  need(typeof o.id === "string" && o.id.length > 0 && o.id.length <= 60, "id — tekst do 60 znaków");
  need(typeof o.slug === "string" && SLUG.test(o.slug) && o.slug.length <= 120, "slug — małe litery, cyfry i myślniki");
  need(typeof o.title === "string" && o.title.length >= 3 && o.title.length <= 160, "title — 3–160 znaków");
  need(typeof o.city === "string" && o.city.length > 0, "city — wymagane");
  need(typeof o.district === "string" && o.district.length > 0, "district — wymagane");
  need(typeof o.type === "string" && o.type.length > 0, "type — np. mieszkanie");
  need(typeof o.area === "number" && o.area > 0 && o.area < 100000, "area — m², liczba > 0");
  need(Number.isInteger(o.rooms) && o.rooms >= 0 && o.rooms <= 50, "rooms — liczba całkowita");
  need(o.price === null || o.price === undefined || (Number.isInteger(o.price) && o.price > 0), "price — złote (liczba całkowita) albo null = „cena na zapytanie”");
  need(STATUSES.includes(o.status), `status — jeden z: ${STATUSES.join(", ")}`);
  need(typeof o.description === "string", "description — tekst (może być pusty)");
  need(DATE.test(o.updated ?? ""), "updated — data RRRR-MM-DD");
  need(Array.isArray(o.images) && o.images.length > 0, "images — co najmniej jedno zdjęcie");
  for (const [j, im] of (Array.isArray(o.images) ? o.images : []).entries()) {
    need(im && typeof im.src === "string" && (/^\/img\/[\w./-]+$/.test(im.src) || /^https:\/\/[^\s"<>]+$/.test(im.src)), `images[${j}].src — /img/… albo https://…`);
    need(im && typeof im.alt === "string" && im.alt.trim().length > 0, `images[${j}].alt — opis zdjęcia jest wymagany`);
  }
  need(o.features === undefined || (Array.isArray(o.features) && o.features.every((f) => Array.isArray(f) && f.length === 2 && f.every((x) => typeof x === "string"))), "features — lista par [\"Balkon\", \"tak\"]");
  return errs;
}

/** Wczytuje i sprawdza plik ofert. Zduplikowane slugi i id też są błędem. */
export function loadOffers(file) {
  if (!existsSync(file)) return { offers: [], errors: [] };
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { offers: [], errors: [`${file}: niepoprawny JSON (${e.message})`] };
  }
  if (!Array.isArray(data)) return { offers: [], errors: [`${file}: oczekiwano listy ofert`] };
  const errors = data.flatMap((o, i) => offerErrors(o, i));
  for (const key of ["slug", "id"]) {
    const seen = new Set();
    for (const o of data) {
      if (o && seen.has(o[key])) errors.push(`powtórzony ${key}: ${o[key]}`);
      if (o) seen.add(o[key]);
    }
  }
  return { offers: errors.length ? [] : data, errors };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const offersFile = process.env.OFFERS_FILE ? join(process.cwd(), process.env.OFFERS_FILE) : join(root, "data/offers.json");
export const loaded = loadOffers(offersFile);
