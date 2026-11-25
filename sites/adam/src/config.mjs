// Jedno miejsce na wszystkie dane, które Adam potwierdza lub dostarcza.
// Zmienne środowiskowe (przy budowaniu): SITE_ENV, SITE_URL, CRM_URL, INTAKE_KEY.

const env = process.env;

export const site = {
  /** "production" → indeksowanie włączone; wszystko inne (staging, dev) → noindex. */
  env: env.SITE_ENV === "production" ? "production" : "staging",
  url: (env.SITE_URL || "http://localhost:4300").replace(/\/+$/, ""),
  name: "Adam — agent nieruchomości",
  locale: "pl_PL",
  /** Data ostatniej weryfikacji założeń kalkulatorów. */
  calcUpdated: "2026-11-24",
};

/** Formularz → publiczny endpoint OWO CRM (kanał „Strona WWW”, domena strony na liście dozwolonych). */
export const crm = {
  url: (env.CRM_URL || "").replace(/\/+$/, ""),
  intakeKey: env.INTAKE_KEY || "",
};

/** Dane Adama. null = jeszcze nie dostarczone → element nie jest wyświetlany. */
export const adam = {
  name: "Adam",
  surname: null,
  role: "Agent nieruchomości",
  area: "Trójmiasto — Gdańsk, Sopot, Gdynia i okolice",
  phone: null, // np. "+48 600 000 000"
  email: null,
  photo: null, // np. "/img/adam.webp" — tylko prawdziwe zdjęcie Adama
  company: null,
};

/** Fakty z flagą potwierdzenia. Niepotwierdzone nie trafiają na produkcję. */
export const facts = [
  { value: "5 lat", label: "doświadczenia w sprzedaży", confirmed: true },
  { value: "200+", label: "obsłużonych klientów", confirmed: false },
  { value: "Trójmiasto", label: "główny obszar działania", confirmed: true },
  { value: "Expander", label: "wsparcie w finansowaniu", confirmed: true },
];

/**
 * Oferty nieruchomości. Puste do czasu przekazania prawdziwych danych przez Adama.
 * status: "active" | "reserved" | "sold" | "hidden". Na stronie katalogu tylko "active".
 * {
 *   id, slug: "gdansk-wrzeszcz-3-pokoje-z-balkonem", title, city, district, price, currency: "PLN",
 *   area, rooms, type: "mieszkanie", description, features: [], images: [{ src, alt }],
 *   status, published: "2026-12-01", updated: "2026-12-01"
 * }
 */
export const offers = [];

/** Opinie — tylko prawdziwe, za zgodą klienta: { text, author: "Marta K.", city, date, consent: true }. */
export const reviews = [];
