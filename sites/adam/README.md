# Strona Adama — agent nieruchomości (Trójmiasto)

Samodzielna, statyczna strona (bez zależności npm i bez związku z kodem OWO CRM).
Prototyp `public/adam/index.html` w CRM zostaje jako wzór wizualny (noindex) — nie jest częścią tej strony.

## Uruchomienie lokalne
```bash
cd sites/adam
node build.mjs && node server.mjs   # http://localhost:4300
```

## Zmienne przy budowaniu
| Zmienna | Znaczenie |
|---|---|
| `SITE_ENV` | `production` → indeksowanie, sitemap, robots Allow. Inne → noindex wszędzie + pasek „wersja testowa” + dane testowe w katalogu. |
| `SITE_URL` | Docelowa domena, np. `https://adam-nieruchomosci.pl` (canonical, OG, sitemap). |
| `CRM_URL` | Adres OWO CRM, np. `https://<crm>.up.railway.app`. |
| `INTAKE_KEY` | Publiczny klucz kanału „Strona WWW” w CRM Adama. Na produkcji bez niego build kończy się błędem. |

## Wdrożenie (Railway, osobny serwis)
1. Nowy serwis z tego repozytorium, **Root Directory: `sites/adam`**.
2. Build: `node build.mjs`, Start: `node server.mjs` (port z `PORT`).
3. Zmienne jak wyżej; domena własna w ustawieniach serwisu.
4. W CRM (Ustawienia → Źródła → kanał „Strona WWW” Adama) dopisać domenę strony do dozwolonych adresów.
Staging = ten sam serwis bez `SITE_ENV=production` (noindex).

## Gdzie co zmieniać
- `src/config.mjs` — dane Adama, fakty (z flagą `confirmed`), banki, **oferty**, **opinie**.
- `src/pages.mjs` — treść stron; `src/layout.mjs` — nagłówek, stopka, formularz, FAQ, blok Expander.
- `src/calc.mjs` — wzory kalkulatorów (testy: `tests/unit/adam-calc.test.ts`).
- `src/fixtures.mjs` — dane testowe katalogu, tylko poza produkcją.

## Zasady (z TZ)
Bez wymyślonych ofert, opinii, liczb i partnerstw. Pusty katalog = noindex. Oferty `reserved/sold/hidden` nie są w katalogu.
Kalkulatory liczą w przeglądarce i nic nie wysyłają; formularz wysyła tylko kontakt + temat + źródło/UTM.
Zdarzenia (`dataLayer`): consultation_cta_click, phone_click, lead_form_start, lead_form_submit, property_card_click,
calculator_start, calculator_complete, calculator_consultation_click, refinance_topic_select. Bez ID narzędzi i pikseli.

## Następne etapy
Strony ofert z prawdziwymi danymi; kalkulatory: nadpłata, koszty zakupu, wkład własny, rentowność najmu;
poradnik (6 artykułów z TZ); strony lokalne tylko z oryginalną treścią; Search Console po uruchomieniu domeny.

## Podgląd w OWO CRM (owocrm.com/adam)
Zbudowana strona jest trzymana w `public/adam/` i podawana przez CRM pod `/adam` (rewrites w `next.config.ts`, ścieżka publiczna w `lib/auth/paths.ts`).
Po każdej zmianie w `sites/adam` odśwież kopię: `cd sites/adam && npm run build:crm` (z `INTAKE_KEY=<klucz kanału>`, żeby formularz wysyłał zgłoszenia do tego samego CRM). Wersja ma noindex.
