// Treść i kompozycja stron. Każda strona: { path, title, description, nav, crumbs, noindex, html }.
import { site, adam, facts, offers, reviews } from "./config.mjs";
import { esc, page, crumbs, contact, faq, journey } from "./layout.mjs";
import { fixtures } from "./fixtures.mjs";

const prod = site.env === "production";
const shownFacts = facts.filter((f) => f.confirmed || !prod);
const activeOffers = [...offers, ...(prod ? [] : fixtures)].filter((o) => o.status === "active");
const shownReviews = reviews.filter((r) => r.consent);

const pln = (n) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(n) + " zł";
const img = (src, alt, cls = "", lazy = true) =>
  `<img class="${cls}" src="/img/${src}.webp" alt="${esc(alt)}"${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'}>`;
const svc = (href, n, tag, title, text, photo, alt, dark) =>
  `<a class="svc${dark ? " r" : ""}" href="${href}">${img(photo, alt)}<div class="b"><span class="num">${n}</span><span class="pill">${tag}</span><h3>${title}</h3><p>${text}</p><span class="go">Dowiedz się więcej →</span></div></a>`;
const intro = (lbl, h1, lead) => `<header class="intro"><p class="lbl">${lbl}</p><h1>${h1}</h1><p class="lead">${lead}</p></header>`;
const steps = (list) =>
  `<ol class="steps">${list.map(([t, d, by]) => `<li><h3>${t}</h3><p>${d}</p>${by ? `<p class="by">— ${by}</p>` : ""}</li>`).join("")}</ol>`;
const related = (links) =>
  `<section class="related"><p class="lbl">zobacz też</p><ul>${links.map(([u, t, d]) => `<li><a href="${u}"><strong>${t}</strong><span>${d}</span></a></li>`).join("")}</ul></section>`;

function offerCard(o) {
  const cover = o.images?.[0];
  return `<article class="offer"><a href="/nieruchomosci/${o.slug}/" data-ev="property_card_click">
${cover ? `<img src="${cover.src}" alt="${esc(cover.alt)}" loading="lazy">` : ""}${o.demo ? '<span class="demo">dane testowe</span>' : ""}
<h3>${esc(o.city)} · ${esc(o.district)}</h3><p class="price">${o.price ? pln(o.price) : "cena na zapytanie"}</p>
<p class="muted">${esc(o.type)} · ${o.area} m² · ${o.rooms} ${o.rooms === 1 ? "pokój" : o.rooms < 5 ? "pokoje" : "pokoi"}</p></a></article>`;
}

// ───────────────────────── Strona główna — portfolio ─────────────────────────
const home = {
  path: "/",
  title: "Adam — agent nieruchomości w Trójmieście | Zakup, sprzedaż, finansowanie",
  description:
    "Szukasz mieszkania w Gdańsku, Sopocie lub Gdyni? Porozmawiaj z Adamem o zakupie lub sprzedaży nieruchomości oraz o finansowaniu we współpracy z ekspertami Expander.",
  html: () => `
<section class="hero"><div class="hero-t"><p class="lbl">agent nieruchomości · trójmiasto</p>
<h1>Cześć, jestem Adam. <em>Pomagam kupić i sprzedać mieszkanie w Trójmieście.</em></h1>
<p class="lead">Gdańsk, Sopot, Gdynia i okolice. Zaczynam od rozmowy o Twoich planach — a potem prowadzę Cię spokojnie przez kolejne kroki.</p>
<div class="cta"><a class="btn" href="/zakup-mieszkania-trojmiasto/">Szukam mieszkania</a><a class="btn o" href="/sprzedaz-nieruchomosci-trojmiasto/">Sprzedaję mieszkanie</a></div></div>
${adam.photo ? `<img class="hero-img arch" src="${adam.photo}" alt="Adam — agent nieruchomości" fetchpriority="high">` : img("gdansk-motlawa", "Kamienice nad Motławą w Gdańsku", "hero-img arch", false)}</section>
<section class="facts"><ul>${shownFacts.map((f) => `<li><strong>${f.value}</strong>${f.label}</li>`).join("")}</ul></section>
${activeOffers.length ? `<section><div class="sec-h"><div><p class="lbl">nieruchomości</p><h2>Aktualne oferty</h2></div><a class="u" href="/nieruchomosci/">Wszystkie oferty →</a></div><div class="offers">${activeOffers.slice(0, 3).map(offerCard).join("")}</div></section>` : ""}
<section class="duo"><p class="lbl">w czym pomagam</p><h2>Kupujesz czy sprzedajesz?</h2><div class="duo-g">
${svc("/zakup-mieszkania-trojmiasto/", "01", "kupujący", "Zakup mieszkania", "Szukasz miejsca do życia, mieszkania nad morzem albo pod wynajem.", "salon-drewno", "Przestronny salon z drewnianymi meblami")}
${svc("/sprzedaz-nieruchomosci-trojmiasto/", "02", "właściciele", "Sprzedaż nieruchomości", "Chcesz sprzedać mieszkanie lub dom spokojnie i w uporządkowany sposób.", "salon-jasny", "Jasny salon z dużymi oknami", true)}</div>
<a class="aside-card" href="/refinansowanie-kredytu-hipotecznego/"><span class="lbl">masz już kredyt hipoteczny?</span><strong>Sprawdź, czy jego warunki można poprawić</strong><span class="go">Refinansowanie kredytu →</span></a></section>
<section class="band">${img("gdansk-nabrzeze", "Nabrzeże Motławy i Żuraw w Gdańsku")}<p>Gdańsk · Sopot · Gdynia<em>rynek, który znam na co dzień</em></p></section>
<section class="about" id="o-mnie">${adam.photo ? `<img class="arch" src="${adam.photo}" alt="Adam" loading="lazy">` : img("pokoj-okna", "Jasne wnętrze mieszkania z dużymi oknami", "arch")}
<div><p class="lbl">o mnie</p><h2>Poznajmy się.</h2>
<p>Od pięciu lat pracuję w sprzedaży i z klientami. Dziś pomagam osobom, które kupują lub sprzedają nieruchomości w Trójmieście — na własne potrzeby albo z myślą o inwestycji.</p>
<p>Zależy mi na tym, żeby dobrze zrozumieć Twoje plany i uczciwie powiedzieć, co jest możliwe. Jedna osoba do kontaktu od pierwszej rozmowy do finału.</p></div></section>
${shownReviews.length ? `<section><p class="lbl">opinie</p><h2>Słowa klientów</h2><div class="notes">${shownReviews.map((r) => `<figure><blockquote>${esc(r.text)}</blockquote><figcaption>— ${esc(r.author)}${r.city ? `, ${esc(r.city)}` : ""}</figcaption></figure>`).join("")}</div></section>` : ""}
${contact({ source: "strona główna", lead: "Zostaw kontakt — oddzwonię, poznam Twoje plany i powiem, jak mogę pomóc. Pierwsza rozmowa jest bezpłatna i do niczego nie zobowiązuje." })}`,
};

// ───────────────────────── Usługi ─────────────────────────
const uslugi = {
  path: "/uslugi/",
  title: "Usługi — zakup, sprzedaż nieruchomości i refinansowanie | Adam, Trójmiasto",
  description: "Zakup i sprzedaż nieruchomości w Trójmieście oraz kontakt z ekspertami Expander w sprawie finansowania i refinansowania kredytu hipotecznego.",
  crumbs: [["/uslugi/", "Usługi"]],
  html: () => `${crumbs([["/uslugi/", "Usługi"]])}
${intro("usługi", "Trzy sposoby, w jakie mogę pomóc", "Główna część mojej pracy to nieruchomości — pomoc kupującym i sprzedającym w Trójmieście. Sprawy kredytowe prowadzą eksperci Expander, z którymi współpracuję.")}
<section class="duo"><div class="duo-g three-up">
${svc("/zakup-mieszkania-trojmiasto/", "01", "kupujący", "Zakup mieszkania", "Dla osób szukających mieszkania do życia, nad morzem lub pod wynajem.", "wnetrze-zielen", "Mieszkanie z roślinami i drewnianymi meblami")}
${svc("/sprzedaz-nieruchomosci-trojmiasto/", "02", "właściciele", "Sprzedaż nieruchomości", "Dla właścicieli, którzy rozważają sprzedaż mieszkania lub domu.", "kuchnia-salon", "Otwarta kuchnia z salonem")}
${svc("/refinansowanie-kredytu-hipotecznego/", "03", "z Expander", "Refinansowanie kredytu", "Dla osób spłacających kredyt hipoteczny, które chcą sprawdzić warunki.", "fotel", "Żółty fotel w jasnym wnętrzu", true)}</div></section>
${contact({ source: "usługi" })}`,
};

// ───────────────────────── Zakup ─────────────────────────
const zakup = {
  path: "/zakup-mieszkania-trojmiasto/",
  title: "Zakup mieszkania w Trójmieście — pomoc agenta nieruchomości | Adam",
  description: "Kupujesz mieszkanie w Gdańsku, Sopocie lub Gdyni? Pomogę znaleźć nieruchomość, umówić prezentacje i przejść przez zakup. Finansowanie z ekspertami Expander.",
  nav: "/zakup-mieszkania-trojmiasto/",
  crumbs: [["/uslugi/", "Usługi"], ["/zakup-mieszkania-trojmiasto/", "Zakup mieszkania"]],
  ogImage: "/img/wnetrze-zielen.webp",
  html: () => `${crumbs(zakup.crumbs)}
<section class="split">${intro("zakup mieszkania", "Zakup mieszkania w Trójmieście — <em>z jednym agentem od początku do końca</em>", "Szukasz miejsca do życia, drugiego mieszkania nad morzem albo nieruchomości pod wynajem? Zacznijmy od rozmowy o Twoich planach.")}${img("wnetrze-zielen", "Przytulne mieszkanie z roślinami i drewnianymi meblami", "arch", false)}</section>
<section class="cols"><div><h2>Dla kogo</h2><ul class="list"><li><strong>Pierwsze mieszkanie.</strong> Wyjaśnię kolejne kroki i pomogę uniknąć chaosu.</li><li><strong>Kupujący spoza Trójmiasta.</strong> Część klientów przyjeżdża m.in. z Warszawy — wstępny wybór robimy zdalnie, prezentacje planujemy na konkretne dni.</li><li><strong>Zakup inwestycyjny.</strong> Omówimy lokalizacje i rodzaje nieruchomości pod najem długoterminowy lub wakacyjny — bez obietnic konkretnej rentowności.</li></ul></div>
<div><h2>Co robię</h2><ul class="list"><li>Rozmawiam o budżecie, lokalizacji i priorytetach.</li><li>Przedstawiam nieruchomości, których sprzedaż prowadzę, i pomagam porównać je z innymi opcjami.</li><li>Umawiam i prowadzę prezentacje.</li><li>Koordynuję kolejne kroki aż do umowy — w zakresie, który ustalimy.</li></ul>
<p class="muted small">Nie wykonuję ekspertyz prawnych, technicznych ani analiz kredytowych — w razie potrzeby wskażę, z kim warto porozmawiać.</p></div></section>
${journey({ id: "droga-zakupu", label: "jak działam", title: "Spokojna droga do zakupu", steps: [
    { title: "Rozmowa o Twoich potrzebach", text: "Poznajemy się i rozmawiamy o budżecie, lokalizacji, terminie i oczekiwaniach." },
    { title: "Dobór nieruchomości", text: "Przedstawiam nieruchomości z ofert, których sprzedaż prowadzę, dopasowane do tego, czego szukasz." },
    { title: "Prezentacje i wybór", text: "Umawiam oglądanie, porównujemy warianty i pomagam Ci podjąć decyzję." },
    { title: "Formalności i finalizacja", text: "Koordynuję kolejne etapy transakcji i pomagam doprowadzić ją do końca — w uzgodnionym zakresie." },
  ] })}
<section class="aside-note"><div><p class="lbl">finansowanie</p><h3>Kupujesz na kredyt?</h3></div><div><p>Jeśli planujesz zakup z wykorzystaniem kredytu hipotecznego, mogę połączyć Cię z ekspertami Expander, którzy pomogą dobrać odpowiednie finansowanie i przejść przez formalności.</p>
<p><a class="u" href="#kontakt" data-topic="Finansowanie zakupu" data-ev="consultation_cta_click">Zapytaj o kontakt w sprawie kredytu</a></p></div></section>
${related([
    ["/nieruchomosci/", "Aktualne nieruchomości", "Oferty, których sprzedaż prowadzę."],
    ["/kalkulator-raty-kredytu-hipotecznego/", "Kalkulator raty", "Ile wyniesie rata przy danej kwocie?"],
    ["/kalkulator-zdolnosci-kredytowej/", "Kalkulator zdolności", "Orientacyjny zakres kredytu."],
  ])}
${faq([
    ["Czy pomagasz tylko przy ofertach, które prowadzisz?", "Przedstawiam przede wszystkim nieruchomości, których sprzedaż prowadzę. Zakres pomocy przy innych ofertach ustalamy indywidualnie."],
    ["Ile kosztuje Twoja pomoc kupującemu?", "Zasady współpracy omawiamy na pierwszej rozmowie, zanim cokolwiek podpiszesz."],
    ["Czy mogę kupić mieszkanie, mieszkając w innym mieście?", "Tak. Wstępny wybór robimy zdalnie, prezentacje planujemy tak, by zmieścić je w jednym lub dwóch przyjazdach."],
    ["Czy pomożesz z kredytem?", "Połączę Cię z ekspertami Expander, którzy zajmują się analizą i procesem kredytowym. Ja dbam o koordynację z zakupem."],
  ], "Pytania kupujących")}
${contact({ topic: "Zakup mieszkania", heading: "Porozmawiajmy o zakupie.", source: "zakup", button: "Umów konsultację" })}`,
};

// ───────────────────────── Sprzedaż ─────────────────────────
const sprzedaz = {
  path: "/sprzedaz-nieruchomosci-trojmiasto/",
  title: "Sprzedaż mieszkania w Trójmieście — agent nieruchomości | Adam",
  description: "Rozważasz sprzedaż mieszkania lub domu w Gdańsku, Sopocie lub Gdyni? Porozmawiajmy o cenie ofertowej, prezentacjach i kolejnych krokach sprzedaży.",
  nav: "/sprzedaz-nieruchomosci-trojmiasto/",
  crumbs: [["/uslugi/", "Usługi"], ["/sprzedaz-nieruchomosci-trojmiasto/", "Sprzedaż nieruchomości"]],
  ogImage: "/img/kuchnia-salon.webp",
  html: () => `${crumbs(sprzedaz.crumbs)}
<section class="split">${intro("sprzedaż nieruchomości", "Sprzedajesz mieszkanie w Trójmieście? <em>Zacznijmy od rozmowy.</em>", "Pomagam właścicielom przejść przez sprzedaż spokojnie i w uporządkowany sposób — od pierwszej rozmowy po spotkanie u notariusza.")}${img("kuchnia-salon", "Jasne mieszkanie z otwartą kuchnią", "arch", false)}</section>
<section class="cols"><div><h2>Na pierwszej rozmowie</h2><ul class="list"><li>Poznaję nieruchomość i Twoje plany: termin, oczekiwania, sytuację.</li><li>Omawiamy, jak przygotować ofertę i jak pokazać mieszkanie kupującym.</li><li>Ustalamy zasady i zakres współpracy.</li></ul></div>
<div><h2>W trakcie sprzedaży</h2><ul class="list"><li>Prowadzę kontakt z zainteresowanymi i prezentacje.</li><li>Informuję Cię o przebiegu rozmów z kupującymi.</li><li>Pomagam w organizacji kolejnych etapów aż do umowy.</li></ul>
<p class="muted small">Dokładny zakres usług — np. sesja zdjęciowa czy forma promocji oferty — ustalamy indywidualnie.</p></div></section>
<section id="jak"><p class="lbl">proces</p><h2>Etapy sprzedaży</h2>${steps([
    ["Rozmowa i oględziny", "Poznaję nieruchomość, jej stan i Twoje oczekiwania."],
    ["Przygotowanie oferty", "Ustalamy cenę ofertową, opis i sposób prezentacji."],
    ["Prezentacje", "Prowadzę kontakt z zainteresowanymi i oglądanie mieszkania."],
    ["Umowa", "Koordynuję ustalenia z kupującym aż do podpisania umowy."],
  ])}</section>
<section class="band">${img("salon-widok", "Salon z widokiem przez duże okna")}<p>Sprzedaż w Trójmieście<em>Gdańsk · Sopot · Gdynia</em></p></section>
${faq([
    ["Ile trwa sprzedaż mieszkania?", "To zależy od lokalizacji, stanu, ceny i sytuacji na rynku. Nie obiecuję konkretnego terminu — omówimy realne scenariusze dla Twojej nieruchomości."],
    ["Czy pomożesz ustalić cenę?", "Omówimy cenę ofertową na podstawie rozmowy i ofert podobnych mieszkań. Profesjonalną wycenę wykonuje rzeczoznawca majątkowy."],
    ["Czy kupujący może skorzystać z kredytu?", "Tak — zainteresowanych kupujących mogę skontaktować z ekspertami Expander, co często porządkuje proces po stronie finansowania."],
  ], "Pytania sprzedających")}
${contact({ topic: "Sprzedaż nieruchomości", heading: "Porozmawiajmy o sprzedaży.", source: "sprzedaż", button: "Porozmawiaj o sprzedaży" })}`,
};

// ───────────────────────── Refinansowanie ─────────────────────────
const refi = {
  path: "/refinansowanie-kredytu-hipotecznego/",
  title: "Refinansowanie kredytu hipotecznego — Trójmiasto | Adam i eksperci Expander",
  description: "Spłacasz kredyt hipoteczny? Eksperci Expander sprawdzą, czy obecne warunki można poprawić. Bez zobowiązań — Adam pomaga w kontakcie i koordynacji.",
  nav: "/refinansowanie-kredytu-hipotecznego/",
  crumbs: [["/uslugi/", "Usługi"], ["/refinansowanie-kredytu-hipotecznego/", "Refinansowanie kredytu"]],
  ogImage: "/img/salon-bez.webp",
  html: () => `${crumbs(refi.crumbs)}
<section class="split">${intro("refinansowanie kredytu", "Masz kredyt hipoteczny? <em>Sprawdź, czy obecne warunki są dla Ciebie korzystne.</em>", "Refinansowanie to przeniesienie kredytu do innego banku albo zmiana jego warunków. Czy to ma sens — zależy od Twojej sytuacji. Ocenę przygotowują eksperci Expander, a moja pomoc jest bezpłatna.")}${img("salon-bez", "Spokojny, beżowy salon", "arch", false)}</section>
<section class="cols"><div><h2>Kiedy warto sprawdzić</h2><ul class="list"><li>Od uruchomienia kredytu minęło co najmniej kilka miesięcy.</li><li>Przed Tobą jeszcze długi okres spłaty lub znaczny kapitał.</li><li>Marża lub oprocentowanie wyraźnie odbiegają od obecnych ofert.</li><li>Twoja sytuacja dochodowa jest stabilna.</li></ul><p class="muted small">To nie są warunki kwalifikacji — ostateczną ocenę przygotowuje specjalista, a decyzję podejmuje bank.</p></div>
<div><h2>Co jest analizowane</h2><ul class="list"><li>pozostały kapitał i okres spłaty,</li><li>obecna marża, oprocentowanie i rata,</li><li>ubezpieczenia i produkty dodatkowe,</li><li>dochody i inne zobowiązania.</li></ul><p class="muted small">Tych danych nie podajesz w formularzu na stronie — omówisz je bezpośrednio z ekspertem.</p></div></section>
<section class="aside-note"><div><p class="lbl">współpraca</p><h3>Kto analizuje kredyt?</h3></div><div><p>W sprawach refinansowania współpracuję z Expander. Eksperci tej firmy analizują obecne warunki kredytu, porównują dostępne oferty banków i pomagają przejść przez proces.</p></div></section>
<section class="aside-note"><div><p class="lbl">koszty</p><h3>Ile to kosztuje?</h3></div><div><p>Pomoc Adama w kontakcie i organizacji procesu refinansowania jest bezpłatna. W niektórych przypadkach potrzebna jest osobna wycena nieruchomości — jej orientacyjny koszt to około 800 zł. Opłatę klient przekazuje bezpośrednio osobie wykonującej wycenę, nie Adamowi. Dokładny koszt i konieczność wyceny są potwierdzane indywidualnie.</p></div></section>
${journey({ id: "droga-refinansowania", label: "jak to wygląda", title: "Sprawdźmy, czy Twój kredyt można poprawić", steps: [
    { title: "Zostawiasz kontakt", text: "Wystarczy imię i telefon. Na tym etapie nie potrzebuję dokumentów ani danych o kredycie." },
    { title: "Rozmowa z Adamem", text: "Poznaję Twoją sytuację, wyjaśniam, jak wygląda dalszy proces, i organizuję kontakt ze specjalistami." },
    { title: "Analiza kredytu", text: "Eksperci Expander analizują obecny kredyt i porównują możliwe warianty finansowania." },
    { title: "Możliwe rozwiązania", text: "Dowiadujesz się o możliwych warunkach, kosztach i korzyściach — i decydujesz, czy chcesz iść dalej.", note: "Ostateczną decyzję kredytową podejmuje bank." },
  ] })}
${related([
    ["/kalkulator-refinansowania-kredytu/", "Kalkulator refinansowania", "Zobacz, jak zmieniłaby się rata przy niższym oprocentowaniu."],
    ["/kalkulator-raty-kredytu-hipotecznego/", "Kalkulator raty", "Sprawdź ratę przy innym oprocentowaniu."],
  ])}
${faq([
    ["Czy refinansowanie zawsze się opłaca?", "Nie. Wszystko zależy od różnicy w oprocentowaniu, pozostałego kapitału i okresu oraz indywidualnej oceny banku. Bywa, że zmiana nie ma sensu — i to też warto wiedzieć."],
    ["Ile to kosztuje?", "Pomoc Adama w kontakcie i organizacji procesu refinansowania jest bezpłatna. W niektórych przypadkach potrzebna jest osobna wycena nieruchomości — jej orientacyjny koszt to około 800 zł. Opłatę klient przekazuje bezpośrednio osobie wykonującej wycenę, nie Adamowi. Dokładny koszt i konieczność wyceny są potwierdzane indywidualnie."],
    ["Czy muszę zmieniać bank?", "Niekoniecznie. Czasem wystarczy renegocjacja warunków w obecnym banku. Eksperci pomogą porównać obie drogi."],
    ["Kto podejmuje decyzję?", "Decyzję kredytową podejmuje bank. Eksperci Expander przygotowują analizę i prowadzą proces, Ty decydujesz, czy z niego skorzystać."],
  ], "Pytania o refinansowanie")}
${contact({ topic: "Refinansowanie kredytu hipotecznego", heading: "Porozmawiajmy o Twoim kredycie.", lead: "Zostaw imię i telefon — oddzwonię, poznam Twoją sytuację i wyjaśnię kolejne kroki. Nie podawaj teraz danych o kredycie.", source: "refinansowanie", button: "Porozmawiaj z Adamem o refinansowaniu" })}`,
};

// ───────────────────────── Katalog ─────────────────────────
const katalog = {
  path: "/nieruchomosci/",
  title: "Nieruchomości na sprzedaż w Trójmieście — oferty Adama",
  description: "Aktualne mieszkania i nieruchomości na sprzedaż w Gdańsku, Sopocie i Gdyni, których sprzedaż prowadzi Adam. Zapytaj o ofertę i umów prezentację.",
  nav: "/nieruchomosci/",
  crumbs: [["/nieruchomosci/", "Nieruchomości"]],
  noindex: offers.filter((o) => o.status === "active").length === 0, // pusty katalog nie trafia do indeksu
  html: () => `${crumbs(katalog.crumbs)}
${intro("nieruchomości", "Nieruchomości w Trójmieście", "Oferty, których sprzedaż prowadzę. Szczegóły, dostępność i termin prezentacji omówimy bezpośrednio.")}
${activeOffers.length ? `<section><div class="offers">${activeOffers.map(offerCard).join("")}</div></section>`
    : `<section class="empty"><h2>Nowe oferty pojawią się wkrótce</h2><p>Część nieruchomości prezentuję, zanim trafią do publicznych ogłoszeń. Napisz, czego szukasz — dam znać, gdy pojawi się coś odpowiedniego.</p><a class="btn" href="#kontakt">Powiedz, czego szukasz</a></section>`}
${contact({ topic: "Zakup mieszkania", heading: "Zapytaj o nieruchomość.", source: "katalog" })}`,
};

function offerPage(o) {
  const path = `/nieruchomosci/${o.slug}/`;
  const c = [["/nieruchomosci/", "Nieruchomości"], [path, o.title]];
  return {
    path, nav: "/nieruchomosci/", crumbs: c, noindex: o.demo || o.status !== "active",
    title: `${o.title} — ${o.city}, ${o.district} | Adam, agent nieruchomości`,
    description: `${o.type[0].toUpperCase() + o.type.slice(1)} ${o.area} m², ${o.rooms} pok., ${o.city} ${o.district}. ${o.price ? pln(o.price) + "." : ""} Zapytaj o ofertę i umów prezentację.`,
    ogImage: o.images?.[0]?.src,
    html: () => `${crumbs(c)}
<article class="offer-page"><header class="intro"><p class="lbl">${esc(o.city)} · ${esc(o.district)}${o.demo ? " · dane testowe" : ""}</p><h1>${esc(o.title)}</h1>
<p class="price">${o.price ? pln(o.price) : "cena na zapytanie"}</p>${o.status !== "active" ? `<p class="pill">${o.status === "reserved" ? "rezerwacja" : "sprzedane"}</p>` : ""}</header>
<div class="gallery">${(o.images || []).map((im, i) => `<img src="${im.src}" alt="${esc(im.alt)}"${i ? ' loading="lazy"' : ""}>`).join("")}</div>
<div class="cols"><div><h2>Opis</h2><p>${esc(o.description)}</p></div><div><h2>Parametry</h2><dl class="params"><dt>Typ</dt><dd>${esc(o.type)}</dd><dt>Powierzchnia</dt><dd>${o.area} m²</dd><dt>Pokoje</dt><dd>${o.rooms}</dd>${(o.features || []).map((f) => `<dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd>`).join("")}</dl>
<p class="muted small">Ofertę prezentuje Adam — agent nieruchomości. Aktualizacja: ${esc(o.updated)}.</p></div></div></article>
${contact({ topic: "Zakup mieszkania", heading: "Zapytaj o tę ofertę.", source: `oferta ${o.id}` })}`,
  };
}

// ───────────────────────── Kalkulatory ─────────────────────────
const calcNote = `<p class="note">Wyniki są orientacyjne i zakładają stałe parametry przez cały okres. Nie są ofertą banku ani decyzją kredytową. Obliczenia wykonują się w Twojej przeglądarce — nic nie jest wysyłane. Aktualizacja założeń: ${site.calcUpdated}.</p>`;
const field = (name, label, value, attrs = "", suffix = "") =>
  `<div class="cf"><label for="c-${name}">${label}</label><div class="inp"><input id="c-${name}" name="${name}" inputmode="decimal" value="${value}" ${attrs}>${suffix ? `<span>${suffix}</span>` : ""}</div></div>`;
const calcCta = (topic, text) =>
  `<div class="calc-cta"><p>${text}</p><a class="btn o" href="#kontakt" data-topic="${topic}" data-ev="calculator_consultation_click">Porozmawiaj o wyniku</a><p class="small muted">Twoje wyliczenia nie są przesyłane — w formularzu zostawiasz tylko kontakt.</p></div>`;

const kalkulatory = {
  path: "/kalkulatory/",
  title: "Kalkulatory kredytu hipotecznego — rata, zdolność, refinansowanie",
  description: "Bezpłatne kalkulatory: rata kredytu hipotecznego, orientacyjna zdolność kredytowa i symulacja refinansowania. Wyniki od razu, bez podawania telefonu.",
  nav: "/kalkulatory/",
  crumbs: [["/kalkulatory/", "Kalkulatory"]],
  html: () => `${crumbs(kalkulatory.crumbs)}
${intro("kalkulatory", "Policz, zanim podejmiesz decyzję", "Proste narzędzia do pierwszych wyliczeń. Wynik zobaczysz od razu — bez zostawiania danych kontaktowych.")}
<section><ul class="tools big"><li><a href="/kalkulator-raty-kredytu-hipotecznego/"><strong>Kalkulator raty kredytu hipotecznego</strong><span>Raty równe i malejące, suma odsetek, harmonogram roczny.</span></a></li>
<li><a href="/kalkulator-zdolnosci-kredytowej/"><strong>Kalkulator zdolności kredytowej</strong><span>Orientacyjny zakres kwoty kredytu przy Twoich dochodach i kosztach.</span></a></li>
<li><a href="/kalkulator-refinansowania-kredytu/"><strong>Kalkulator refinansowania kredytu</strong><span>Jak zmieniłaby się rata przy niższym oprocentowaniu.</span></a></li></ul></section>
${contact({ topic: "Finansowanie zakupu", heading: "Wolisz porozmawiać?", source: "kalkulatory" })}`,
};

const kRata = {
  path: "/kalkulator-raty-kredytu-hipotecznego/",
  title: "Kalkulator raty kredytu hipotecznego — raty równe i malejące",
  description: "Oblicz ratę kredytu hipotecznego: raty równe lub malejące, suma odsetek i harmonogram. Wynik od razu, obliczenia w przeglądarce.",
  nav: "/kalkulatory/",
  crumbs: [["/kalkulatory/", "Kalkulatory"], ["/kalkulator-raty-kredytu-hipotecznego/", "Rata kredytu"]],
  html: () => `${crumbs(kRata.crumbs)}
${intro("kalkulator", "Kalkulator raty kredytu hipotecznego", "Podaj cenę, wkład własny, oprocentowanie i okres — zobaczysz ratę, sumę odsetek i harmonogram spłaty.")}
<section class="calc" data-calc="rata"><form class="calc-in" novalidate>
${field("price", "Cena nieruchomości", "600 000", "", "zł")}${field("own", "Wkład własny", "120 000", "", "zł")}
${field("rate", "Oprocentowanie (rocznie)", "7", "", "%")}${field("years", "Okres kredytu", "30", "", "lat")}
<fieldset class="pills"><legend>Rodzaj rat</legend><label><input type="radio" name="type" value="rowne" checked><span>raty równe</span></label><label><input type="radio" name="type" value="malejace"><span>raty malejące</span></label></fieldset>
<p class="small muted">Stopa zmienna może się zmieniać — kalkulator nie prognozuje jej zmian.</p></form>
<div class="calc-out" aria-live="polite"><p class="big" data-out="first">—</p><p data-out="firstLabel" class="muted">pierwsza rata</p>
<dl><dt>Kwota kredytu</dt><dd data-out="loan">—</dd><dt>Wkład własny</dt><dd data-out="ownPct">—</dd><dt>Ostatnia rata</dt><dd data-out="last">—</dd><dt>Suma odsetek</dt><dd data-out="interest">—</dd><dt>Łącznie do spłaty</dt><dd data-out="total">—</dd></dl>
<p class="err" data-out="error"></p></div>
<details class="table"><summary>Harmonogram roczny</summary><table><thead><tr><th>Rok</th><th>Spłacone</th><th>Kapitał</th><th>Odsetki</th><th>Pozostało</th></tr></thead><tbody data-out="years"></tbody></table></details>
${calcNote}${calcCta("Finansowanie zakupu", "Chcesz sprawdzić realne oferty banków? Eksperci Expander porównają je dla Ciebie.")}</section>
<section class="prose"><h2>Jak liczona jest rata</h2><p><strong>Raty równe</strong> mają stałą wysokość przez cały okres (przy niezmiennym oprocentowaniu). Na początku większą część raty stanowią odsetki, później kapitał. Wzór: R = K × i / (1 − (1 + i)<sup>−n</sup>), gdzie K to kwota kredytu, i — miesięczna stopa (roczna / 12), n — liczba rat.</p>
<p><strong>Raty malejące</strong> składają się ze stałej części kapitałowej (K / n) i odsetek od pozostałego długu. Pierwsza rata jest wyższa, ale łączny koszt odsetek — niższy.</p>
<h2>Czego kalkulator nie uwzględnia</h2><p>Zmian oprocentowania w czasie, prowizji, ubezpieczeń, kosztów wyceny i innych opłat. Rzeczywisty koszt kredytu określa oferta banku (m.in. RRSO).</p></section>
${related([["/kalkulator-zdolnosci-kredytowej/", "Zdolność kredytowa", "Ile możesz pożyczyć?"], ["/zakup-mieszkania-trojmiasto/", "Zakup mieszkania", "Jak wygląda zakup ze mną."]])}
${contact({ topic: "Finansowanie zakupu", heading: "Porozmawiajmy o finansowaniu.", source: "kalkulator raty" })}`,
};

const kZdolnosc = {
  path: "/kalkulator-zdolnosci-kredytowej/",
  title: "Kalkulator zdolności kredytowej — orientacyjna kwota kredytu",
  description: "Sprawdź orientacyjny zakres kredytu hipotecznego przy Twoich dochodach, kosztach i zobowiązaniach. Scenariusz z buforem stopy, bez podawania danych kontaktowych.",
  nav: "/kalkulatory/",
  crumbs: [["/kalkulatory/", "Kalkulatory"], ["/kalkulator-zdolnosci-kredytowej/", "Zdolność kredytowa"]],
  html: () => `${crumbs(kZdolnosc.crumbs)}
${intro("kalkulator", "Kalkulator zdolności kredytowej", "Orientacyjny zakres kwoty kredytu. To scenariusz oparty na prostych założeniach — każdy bank ocenia zdolność według własnych zasad.")}
<section class="calc" data-calc="zdolnosc"><form class="calc-in" novalidate>
${field("income", "Dochód netto gospodarstwa (miesięcznie)", "10 000", "", "zł")}${field("obligations", "Raty i inne zobowiązania (miesięcznie)", "0", "", "zł")}
${field("people", "Liczba osób w gospodarstwie", "2", 'inputmode="numeric"')}${field("living", "Koszty życia na osobę (założenie)", "1 500", "", "zł")}
${field("rate", "Oprocentowanie (rocznie)", "7", "", "%")}${field("years", "Okres kredytu", "30", "", "lat")}
${field("own", "Wkład własny", "100 000", "", "zł")}
<details class="adv"><summary>Założenia</summary>${field("dsti", "Maks. udział rat w dochodzie", "40", "", "%")}${field("buffer", "Bufor stopy (ostrożny scenariusz)", "2,5", "", "p.p.")}</details></form>
<div class="calc-out" aria-live="polite"><p class="big" data-out="range">—</p><p class="muted">orientacyjna kwota kredytu</p>
<dl><dt>Maksymalna rata w scenariuszu</dt><dd data-out="payment">—</dd><dt>Cena nieruchomości z wkładem</dt><dd data-out="price">—</dd></dl><p class="err" data-out="error"></p></div>
${calcNote}${calcCta("Finansowanie zakupu", "Rzeczywistą zdolność oceniają eksperci Expander na podstawie Twoich dokumentów i ofert banków.")}</section>
<section class="prose"><h2>Jak powstaje wynik</h2><p>Maksymalną ratę przyjmujemy jako mniejszą z dwóch wartości: <em>dochód × maksymalny udział rat − obecne zobowiązania</em> oraz <em>dochód − zobowiązania − koszty życia wszystkich osób</em>. Z tej raty liczymy kwotę kredytu dwa razy: przy podanym oprocentowaniu (górna granica) i przy oprocentowaniu powiększonym o bufor (dolna granica), bo banki badają zdolność z zapasem na wzrost stóp.</p>
<h2>Dlaczego wynik może się różnić od banku</h2><p>Banki stosują własne koszty utrzymania, limity, wymagania co do źródła i stażu dochodu, historii kredytowej i wkładu własnego. Kalkulator nie odwzorowuje algorytmu żadnego banku.</p></section>
${related([["/kalkulator-raty-kredytu-hipotecznego/", "Kalkulator raty", "Ile wyniesie rata?"], ["/zakup-mieszkania-trojmiasto/", "Zakup mieszkania", "Pomoc przy zakupie w Trójmieście."]])}
${contact({ topic: "Finansowanie zakupu", heading: "Porozmawiajmy o finansowaniu.", source: "kalkulator zdolności" })}`,
};

const kRefi = {
  path: "/kalkulator-refinansowania-kredytu/",
  title: "Kalkulator refinansowania kredytu hipotecznego — symulacja raty",
  description: "Zobacz, jak zmieniłaby się rata kredytu hipotecznego przy oprocentowaniu niższym o 0,5, 1 i 1,5 punktu procentowego. Ten sam kapitał i okres, obliczenia w przeglądarce.",
  nav: "/kalkulatory/",
  crumbs: [["/kalkulatory/", "Kalkulatory"], ["/kalkulator-refinansowania-kredytu/", "Refinansowanie"]],
  html: () => `${crumbs(kRefi.crumbs)}
${intro("kalkulator", "Kalkulator refinansowania kredytu", "Podaj pozostały kapitał, okres i obecne oprocentowanie — pokażemy, jak zmieniłaby się rata przy trzech przykładowych obniżkach oprocentowania.")}
<section class="calc" data-calc="refi"><form class="calc-in" novalidate>
${field("balance", "Pozostały kapitał", "400 000", "", "zł")}${field("months", "Pozostały okres", "300", 'inputmode="numeric"', "mies.")}
${field("cur", "Obecne oprocentowanie", "8", "", "%")}${field("pay", "Obecna rata z harmonogramu (opcjonalnie)", "", "", "zł")}</form>
<div class="calc-out" aria-live="polite"><p class="big" data-out="current">—</p><p class="muted" data-out="currentLabel">obecna rata</p>
<table class="scen"><thead><tr><th>Oprocentowanie</th><th>Rata</th><th>Różnica / mies.</th><th>Różnica / 12 mies.</th></tr></thead><tbody data-out="rows"></tbody></table>
<p class="err" data-out="error"></p></div>
<p class="note">To symulacja matematyczna, a nie oferta banku. Rzeczywista rata i dostępne warunki zależą od indywidualnej oceny ekspertów oraz decyzji banku. Symulacja zakłada niezmienne oprocentowanie i ten sam pozostały okres spłaty. Przedstawione obniżki oprocentowania są wyłącznie przykładowymi scenariuszami. Obliczenia wykonują się w Twojej przeglądarce. Aktualizacja: ${site.calcUpdated}.</p>
${calcCta("Refinansowanie kredytu hipotecznego", "Chcesz wiedzieć, jakie warunki są realne w Twojej sytuacji? Porozmawiaj z Adamem — analizę przygotują eksperci Expander.")}</section>
<section class="prose"><h2>Jak liczymy</h2><p>Obecną ratę bierzemy z harmonogramu (jeśli ją podasz) albo wyliczamy dla rat równych z pozostałego kapitału, okresu i oprocentowania. Dla każdego scenariusza liczymy ratę przy oprocentowaniu niższym o 0,5, 1 i 1,5 punktu procentowego — dla <strong>tego samego kapitału i okresu</strong>. Różnica za 12 miesięcy zakłada, że oprocentowanie się nie zmienia.</p>
<h2>Czego symulacja nie pokazuje</h2><p>Nie zna ofert banków ani Twojej sytuacji, nie uwzględnia ubezpieczeń, produktów dodatkowych ani ewentualnych kosztów zmiany. To nie jest prognoza rynku — tylko przykład, jak oprocentowanie wpływa na ratę.</p></section>
${related([["/refinansowanie-kredytu-hipotecznego/", "Refinansowanie z Expander", "Jak wygląda analiza i kto ją prowadzi."], ["/kalkulator-raty-kredytu-hipotecznego/", "Kalkulator raty", "Rata przy dowolnym oprocentowaniu."]])}
${contact({ topic: "Refinansowanie kredytu hipotecznego", heading: "Porozmawiajmy o Twoim kredycie.", source: "kalkulator refinansowania", button: "Porozmawiaj z Adamem o refinansowaniu" })}`,
};

const polityka = {
  path: "/polityka-prywatnosci/",
  title: "Polityka prywatności | Adam — agent nieruchomości",
  description: "Informacje o przetwarzaniu danych osobowych przekazanych przez formularz kontaktowy.",
  noindex: true,
  html: () => `${intro("informacje", "Polityka prywatności", "Jak przetwarzamy dane z formularza kontaktowego.")}
<section class="prose"><h2>Administrator</h2><p>Administratorem danych jest Adam — agent nieruchomości${adam.company ? `, ${esc(adam.company)}` : ""}.${adam.email ? ` Kontakt: ${esc(adam.email)}.` : ""}</p>
<h2>Jakie dane i w jakim celu</h2><p>Imię, numer telefonu, opcjonalnie e-mail i treść wiadomości — wyłącznie w celu kontaktu w sprawie Twojego zapytania (art. 6 ust. 1 lit. a i f RODO). Dane są przechowywane w systemie CRM obsługującym zgłoszenia.</p>
<h2>Przekazanie danych</h2><p>W sprawach finansowania, wyłącznie za Twoją zgodą wyrażoną w rozmowie, kontakt może zostać przekazany ekspertom Expander.</p>
<h2>Twoje prawa</h2><p>Masz prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, wycofania zgody w dowolnym momencie oraz wniesienia skargi do Prezesa UODO.</p>
<h2>Kalkulatory</h2><p>Dane wpisywane do kalkulatorów nie są nigdzie wysyłane — obliczenia wykonują się w Twojej przeglądarce.</p></section>`,
};

export const notFound = {
  path: "/404.html",
  title: "Nie znaleziono strony | Adam — agent nieruchomości",
  description: "Strona nie istnieje.",
  noindex: true,
  html: () => `${intro("404", "Tej strony nie ma", "Mogła zostać przeniesiona albo oferta jest już nieaktualna.")}<section class="cta"><a class="btn" href="/">Strona główna</a> <a class="btn o" href="/nieruchomosci/">Nieruchomości</a></section>`,
};

export const pages = [home, uslugi, zakup, sprzedaz, refi, katalog, ...activeOffers.map(offerPage), kalkulatory, kRata, kZdolnosc, kRefi, polityka];

export const render = (p) => page(p, p.html());
