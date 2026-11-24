// Formularz kontaktowy, kalkulatory i warstwa zdarzeń (dataLayer — bez identyfikatorów narzędzi).
import { schedule, capacity, refinance } from "./calc.mjs";

window.dataLayer = window.dataLayer || [];
const track = (event, data = {}) => window.dataLayer.push({ event, ...data });

// UTM z pierwszego wejścia zapamiętujemy na czas sesji, żeby dotarły do CRM także z podstron.
const UTM_KEY = "adam_utm";
const params = new URLSearchParams(location.search);
const utmNow = Object.fromEntries([...params].filter(([k]) => k.startsWith("utm_")));
try { if (Object.keys(utmNow).length) sessionStorage.setItem(UTM_KEY, JSON.stringify({ ...utmNow, landing: location.pathname })); } catch {}
const utm = () => { try { return JSON.parse(sessionStorage.getItem(UTM_KEY) || "{}"); } catch { return {}; } };

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-ev],[data-topic]");
  if (!el) return;
  if (el.dataset.ev) track(el.dataset.ev, { href: el.getAttribute("href") });
  if (el.dataset.topic) {
    const r = document.querySelector(`form.lead input[name=temat][value="${el.dataset.topic}"]`);
    if (r) r.checked = true;
  }
});

// ───── Formularz ─────
for (const form of document.querySelectorAll("form.lead")) {
  const msg = form.querySelector(".msg");
  let started = false;
  form.addEventListener("input", () => { if (!started) { started = true; track("lead_form_start", { source: form.dataset.source }); } });
  form.addEventListener("change", (e) => { if (e.target.value === "Refinansowanie kredytu hipotecznego") track("refinance_topic_select"); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "msg"; msg.textContent = "";
    form.querySelectorAll(".fl").forEach((f) => f.classList.remove("bad"));
    const d = new FormData(form);
    const name = String(d.get("name") || "").trim(), phone = String(d.get("phone") || "").trim();
    const bad = (id, text) => { form.querySelector(id).closest(".fl")?.classList.add("bad"); form.querySelector(id).focus(); msg.className = "msg err"; msg.textContent = text; };
    if (!name) return bad("#f-name", "Podaj imię.");
    if (phone.replace(/\D/g, "").length < 9) return bad("#f-phone", "Podaj poprawny numer telefonu.");
    if (!d.get("consent")) { msg.className = "msg err"; msg.textContent = "Zaznacz zgodę na kontakt."; return; }
    if (!form.dataset.endpoint) { msg.className = "msg err"; msg.textContent = "Formularz jest w przygotowaniu — spróbuj później."; return; }
    const btn = form.querySelector("button");
    btn.disabled = true; btn.textContent = "Wysyłanie…";
    const temat = String(d.get("temat"));
    const u = utm();
    const body = {
      name, phone, email: String(d.get("email") || "").trim() || undefined, website: d.get("website"),
      message: [`Temat: ${temat}`, String(d.get("message") || "").trim()].filter(Boolean).join("\n"),
      consent: true, page_url: location.href, referrer: document.referrer || undefined,
      submission_id: crypto.randomUUID?.(),
      custom_fields: { temat, zrodlo: `strona Adama — ${form.dataset.source}`, strona_wejscia: u.landing },
      utm: Object.fromEntries(Object.entries(u).filter(([k]) => k.startsWith("utm_"))),
    };
    try {
      const res = await fetch(form.dataset.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      track("lead_form_submit", { source: form.dataset.source, topic: temat });
      form.querySelector(".fields").innerHTML = '<div class="ok"><h3>Dziękuję!</h3><p>Zapytanie dotarło. Skontaktuję się z Tobą najszybciej, jak to możliwe.</p></div>';
    } catch {
      btn.disabled = false; btn.textContent = "Poproś o kontakt";
      msg.className = "msg err"; msg.textContent = "Nie udało się wysłać. Sprawdź połączenie i spróbuj ponownie.";
    }
  });
}

// ───── Kalkulatory ─────
const n = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
const zl = (v) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Math.round(v)) + " zł";
const zl2 = (v) => new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " zł";

const calcs = {
  rata(v, out) {
    const price = n(v.price), own = n(v.own), loan = price - own;
    if (!(price > 0) || !(own >= 0) || !(loan > 0)) return "Wkład własny musi być mniejszy niż cena nieruchomości.";
    const s = schedule({ principal: loan, ratePct: n(v.rate), months: n(v.years) * 12, type: v.type });
    if (!s) return "Sprawdź oprocentowanie (0–50%) i okres (1–50 lat).";
    out({ first: zl2(s.first), firstLabel: v.type === "rowne" ? "miesięczna rata (stała)" : "pierwsza rata (potem maleje)", loan: zl(loan), ownPct: `${zl(own)} (${((own / price) * 100).toFixed(1).replace(".", ",")}%)`,
      last: zl2(s.last), interest: zl(s.interest), total: zl(s.total),
      years: s.years.map((y) => `<tr><td>${y.year}</td><td>${zl(y.paid)}</td><td>${zl(y.capital)}</td><td>${zl(y.interest)}</td><td>${zl(y.balance)}</td></tr>`).join("") });
  },
  zdolnosc(v, out) {
    const r = capacity({ income: n(v.income), obligations: n(v.obligations) || 0, people: n(v.people), livingCost: n(v.living), dstiPct: n(v.dsti), ratePct: n(v.rate), months: n(v.years) * 12, bufferPct: n(v.buffer), ownContribution: n(v.own) || 0 });
    if (!r || !(n(v.years) > 0)) return "Uzupełnij dochód, oprocentowanie i okres.";
    if (r.maxPayment <= 0) { out({ range: "0 zł", payment: "0 zł", price: "—" }); return "Przy tych założeniach koszty i zobowiązania przewyższają dostępny dochód."; }
    out({ range: `${zl(r.low)} – ${zl(r.high)}`, payment: zl2(r.maxPayment), price: `${zl(r.priceLow)} – ${zl(r.priceHigh)}` });
  },
  refi(v, out) {
    const r = refinance({ balance: n(v.balance), currentRatePct: n(v.cur), newRatePct: n(v.next), months: n(v.months), costs: n(v.costs) || 0, currentPayment: v.pay ? n(v.pay) : undefined });
    if (!r) return "Uzupełnij kapitał, okres i oba oprocentowania.";
    out({ monthly: (r.monthly >= 0 ? "−" : "+") + zl2(Math.abs(r.monthly)), current: zl2(r.current), next: zl2(r.next), total: zl(r.totalDiff), costs: zl(r.costs),
      payback: r.payback ? `${r.payback} mies.` : "brak zwrotu", net: (r.net >= 0 ? "+" : "−") + zl(Math.abs(r.net)),
      verdict: r.worth ? "Przy tych założeniach zmiana może się opłacić. Realne oferty i koszty sprawdzi specjalista." : "Przy tych założeniach zmiana się nie opłaca — koszty nie zwracają się w okresie kredytu." });
  },
};

for (const box of document.querySelectorAll("[data-calc]")) {
  const kind = box.dataset.calc, form = box.querySelector("form");
  const set = (k, html) => { const el = box.querySelector(`[data-out="${k}"]`); if (el) el[k === "years" ? "innerHTML" : "textContent"] = html; };
  let started = false, done = false;
  const run = () => {
    const values = Object.fromEntries(new FormData(form));
    set("error", "");
    const err = calcs[kind](values, (o) => Object.entries(o).forEach(([k, v]) => set(k, v)));
    if (err) set("error", err);
    else if (started && !done) { done = true; track("calculator_complete", { calculator: kind }); }
  };
  form.addEventListener("input", () => { if (!started) { started = true; track("calculator_start", { calculator: kind }); } run(); });
  form.addEventListener("submit", (e) => e.preventDefault());
  run();
}
