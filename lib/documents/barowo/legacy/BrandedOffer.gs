// Self-contained vector PDF and editable Word: no external renderer or font substitution.
const BAROWO_OFFER_STYLE = {
  navy: "050134",
  red: "FF241C",
  white: "FFFFFF",
  muted: "BBB7D2",
  panel: "211B56",
};
const BAROWO_OFFER_SOURCE = [
  ["clientName", "Klient"],
  ["eventDate", "Data"],
  ["venue", "Miejsce"],
  ["guests", "Goście"],
  ["hours", "Godziny"],
  ["packageName", "Pakiet"],
  ["price", "Cena"],
  ["listPrice", "Cena przed rabatem"],
  ["service", "Obsługa"],
  ["alcohol", "Alkohole"],
  ["softs", "Softy"],
  ["ice", "Lód"],
  ["additions", "Dodatki"],
  ["menu", "Menu"],
  ["message", "Tekst do klienta"],
  ["contact", "Kontakt"],
];

function brandedOfferSource_(source, snapshot, number) {
  const doc = DocumentApp.openById(source.getId());
  try {
    if (doc.getHeader()) doc.getHeader().clear();
    if (doc.getFooter()) doc.getFooter().clear();
    const body = doc.getBody();
    body.clear();
    body
      .appendParagraph("BAROWO — oferta " + number)
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(
      "Zmieniaj wartości w prawej kolumnie. Nazwy pól zachowaj. Potem użyj przycisku nowego PDF + Word w bocie. Poprzednie pliki pozostaną zapisane.",
    );
    const rows = BAROWO_OFFER_SOURCE.map(function (field) {
      let v = snapshot[field[0]];
      if (field[0] === "menu")
        v = snapshot.menu
          .map(function (d) {
            return d.join(" | ");
          })
          .join("\n");
      if (field[0] === "price" || field[0] === "listPrice") v = formatDocumentMoney_(v);
      return [field[1], String(v || "")];
    });
    body.appendTable(rows);
    body.editAsText().setFontFamily("Arial").setFontSize(11).setForegroundColor("#050134");
  } finally {
    doc.saveAndClose();
  }
}

function readBrandedOfferSource_(doc, original) {
  const tables = doc.getBody().getTables();
  if (tables.length !== 1 || tables[0].getNumRows() !== BAROWO_OFFER_SOURCE.length)
    throw new Error("Zachowaj tabelę i nazwy pól w źródle oferty.");
  const values = {};
  BAROWO_OFFER_SOURCE.forEach(function (field, index) {
    const row = tables[0].getRow(index);
    if (row.getNumCells() !== 2 || row.getCell(0).getText().trim() !== field[1])
      throw new Error("Zmieniono nazwę pola źródłowego: " + field[1]);
    values[field[0]] = row.getCell(1).getText().trim();
  });
  const key = Object.keys(BAROWO_OFFER_CATALOG).find(function (k) {
    return BAROWO_OFFER_CATALOG[k].name.toLowerCase() === values.packageName.toLowerCase();
  });
  if (!key) throw new Error("Pakiet: Simple, Standard lub Premium.");
  if (!values.clientName || values.clientName.length > 180 || values.contact.length > 300)
    throw new Error("Sprawdź dane klienta i kontakt.");
  const lead = new Array(37).fill("");
  lead[COL.NAME - 1] = values.clientName;
  lead[COL.DATE - 1] = values.eventDate;
  const snapshot = offerSnapshot_(
    lead,
    key,
    Object.assign({}, values, { listPrice: values.listPrice || values.price, menu: values.menu }),
  );
  snapshot.brandLayoutVersion = 1;
  snapshot.contact = values.contact;
  return snapshot;
}

function offerTextWidth_(text, size, role, fonts) {
  return Array.from(String(text)).reduce(function (sum, c) {
    return sum + (fonts[offerFontRole_(fonts, role, c)][c][0] * size) / 1000;
  }, 0);
}

function offerWrap_(value, size, role, width, fonts) {
  const out = [];
  String(value)
    .replace(/\r/g, "")
    .split("\n")
    .forEach(function (raw) {
      let line = "";
      raw
        .split(/\s+/)
        .filter(Boolean)
        .forEach(function (word) {
          if (offerTextWidth_(word, size, role, fonts) > width) {
            if (line) {
              out.push(line);
              line = "";
            }
            Array.from(word).forEach(function (c) {
              if (offerTextWidth_(line + c, size, role, fonts) > width) {
                out.push(line);
                line = "";
              }
              line += c;
            });
          } else if (line && offerTextWidth_(line + " " + word, size, role, fonts) > width) {
            out.push(line);
            line = word;
          } else line += (line ? " " : "") + word;
        });
      out.push(line);
    });
  return out;
}

// Keep the catalogue's order; balance complete menu rows between pages.
function offerMenuPages_(menu, fonts) {
  const capacity = 610,
    rows = menu.map(function (d, i) {
      const names = offerWrap_(d[0], 18, "body", 158, fonts),
        recipes = offerWrap_(d[1], 14.5, "regular", 274, fonts);
      return {
        number: i + 1,
        name: names,
        recipe: recipes,
        height: Math.max(names.length * 21.96, recipes.length * 17.69) + 18,
      };
    });
  const prefix = [0];
  rows.forEach(function (r) {
    prefix.push(prefix[prefix.length - 1] + r.height);
  });
  const total = prefix[rows.length];
  for (let count = Math.max(1, Math.ceil(total / capacity)); count <= rows.length; count++) {
    const dp = Array.from({ length: count + 1 }, function () {
      return new Array(rows.length + 1).fill(Infinity);
    });
    const prev = Array.from({ length: count + 1 }, function () {
      return new Array(rows.length + 1).fill(-1);
    });
    dp[0][0] = 0;
    for (let k = 1; k <= count; k++)
      for (let end = k; end <= rows.length; end++)
        for (let start = k - 1; start < end; start++) {
          const h = prefix[end] - prefix[start];
          if (h > capacity || !isFinite(dp[k - 1][start])) continue;
          const cost = dp[k - 1][start] + Math.pow(h - total / count, 2);
          if (cost < dp[k][end]) {
            dp[k][end] = cost;
            prev[k][end] = start;
          }
        }
    if (isFinite(dp[count][rows.length])) {
      const pages = [];
      let end = rows.length;
      for (let k = count; k; k--) {
        const start = prev[k][end],
          group = rows.slice(start, end),
          extra = (capacity - (prefix[end] - prefix[start])) / group.length;
        pages.unshift(
          group.map(function (r) {
            return Object.assign({}, r, { height: r.height + extra });
          }),
        );
        end = start;
      }
      return pages;
    }
  }
  throw new Error("Menu nie mieści się w układzie oferty.");
}

// Shared physical page plan for both PDF and editable Word.
function offerPagePlan_(s, fonts) {
  const client = offerWrap_(s.clientName, 21, "body", 507, fonts),
    venue = offerWrap_("Miejsce: " + s.venue, 14.5, "regular", 507, fonts),
    hours = offerWrap_("Czas obsługi: " + s.hours, 13.5, "regular", 507, fonts);
  const clientHeight = 13.42 + 5 + client.length * 25.62;
  const metaY = 88 + clientHeight + 14,
    venueY = metaY + 69,
    hoursY = venueY + venue.length * 17.69 + 4;
  const start = hoursY + hours.length * 16.47 + 18;
  const sections = [
    ["Obsługa", s.service, true],
    ["Alkohole", s.alcohol, false],
    ["Napoje", s.softs, true],
    ["Lód", s.ice, false],
    ["Dodatki", s.additions, false],
  ].map(function (pair) {
    const value = pair[2] ? pair[1] : offerScopeParagraph_(pair[1]);
    const lines = offerWrap_(value, 14.5, "regular", 355, fonts);
    return { label: pair[0], lines: lines, height: Math.max(lines.length * 17.69, 17.08) };
  });
  const message = s.message ? offerWrap_(s.message, 14, "regular", 507, fonts) : [];
  const total = sections.reduce(function (sum, r) {
      return sum + r.height;
    }, 0),
    messageHeight = message.length ? message.length * 17.08 + 18 : 0;
  const gap = (640 - start - total - messageHeight) / sections.length;
  const pages = [],
    first = {
      kind: "conditions",
      client: client,
      clientHeight: clientHeight,
      metaY: metaY,
      venueY: venueY,
      venue: venue,
      hoursY: hoursY,
      hours: hours,
      sections: [],
      start: start,
    };
  pages.push(first);
  let page = first,
    y = start;
  sections.forEach(function (r) {
    const h = r.height + Math.max(16, gap);
    if (y + h > 677) {
      page = { kind: "continuation", start: 141, sections: [] };
      pages.push(page);
      y = 141;
    }
    page.sections.push(Object.assign({}, r, { y: y, height: h }));
    y += h;
  });
  if (message.length) {
    if (y + messageHeight > 677) {
      page = { kind: "continuation", start: 141, sections: [] };
      pages.push(page);
      y = 141;
    }
    page.message = { lines: message, y: y, height: messageHeight };
    y += messageHeight;
  }
  if (y > 680) {
    page = { kind: "continuation", start: 141, sections: [] };
    pages.push(page);
    y = 141;
  }
  page.priceY = pages.length === 1 ? Math.max(y + 10, 666) : Math.max(y + 12, 610);
  offerMenuPages_(s.menu, fonts).forEach(function (rows, index) {
    pages.push({
      kind: "menu",
      menu: rows,
      menuPage: index + 1,
      menuCount: s.menu.length,
      start: 152,
    });
  });
  return pages;
}

function offerLayout_(s, number, fonts) {
  const plan = offerPagePlan_(s, fonts),
    C = BAROWO_OFFER_STYLE;
  const pages = plan.map(function (p, index) {
    const items = [];
    function rect(x, y, w, h, color) {
      items.push({ type: "rect", x: x, y: y, w: w, h: h, color: color });
    }
    function lines(values, x, top, size, role, color) {
      values.forEach(function (line, i) {
        items.push({
          type: "text",
          text: line,
          x: x,
          y: top + size * 0.86 + i * size * 1.22,
          size: size,
          role: role,
          color: color || C.white,
        });
      });
    }
    function text(value, x, top, size, role, color, width) {
      lines(offerWrap_(value, size, role, width || 507, fonts), x, top, size, role, color);
    }
    rect(0, 0, 595.28, 841.89, C.navy);
    items.push({ type: "logo", x: 44, y: 23, w: 78, h: 29.77 });
    const subtitle = "PERSONALNA",
      reference = "  •  " + number,
      subtitleX = 551 - offerTextWidth_(subtitle + reference, 11, "regular", fonts);
    text(
      "OFERTA",
      551 - offerTextWidth_("OFERTA", 18, "display", fonts),
      24,
      18,
      "display",
      C.white,
      131,
    );
    lines([subtitle], subtitleX, 51, 11, "regular", C.red);
    lines(
      [reference],
      subtitleX + offerTextWidth_(subtitle, 11, "regular", fonts),
      51,
      11,
      "regular",
      C.muted,
    );
    if (p.kind === "conditions") {
      text("Oferta dla", 44, 88, 11, "regular", C.muted);
      lines(p.client, 44, 106.42, 21, "body", C.white);
      rect(44, p.metaY, 507, 58, C.panel);
      [
        ["Data", s.eventDate],
        ["Goście", s.guests + " osób"],
        ["Pakiet", s.packageName],
      ].forEach(function (pair, col) {
        const x = 58 + col * 166;
        text(pair[0], x, p.metaY + 8, 11, "body", C.muted, 145);
        text(pair[1], x, p.metaY + 30, 19, "body", C.white, 145);
      });
      lines(p.venue, 44, p.venueY, 14.5, "regular", C.white);
      lines(p.hours, 44, p.hoursY, 13.5, "regular", C.muted);
    } else if (p.kind === "continuation")
      text("SZCZEGÓŁY OFERTY", 44, 93, 21, "body", C.white, 507);
    if (p.sections)
      p.sections.forEach(function (r) {
        text(r.label, 44, r.y, 14, "body", C.red, 126);
        lines(r.lines, 188, r.y, 14.5, "regular", C.white);
        rect(44, r.y + r.height - 8, 507, 0.5, C.panel);
      });
    if (p.message) lines(p.message.lines, 44, p.message.y + 4, 14, "regular", C.muted);
    if (p.priceY !== undefined) {
      rect(44, p.priceY, 507, 80, C.panel);
      text("CENA CAŁKOWITA", 60, p.priceY + 12, 13, "body", C.red, 238);
      text("Za zakres opisany w ofercie", 60, p.priceY + 36, 13, "regular", C.muted, 238);
      if (s.discount)
        text(
          "Przed rabatem " +
            formatDocumentMoney_(s.listPrice) +
            " zł / Rabat " +
            formatDocumentMoney_(s.discount) +
            " zł",
          60,
          p.priceY + 58,
          11,
          "regular",
          C.muted,
          475,
        );
      const money = offerMoneyLabel_(s.price),
        size = Math.min(29, 180 / offerTextWidth_(money, 1, "body", fonts)),
        width = offerTextWidth_(money, size, "body", fonts);
      text(money, 535 - width, p.priceY + 22, size, "body", C.white, 180);
    }
    if (p.kind === "menu") {
      text("MENU KOKTAJLI", 44, 92, 22, "display", C.white);
      text(
        "Pakiet " +
          s.packageName +
          " / Pozycje " +
          p.menu[0].number +
          "–" +
          p.menu[p.menu.length - 1].number +
          " z " +
          s.menu.length,
        44,
        124,
        12,
        "regular",
        C.muted,
      );
      let y = p.start;
      p.menu.forEach(function (r) {
        const nameY = y + (r.height - r.name.length * 21.96) / 2,
          recipeY = y + (r.height - r.recipe.length * 17.69) / 2;
        text(
          String(r.number).padStart(2, "0"),
          44,
          y + (r.height - 13.42) / 2,
          11,
          "regular",
          C.muted,
          24,
        );
        lines(r.name, 83, nameY, 18, "body", C.red);
        lines(r.recipe, 277, recipeY, 14.5, "regular", C.white);
        rect(44, y + r.height - 2, 507, 0.5, C.panel);
        y += r.height;
      });
    }
    const contact = String(s.contact || "barowo.pl@gmail.com / +48 889 168 003")
      .replace(/\s+/g, " ")
      .trim();
    let size = 11;
    while (offerWrap_(contact, size, "regular", 440, fonts).length > 2 && size > 7) size--;
    rect(44, 792, 507, 0.5, C.panel);
    text(contact, 44, 801, size, "regular", C.muted, 440);
    text(index + 1 + " / " + plan.length, 518, 801, 11, "regular", C.muted, 33);
    return { items: items, title: p.kind === "menu" ? "MENU KOKTAJLI" : "OFERTA", plan: p };
  });
  return pages;
}

function offerMoneyLabel_(amount) {
  return (
    (Number(amount) % 1 === 0
      ? formatDocumentMoney_(amount).replace(/,00$/, "")
      : formatDocumentMoney_(amount)) + " zł"
  );
}

function offerScopeParagraph_(value) {
  return String(value)
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .join(" • ");
}

function offerFontRole_(fonts, role, c) {
  if (fonts[role][c]) return role;
  if (fonts.regular[c]) return "regular";
  if (fonts.body[c]) return "body";
  throw new Error("Znak nieobsługiwany przez font oferty: " + c);
}

function brandedOfferPdf_(snapshot, number, filename) {
  const fonts = barowoBrandFonts_();
  return barowoVectorPdf_(offerLayout_(snapshot, number, fonts), filename, fonts);
}

// Shared vector writer; guest menus use their own layout, offers keep theirs.
function barowoVectorPdf_(pages, filename, fonts) {
  const objects = [null];
  function add(s) {
    objects.push(s);
    return objects.length - 1;
  }
  function stream(s) {
    return add("<< /Length " + s.length + " >>\nstream\n" + s + "\nendstream");
  }
  function rgb(hex) {
    return [0, 2, 4]
      .map(function (i) {
        return (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4);
      })
      .join(" ");
  }
  const catalog = add(""),
    pageTree = add(""),
    fontEntries = {},
    fontResources = [];
  const used = { display: {}, label: {}, body: {}, regular: {} };
  pages.forEach(function (p) {
    p.items.forEach(function (item) {
      if (item.type === "text")
        Array.from(item.text).forEach(function (c) {
          const role = offerFontRole_(fonts, item.role, c);
          used[role][c] = true;
        });
    });
  });
  Object.keys(used).forEach(function (role) {
    const chars = Object.keys(used[role]);
    for (let offset = 0; offset < chars.length; offset += 250) {
      const subset = chars.slice(offset, offset + 250),
        name = "F" + (fontResources.length + 1),
        procs = [],
        widths = [],
        encoding = [],
        mapping = [];
      subset.forEach(function (c, i) {
        const code = i + 1,
          g = fonts[role][c];
        const id = stream(g[0] + " 0 -500 -500 2000 1500 d1\n" + g[1]);
        procs.push("/g" + code + " " + id + " 0 R");
        widths.push(g[0]);
        encoding.push("/g" + code);
        mapping.push(
          "<" +
            code.toString(16).padStart(2, "0") +
            "> <" +
            c.charCodeAt(0).toString(16).padStart(4, "0") +
            ">",
        );
        fontEntries[role + ":" + c] = { name: name, code: code };
      });
      let cmap =
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /BAROWO def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n";
      for (let i = 0; i < mapping.length; i += 100) {
        const chunk = mapping.slice(i, i + 100);
        cmap += chunk.length + " beginbfchar\n" + chunk.join("\n") + "\nendbfchar\n";
      }
      cmap += "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
      const cmapId = stream(cmap);
      const id = add(
        "<< /Type /Font /Subtype /Type3 /Name /" +
          name +
          " /FontBBox [-500 -500 2000 1500] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << " +
          procs.join(" ") +
          " >> /Encoding << /Type /Encoding /Differences [1 " +
          encoding.join(" ") +
          "] >> /FirstChar 1 /LastChar " +
          subset.length +
          " /Widths [" +
          widths.join(" ") +
          "] /Resources << >> /ToUnicode " +
          cmapId +
          " 0 R >>",
      );
      fontResources.push("/" + name + " " + id + " 0 R");
    }
  });
  const logo = barowoBrandLogo_();
  const logoId = add(
    "<< /Type /XObject /Subtype /Image /Width " +
      logo.width +
      " /Height " +
      logo.height +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length " +
      (logo.hex.length + 1) +
      " >>\nstream\n" +
      logo.hex +
      ">\nendstream",
  );
  const pageIds = [];
  pages.forEach(function (p) {
    let content = "";
    p.items.forEach(function (item) {
      if (item.type === "logo") {
        content +=
          "q " +
          item.w +
          " 0 0 " +
          item.h +
          " " +
          item.x +
          " " +
          (841.89 - item.y - item.h) +
          " cm /Logo Do Q\n";
        return;
      }
      if (item.type === "rect") {
        content +=
          "q " +
          rgb(item.color) +
          " rg " +
          item.x +
          " " +
          (841.89 - item.y - item.h) +
          " " +
          item.w +
          " " +
          item.h +
          " re f Q\n";
        return;
      }
      let x = item.x;
      content += "q\n";
      Array.from(item.text).forEach(function (c) {
        const role = offerFontRole_(fonts, item.role, c),
          g = fonts[role][c],
          f = fontEntries[role + ":" + c];
        content +=
          rgb(item.color) +
          " rg BT /" +
          f.name +
          " " +
          item.size +
          " Tf 1 0 0 1 " +
          x.toFixed(3) +
          " " +
          (841.89 - item.y).toFixed(3) +
          " Tm <" +
          f.code.toString(16).padStart(2, "0") +
          "> Tj ET\n";
        x += (g[0] * item.size) / 1000;
      });
      content += "Q\n";
    });
    const contentId = stream(content);
    pageIds.push(
      add(
        "<< /Type /Page /Parent " +
          pageTree +
          " 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Logo " +
          logoId +
          " 0 R >> /Font << " +
          fontResources.join(" ") +
          " >> >> /Contents " +
          contentId +
          " 0 R >>",
      ),
    );
  });
  objects[catalog] = "<< /Type /Catalog /Pages " + pageTree + " 0 R >>";
  objects[pageTree] =
    "<< /Type /Pages /Count " +
    pageIds.length +
    " /Kids [" +
    pageIds
      .map(function (id) {
        return id + " 0 R";
      })
      .join(" ") +
    "] >>";
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  objects.slice(1).forEach(function (s, i) {
    offsets.push(pdf.length);
    pdf += i + 1 + " 0 obj\n" + s + "\nendobj\n";
  });
  const xref = pdf.length;
  pdf +=
    "xref\n0 " +
    objects.length +
    "\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map(function (o) {
        return String(o).padStart(10, "0") + " 00000 n \n";
      })
      .join("");
  pdf +=
    "trailer\n<< /Size " +
    objects.length +
    " /Root " +
    catalog +
    " 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF\n";
  return Utilities.newBlob(pdf, "application/pdf", filename);
}

function brandedOfferDocx_(s, number, filename) {
  const C = BAROWO_OFFER_STYLE,
    fonts = barowoBrandFonts_(),
    plan = offerPagePlan_(s, fonts);
  function xml(v) {
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function run(text, size, role, color) {
    const family = {
      display: "Lozung Caps",
      label: "Rimma_sans",
      body: "Kenyan Coffee",
      regular: "Kenyan Coffee",
    }[role || "regular"];
    return (
      '<w:r><w:rPr><w:rFonts w:ascii="' +
      family +
      '" w:hAnsi="' +
      family +
      '" w:cs="' +
      family +
      '"/>' +
      (role === "body" || role === "label" ? "<w:b/>" : "") +
      '<w:noProof/><w:lang w:val="pl-PL"/><w:color w:val="' +
      (color || C.white) +
      '"/><w:sz w:val="' +
      Math.round(size * 2) +
      '"/></w:rPr>' +
      String(text)
        .split("\n")
        .map(function (line) {
          return '<w:t xml:space="preserve">' + xml(line) + "</w:t>";
        })
        .join("<w:br/>") +
      "</w:r>"
    );
  }
  function p(text, size, role, color, after, extra) {
    return (
      '<w:p><w:pPr><w:spacing w:before="0" w:after="' +
      Math.round((after || 0) * 20) +
      '" w:line="' +
      Math.round(size * 1.22 * 20) +
      '" w:lineRule="exact"/>' +
      (extra || "") +
      "</w:pPr>" +
      run(Array.isArray(text) ? text.join("\n") : text, size, role, color) +
      "</w:p>"
    );
  }
  function space(h, extra) {
    return (
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="' +
      Math.max(1, Math.round(h * 20)) +
      '" w:lineRule="exact"/>' +
      (extra || "") +
      "</w:pPr></w:p>"
    );
  }
  function cell(content, width, opts) {
    const o = opts || {};
    return (
      '<w:tc><w:tcPr><w:tcW w:w="' +
      width +
      '" w:type="dxa"/>' +
      (o.fill ? '<w:shd w:fill="' + o.fill + '"/>' : "") +
      (o.center ? '<w:vAlign w:val="center"/>' : "") +
      '<w:tcMar><w:top w:w="' +
      (o.pad || 0) +
      '" w:type="dxa"/><w:left w:w="' +
      (o.left || 0) +
      '" w:type="dxa"/><w:bottom w:w="' +
      (o.pad || 0) +
      '" w:type="dxa"/><w:right w:w="' +
      (o.right || 0) +
      '" w:type="dxa"/></w:tcMar></w:tcPr>' +
      content +
      "</w:tc>"
    );
  }
  function row(cells, height) {
    return (
      "<w:tr><w:trPr><w:cantSplit/>" +
      (height ? '<w:trHeight w:val="' + Math.round(height * 20) + '" w:hRule="atLeast"/>' : "") +
      "</w:trPr>" +
      cells +
      "</w:tr>"
    );
  }
  function table(widths, rows, borders) {
    return (
      '<w:tbl><w:tblPr><w:tblW w:w="10140" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:bottom w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="' +
      (borders ? 'single" w:sz="4" w:color="' + C.panel : "nil") +
      '"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>' +
      widths
        .map(function (w) {
          return '<w:gridCol w:w="' + w + '"/>';
        })
        .join("") +
      "</w:tblGrid>" +
      rows +
      "</w:tbl>"
    );
  }
  const right = '<w:jc w:val="right"/>';
  // Anchored in the body so Word does not wash out the page colour during editing.
  function background(i) {
    return (
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="7560056" cy="10692003"/><wp:wrapNone/><wp:docPr id="' +
      (1000 + i) +
      '" name="BAROWO_bg_' +
      i +
      '"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7560056" cy="10692003"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="050134"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
    );
  }
  let body = "",
    imageId = 0;
  plan.forEach(function (page, i) {
    if (i) body += space(0.1, "<w:pageBreakBefore/>");
    body += background(i + 1) + offerLogo() + offerHeader() + space(24.45);
    let cursor = 88;
    if (page.kind === "conditions") {
      body += p("Oferta dla", 11, "regular", C.muted, 5) + p(page.client, 21, "body", C.white, 14);
      const meta = [
        ["Data", s.eventDate],
        ["Goście", s.guests + " osób"],
        ["Pakiet", s.packageName],
      ];
      // Word adds top/bottom cell margins to the row's minimum content height.
      body += table(
        [3380, 3380, 3380],
        row(
          meta
            .map(function (pair) {
              return cell(
                p(pair[0], 11, "body", C.muted, 7) + p(pair[1], 19, "body", C.white),
                3380,
                { fill: C.panel, pad: 120, left: 280, right: 100, center: true },
              );
            })
            .join(""),
          46,
        ),
      );
      body +=
        space(11) +
        p(page.venue, 14.5, "regular", C.white, 4) +
        p(page.hours, 13.5, "regular", C.muted, 18);
      cursor = page.start;
    } else if (page.kind === "continuation") {
      body += space(4) + p("SZCZEGÓŁY OFERTY", 21, "body", C.white, 23.38);
      cursor = 141;
    } else {
      body +=
        space(4) +
        p("MENU KOKTAJLI", 22, "display", C.white, 5.16) +
        p(
          "Pakiet " +
            s.packageName +
            " / Pozycje " +
            page.menu[0].number +
            "–" +
            page.menu[page.menu.length - 1].number +
            " z " +
            s.menu.length,
          12,
          "regular",
          C.muted,
          13.36,
        );
      cursor = 152;
    }
    if (page.sections && page.sections.length) {
      body += table(
        [2880, 7260],
        page.sections
          .map(function (r, j) {
            return row(
              cell(p(r.label, 14, "body", C.red), 2880, { right: 360 }) +
                cell(p(r.lines, 14.5, "regular", C.white), 7260, { right: 160 }),
              r.height - (j < page.sections.length - 1 ? 0.5 : 0),
            );
          })
          .join(""),
        true,
      );
      const last = page.sections[page.sections.length - 1];
      cursor = last.y + last.height;
    }
    if (page.message) {
      body += p(page.message.lines, 14, "regular", C.muted, 18);
      cursor = page.message.y + page.message.height;
    }
    if (page.priceY !== undefined) {
      body += space(Math.max(1, page.priceY - cursor));
      const left =
        p("CENA CAŁKOWITA", 13, "body", C.red, 8) +
        p("Za zakres opisany w ofercie", 13, "regular", C.muted, 6) +
        (s.discount
          ? p(
              "Przed rabatem " +
                formatDocumentMoney_(s.listPrice) +
                " zł / Rabat " +
                formatDocumentMoney_(s.discount) +
                " zł",
              11,
              "regular",
              C.muted,
            )
          : "");
      body += table(
        [5910, 4230],
        row(
          cell(left, 5910, { fill: C.panel, pad: 200, left: 320 }) +
            cell(p(offerMoneyLabel_(s.price), 29, "body", C.white, 0, right), 4230, {
              fill: C.panel,
              pad: 200,
              right: 320,
              center: true,
            }),
          60,
        ),
      );
      cursor = page.priceY + 80;
    }
    if (page.menu) {
      body += table(
        [780, 3880, 5480],
        page.menu
          .map(function (r, j) {
            return row(
              cell(p(String(r.number).padStart(2, "0"), 11, "regular", C.muted), 780, {
                center: true,
              }) +
                cell(p(r.name, 18, "body", C.red), 3880, { right: 720, center: true }) +
                cell(p(r.recipe, 14.5, "regular", C.white), 5480, { center: true }),
              r.height - (j < page.menu.length - 1 ? 0.5 : 0),
            );
          })
          .join(""),
        true,
      );
      cursor = 762;
    }
    // Leave room for Word's table layout rounding and its mandatory end paragraph.
    body += space(Math.max(1, 775 - cursor)) + offerFooter(i + 1);
  });
  body +=
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="460" w:right="880" w:bottom="400" w:left="880" w:header="0" w:footer="0"/></w:sectPr>';
  const namespaces =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  function offerLogo() {
    return (
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="10000" behindDoc="0" locked="1" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>558800</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>292100</wp:posOffset></wp:positionV><wp:extent cx="990600" cy="378079"/><wp:wrapNone/><wp:docPr id="' +
      ++imageId +
      '" name="BAROWO" descr="Logo BAROWO"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' +
      imageId +
      '" name="BAROWO"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="logo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="990600" cy="378079"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
    );
  }
  function offerHeader() {
    const subtitle =
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="268" w:lineRule="exact"/>' +
      right +
      "</w:pPr>" +
      run("PERSONALNA", 11, "regular", C.red) +
      run("  •  " + number, 11, "regular", C.muted) +
      "</w:p>";
    return table(
      [6200, 3940],
      row(
        cell(space(30), 6200) +
          cell(p("OFERTA", 18, "display", C.white, 5, right) + subtitle, 3940),
      ),
    );
  }
  function offerFooter(i) {
    let size = 11;
    const contact = String(s.contact || "barowo.pl@gmail.com / +48 889 168 003")
      .replace(/\s+/g, " ")
      .trim();
    while (offerWrap_(contact, size, "regular", 440, fonts).length > 2 && size > 7) size--;
    return table(
      [9000, 1140],
      row(
        cell(p(contact, size, "regular", C.muted), 9000) +
          cell(p(i + " / " + plan.length, 11, "regular", C.muted, 0, right), 1140),
      ),
    );
  }
  const entries = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="logo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
    "word/document.xml":
      "<w:document " +
      namespaces +
      '><w:background w:color="050134"/><w:body>' +
      body +
      "</w:body></w:document>",
    "word/settings.xml":
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:displayBackgroundShape/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  };
  const blobs = Object.keys(entries).map(function (name) {
    return Utilities.newBlob(entries[name], "application/xml", name);
  });
  blobs.push(
    Utilities.newBlob(
      Utilities.base64Decode(barowoBrandLogo_().png),
      "image/png",
      "word/media/logo.png",
    ),
  );
  return Utilities.zip(blobs, filename).setContentType(BAROWO_DOCX_MIME);
}
