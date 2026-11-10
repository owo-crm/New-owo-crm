// Catalogue transcribed from the BAROWO offer sheets supplied on 2026-10-18 (Simple/Standard/Premium/Dodatki).
// A client's individual agreement never becomes a global package default.
const BAROWO_OFFER_CATALOG = Object.freeze({
  simple: {
    name: "Simple",
    service:
      "Mobilny bar MODERN\nSzkło: long, short, kieliszek do wina\n1 barman\nMenu na tablecie",
    alcohol: "Wódka, rum, prosecco",
    softs:
      "Soki: pomarańczowy, jabłkowy, żurawinowy\nCoca-Cola, Sprite, tonic\nWoda gazowana i niegazowana",
    ice: "Do indywidualnego uzgodnienia",
    additions:
      "Serwetki, rurki, ozdoby\nPomarańcze, limonki, mięta\nSyrop brzoskwiniowy, sok z cytryny",
    menu: [
      ["Wódka + soft", "Sok pomarańczowy, żurawinowy, jabłkowy, cola, tonic, Sprite"],
      ["Wódka Sour", "Wódka, syrop cukrowy, sok z cytryny, angostura"],
      ["Sex on the Beach", "Sok pomarańczowy, syrop brzoskwiniowy, wódka, sok żurawinowy"],
      ["Cuba Libre", "Rum, limonka, cola"],
      ["Hugo", "Prosecco, syrop z czarnego bzu, woda gazowana, limonka, mięta"],
      ["Old Cuban", "Rum, prosecco, angostura, mięta, sok z cytryny"],
      ["Daiquiri", "Rum, sok z cytryny, syrop cukrowy"],
    ],
  },
  standard: {
    name: "Standard",
    service:
      "Mobilny bar MODERN lub BOHO\nSzkło: long, short, kieliszek do wina, koktajlówka\n2 barmanów\nMenu na tablecie",
    alcohol: "Wódka Pan Tadeusz\nRum Bacardi\nWhisky Ballantine's\nAperol, prosecco",
    softs:
      "Soki: pomarańczowy, jabłkowy, żurawinowy\nCoca-Cola, Sprite, tonic\nWoda gazowana i niegazowana",
    ice: "Do indywidualnego uzgodnienia",
    additions:
      "Serwetki, rurki, ozdoby\nPomarańcze, limonki, mięta, suszone owoce\nSyrop brzoskwiniowy, sok z cytryny, syrop z czarnego bzu, syrop Aperol, purée z marakui",
    menu: [
      ["Whisky Sour", "Whisky, syrop cukrowy, sok z cytryny, angostura"],
      ["Hugo", "Prosecco, syrop z czarnego bzu, woda gazowana, limonka, mięta"],
      ["Aperol Spritz", "Aperol, prosecco, woda gazowana, pomarańcza"],
      ["Cuba Libre", "Rum, Coca-Cola, sok z limonki, limonka"],
      ["Pornstar Martini", "Wódka waniliowa, purée z marakui, sok z cytryny, prosecco"],
      ["Mojito", "Rum, limonka, cukier brązowy, mięta, woda gazowana"],
      ["Daiquiri", "Rum, sok z cytryny, syrop cukrowy"],
      ["Old Cuban", "Rum, sok z cytryny, syrop cukrowy, angostura, mięta, prosecco"],
      ["Mojito 0%", "Limonka, mięta, cukier trzcinowy, Sprite"],
      ["Aperol 0%", "Syrop Aperol, sok pomarańczowy, woda gazowana, pomarańcza"],
      ["Passion Love 0%", "Purée z marakui, sok z cytryny, woda gazowana"],
    ],
  },
  premium: {
    name: "Premium",
    service:
      "Mobilny bar MODERN lub BOHO\nSzkło: long, short, kieliszek do wina, koktajlówka\n2 barmanów\nMenu na tablecie",
    alcohol:
      "Wódka Ostoya\nRum Havana\nWhisky Jameson\nGin Bombay\nAperol, prosecco, Cointreau, Campari, wermut",
    softs:
      "Soki: pomarańczowy, jabłkowy, żurawinowy\nCoca-Cola, Sprite, tonic\nWoda gazowana i niegazowana\nProsecco 0%",
    ice: "Do indywidualnego uzgodnienia",
    additions:
      "Welcome drink\nWieża z kieliszków\nSerwetki, rurki, ozdoby\nPomarańcze, limonki, mięta, suszone owoce, kwiaty jadalne, wata cukrowa, imbir, rozmaryn, jagody, owoce liofilizowane\nSyrop brzoskwiniowy, sok z cytryny, syrop z czarnego bzu, syrop Aperol, purée z marakui, jagodowe, malinowe, truskawkowo-bazyliowe, syrop różany, miodowy, rozmarynowy",
    menu: [
      ["Aperol Spritz", "Aperol, prosecco, woda gazowana, pomarańcza"],
      ["Hugo", "Syrop z bzu, prosecco, woda gazowana, limonka, mięta"],
      ["Pornstar Martini", "Wódka waniliowa, purée z marakui, sok z cytryny, prosecco"],
      ["Whisky Sour", "Whisky, syrop cukrowy, sok z cytryny, angostura"],
      ["Tom Collins", "Gin, syrop cukrowy, sok z cytryny, rozmaryn"],
      ["Cuba Libre", "Rum, limonka, cola"],
      ["Blueberry Mojito", "Rum, limonka, mięta, purée jagodowe, cukier brązowy, woda gazowana"],
      ["Malinowe Daiquiri", "Rum, purée malinowe, sok z cytryny"],
      ["Basil WOW", "Wódka, purée basil-strawberry, sok z cytryny, woda gazowana"],
      ["Aperol Sour", "Gin, Aperol, sok z cytryny, syrop cukrowy, angostura"],
      ["Rosemary Boom", "Gin, syrop rozmarynowy, sok z cytryny, tonic"],
      ["Cosmopolitan", "Wódka, Cointreau, sok z limonki, sok żurawinowy"],
      ["Negroni", "Gin, Campari, wermut"],
      ["Americano", "Campari, wermut, woda gazowana"],
      [
        "Barbie Life",
        "Gin infuzowany płatkami róż, sok żurawinowy, sok z cytryny, syrop różany, woda gazowana",
      ],
      ["Sex on the Beach 0%", "Sok pomarańczowy, syrop brzoskwiniowy, sok żurawinowy, pomarańcza"],
      ["Rosemary 0%", "Sok z cytryny, syrop różany, tonic, rozmaryn"],
      ["Barbie Life 0%", "Sok z cytryny, purée malinowe, Sprite, woda gazowana, wata cukrowa"],
      ["Mojito 0%", "Limonka, mięta, cukier trzcinowy, Sprite"],
      ["Aperol 0%", "Syrop Aperol, sok pomarańczowy, woda gazowana, pomarańcza"],
      ["Passion Love 0%", "Purée z marakui, sok z cytryny, woda gazowana"],
    ],
  },
});

// Package prices from the 2026-10-18 offer sheets: price for up to N guests.
// Above the last tier the price is agreed individually (the field stays empty).
const BAROWO_OFFER_PRICE_TIERS = Object.freeze({
  simple: [
    [30, 3300],
    [60, 4500],
  ],
  standard: [
    [50, 4600],
    [100, 6900],
  ],
  premium: [
    [50, 6250],
    [100, 9150],
  ],
});

function suggestedOfferPrice_(pkgKey, guests) {
  const tiers = BAROWO_OFFER_PRICE_TIERS[pkgKey];
  const count = Number(String(guests || "").trim());
  if (!tiers || !/^\d+$/.test(String(guests || "").trim()) || count < 1) return "";
  for (let i = 0; i < tiers.length; i++) if (count <= tiers[i][0]) return tiers[i][1];
  return "";
}

function defaultOfferValues_(pkgKey) {
  const pkg = BAROWO_OFFER_CATALOG[pkgKey];
  if (!pkg) throw new Error("Nieznany pakiet.");
  return {
    service: pkg.service,
    alcohol: pkg.alcohol,
    softs: pkg.softs,
    ice: pkg.ice,
    additions: pkg.additions,
    menu: pkg.menu
      .map(function (drink) {
        return drink[0] + " | " + drink[1];
      })
      .join("\n"),
    message: "",
  };
}

function parseOfferSections_(input, values) {
  const keys = {
    OBSLUGA: "service",
    ALKOHOLE: "alcohol",
    SOFTY: "softs",
    LOD: "ice",
    DODATKI: "additions",
  };
  const result = Object.assign({}, values);
  let current = "";
  const sections = {};
  input.split(/\r?\n/).forEach(function (line) {
    const match = line.match(/^\s*(OBS[LŁ]UGA|ALKOHOLE|SOFTY|L[OÓ]D|DODATKI)\s*:\s*(.*)$/i);
    if (match) {
      current = keys[match[1].toUpperCase().replace("Ł", "L").replace("Ó", "O")];
      sections[current] = [match[2]];
    } else if (current) sections[current].push(line);
    else if (line.trim())
      throw new Error("Użyj nagłówków OBSLUGA:, ALKOHOLE:, SOFTY:, LOD:, DODATKI:.");
  });
  if (!Object.keys(sections).length) throw new Error("Podaj przynajmniej jedną sekcję.");
  Object.keys(sections).forEach(function (key) {
    const value = sections[key].join("\n").trim();
    if (!value || value.length > 700) throw new Error("Sekcja musi mieć od 1 do 700 znaków.");
    result[key] = value;
  });
  return result;
}

function parseOfferMenu_(input) {
  const lines = String(input || "")
    .split(/\r?\n/)
    .filter(function (line) {
      return line.trim();
    });
  if (!lines.length || lines.length > 30)
    throw new Error("Podaj od 1 do 30 koktajli: nazwa | składniki, każdy w nowej linii.");
  return lines.map(function (line) {
    const split = line.indexOf("|");
    if (split < 1) throw new Error("Format menu: nazwa | składniki.");
    const name = line.slice(0, split).trim();
    const ingredients = line.slice(split + 1).trim();
    if (!ingredients || name.length > 80 || ingredients.length > 220)
      throw new Error("Nazwa do 80 znaków, składniki od 1 do 220 znaków.");
    return [name, ingredients];
  });
}

function offerSnapshot_(lead, pkgKey, values) {
  const pkg = BAROWO_OFFER_CATALOG[pkgKey];
  if (!pkg) throw new Error("Nieznany pakiet.");
  const price = parseDocumentMoney_(values.price);
  const listPrice = parseDocumentMoney_(values.listPrice);
  if (price > listPrice)
    throw new Error("Cena końcowa nie może przekraczać ceny przed rabatem. Popraw cenę bazową.");
  const snapshot = {
    clientName: getLeadContractClientName_(lead),
    eventDate: formatDate(parseDocumentDate_(lead[COL.DATE - 1])),
    eventType: String(lead[COL.EVENT - 1] || ""),
    city: String(lead[COL.CITY - 1] || ""),
    venue: String(values.venue || "").trim(),
    guests: parseDocumentGuests_(values.guests),
    hours: String(values.hours || "").trim(),
    packageName: pkg.name,
    price: price,
    listPrice: listPrice,
    discount: Math.round((listPrice - price) * 100) / 100,
    menu: parseOfferMenu_(values.menu),
    message: String(values.message || "").trim(),
  };
  ["service", "alcohol", "softs", "ice", "additions"].forEach(function (key) {
    snapshot[key] = String(values[key] || "").trim();
    if (!snapshot[key] || snapshot[key].length > 700)
      throw new Error("Sprawdź sekcję " + key + ".");
  });
  if (
    !snapshot.clientName ||
    !snapshot.venue ||
    snapshot.venue.length > 220 ||
    !snapshot.hours ||
    snapshot.hours.length > 80 ||
    snapshot.message.length > 500
  ) {
    throw new Error("Sprawdź klienta, miejsce, czas obsługi i tekst do klienta.");
  }
  return snapshot;
}
