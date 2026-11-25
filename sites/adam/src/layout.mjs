// Wspólne elementy: <head>, nawigacja, stopka, okruszki, formularz, FAQ, blok Expander.
import { site, crm, adam } from "./config.mjs";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const abs = (path) => site.url + path;

const NAV = [
  ["/nieruchomosci/", "Nieruchomości"],
  ["/zakup-mieszkania-trojmiasto/", "Zakup"],
  ["/sprzedaz-nieruchomosci-trojmiasto/", "Sprzedaż"],
  ["/refinansowanie-kredytu-hipotecznego/", "Refinansowanie"],
  ["/kalkulatory/", "Kalkulatory"],
  ["/#o-mnie", "O mnie"],
];

export function head(p) {
  const index = site.env === "production" && !p.noindex;
  const img = abs(p.ogImage || "/img/gdansk-motlawa.webp");
  const ld = [
    { "@context": "https://schema.org", "@type": "WebPage", name: p.title, description: p.description, url: abs(p.path), inLanguage: "pl-PL" },
    ...(p.crumbs?.length
      ? [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [["/", "Strona główna"], ...p.crumbs].map(([u, n], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: abs(u) })) }]
      : []),
    ...(p.jsonld || []),
  ];
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta name="robots" content="${index ? "index, follow" : "noindex, nofollow"}">
<link rel="canonical" href="${abs(p.path)}">
<meta property="og:type" content="website"><meta property="og:locale" content="${site.locale}">
<meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${abs(p.path)}"><meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#25352B">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300&family=Work+Sans:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/styles.css">
${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head><body${site.env !== "production" ? ' class="is-staging"' : ""}>`;
}

export function header(current) {
  const links = NAV.map(([u, n]) => `<li><a href="${u}"${current === u ? ' aria-current="page"' : ""}>${n}</a></li>`).join("");
  return `<a class="skip" href="#tresc">Przejdź do treści</a>
${site.env !== "production" ? '<div class="staging-bar">Wersja testowa — niewidoczna dla wyszukiwarek</div>' : ""}
<header class="nav"><a class="logo" href="/">Adam<small>agent nieruchomości · trójmiasto</small></a>
<nav aria-label="Główna"><details class="menu"><summary aria-label="Menu">Menu</summary><ul>${links}</ul></details><ul class="menu-wide">${links}</ul></nav>
<div class="nav-r">${adam.phone ? `<a class="tel" href="tel:${adam.phone.replace(/\s/g, "")}" data-ev="phone_click">${esc(adam.phone)}</a>` : ""}<a class="btn sm" href="#kontakt" data-ev="consultation_cta_click">Umów konsultację</a></div></header>
<main id="tresc">`;
}

export function crumbs(list) {
  const items = [["/", "Strona główna"], ...list];
  return `<nav class="crumbs" aria-label="Okruszki"><ol>${items
    .map(([u, n], i) => (i === items.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${u}">${esc(n)}</a></li>`))
    .join("")}</ol></nav>`;
}

const TOPICS = ["Zakup mieszkania", "Sprzedaż nieruchomości", "Refinansowanie kredytu hipotecznego", "Finansowanie zakupu", "Chcę omówić swoją sytuację"];

/** Formularz kontaktowy. topic — temat zaznaczony domyślnie; heading/lead — teksty strony. */
export function contact({ topic = TOPICS[0], heading = "Porozmawiajmy o Twoich planach.", lead, source, button = "Poproś o kontakt" }) {
  const ready = Boolean(crm.intakeKey);
  return `<section class="end" id="kontakt"><div class="end-t"><p class="lbl lbl-light">kontakt</p>
<h2>${heading}</h2><p>${lead || "Zostaw kontakt — oddzwonię i ustalimy, jaki powinien być następny krok. Konsultacja jest bezpłatna."}</p>
${adam.phone ? `<p class="end-phone"><a href="tel:${adam.phone.replace(/\s/g, "")}" data-ev="phone_click">${esc(adam.phone)}</a></p>` : ""}
${adam.email ? `<p><a href="mailto:${esc(adam.email)}">${esc(adam.email)}</a></p>` : ""}</div>
<form class="lead" novalidate data-endpoint="${ready ? `${crm.url}/api/intake/${crm.intakeKey}` : ""}" data-source="${esc(source)}"><div class="fields">
<div class="fl"><label for="f-name">Imię</label><input id="f-name" name="name" autocomplete="given-name" required></div>
<div class="fl"><label for="f-phone">Numer telefonu</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required></div>
<div class="fl"><label for="f-email">E-mail (opcjonalnie)</label><input id="f-email" name="email" type="email" autocomplete="email"></div>
<input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<fieldset class="pills"><legend>W czym mogę pomóc?</legend>${TOPICS.map((t) => `<label><input type="radio" name="temat" value="${t}"${t === topic ? " checked" : ""}><span>${t}</span></label>`).join("")}</fieldset>
<div class="fl"><label for="f-msg">Dodatkowa wiadomość (opcjonalnie)</label><textarea id="f-msg" name="message" rows="2"></textarea></div>
<label class="cs"><input type="checkbox" name="consent" required><span>Wyrażam zgodę na kontakt telefoniczny lub mailowy w sprawie mojego zapytania. Szczegóły w <a href="/polityka-prywatnosci/">polityce prywatności</a>.</span></label>
<button class="btn full" type="submit">${button}</button><p class="msg" role="status" aria-live="polite">${ready ? "" : "Formularz jest w przygotowaniu."}</p>
<p class="small">Nie podawaj w formularzu danych finansowych ani numerów dokumentów — omówimy je w rozmowie.</p></div></form></section>`;
}

export function faq(items, title = "Najczęściej zadawane pytania") {
  return `<section class="faq" id="faq"><div><p class="lbl">pytania</p><h2>${title}</h2></div><div>${items
    .map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${q}</summary><p>${a}</p></details>`)
    .join("")}</div></section>`;
}

/**
 * Ścieżka procesu: kroki + przerywana linia SVG rysowana wraz z przewijaniem (static/assets/app.js → initJourneys).
 * steps: [{ title, text, note? }]. Każda strona podaje własne teksty.
 */
export function journey({ id, label, title, lead, steps }) {
  return `<section class="journey" id="${id}" data-journey><p class="lbl">${label}</p><h2>${title}</h2>${lead ? `<p class="lead j-lead">${lead}</p>` : ""}
<div class="j-wrap"><svg class="j-svg" aria-hidden="true" focusable="false"><defs><mask id="${id}-mask" maskUnits="userSpaceOnUse"><path class="j-mask" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/></mask></defs>
<path class="j-base" fill="none"/><path class="j-line" fill="none" mask="url(#${id}-mask)"/></svg>
<ol class="j-steps">${steps.map((st, i) => `<li class="j-step"><span class="j-dot" aria-hidden="true"></span><span class="j-n">${String(i + 1).padStart(2, "0")}</span><h3>${st.title}</h3><p>${st.text}</p>${st.note ? `<p class="j-note">${st.note}</p>` : ""}</li>`).join("")}</ol></div></section>`;
}

export function footer() {
  return `</main><footer class="foot"><div class="foot-g"><div><a class="logo" href="/">Adam</a><p>${esc(adam.role)} · ${esc(adam.area)}</p>
${adam.company ? `<p>${esc(adam.company)}</p>` : ""}${adam.phone ? `<p><a href="tel:${adam.phone.replace(/\s/g, "")}" data-ev="phone_click">${esc(adam.phone)}</a></p>` : ""}</div>
<div><p class="lbl lbl-light">usługi</p><a href="/zakup-mieszkania-trojmiasto/">Zakup mieszkania</a><a href="/sprzedaz-nieruchomosci-trojmiasto/">Sprzedaż nieruchomości</a><a href="/refinansowanie-kredytu-hipotecznego/">Refinansowanie kredytu</a><a href="/nieruchomosci/">Nieruchomości</a></div>
<div><p class="lbl lbl-light">kalkulatory</p><a href="/kalkulator-raty-kredytu-hipotecznego/">Rata kredytu</a><a href="/kalkulator-zdolnosci-kredytowej/">Zdolność kredytowa</a><a href="/kalkulator-refinansowania-kredytu/">Refinansowanie</a></div>
<div><p class="lbl lbl-light">informacje</p><a href="/uslugi/">Wszystkie usługi</a><a href="/polityka-prywatnosci/">Polityka prywatności</a><p class="small">Finansowanie: we współpracy z ekspertami Expander. Adam nie jest doradcą kredytowym.</p></div></div></footer>
<script type="module" src="/assets/app.js"></script></body></html>`;
}

export const page = (p, body) => head(p) + header(p.nav) + body + footer();
