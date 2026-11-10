// A separate guest-facing menu in the supplied original BAROWO style.
const BAROWO_GUEST_MENU_FORM = [
  {
    key: "menu",
    label: "Menu",
    aliases: ["koktajle"],
    multiline: true,
    validate: function (v) {
      parseOfferMenu_(v);
    },
  },
];

function guestMenuSnapshot_(values, lead) {
  return {
    guestMenuVersion: 1,
    subtitle: "",
    menu: parseOfferMenu_(values.menu),
    clientName: String(lead[COL.NAME - 1] || ""),
    packageName: String(lead[COL.PACKAGE - 1] || ""),
    price: 0,
  };
}

function guestMenuFormText_(state, errors) {
  const intro =
    "🍸 <b>Menu dla gości — " +
    escapeHtml_(state.leadName) +
    "</b>" +
    formErrorsText_(errors) +
    "\nUkład jak w głównej ofercie: czerwone nazwy, biały skład, wyśrodkowana lista. PDF na tablet i Word do edycji, bez cen i danych klienta.\n" +
    "Popraw menu jedną wiadomością albo wyślij <b>ok</b>.\n";
  const full =
    intro + "<pre>" + escapeHtml_(formBlock_(BAROWO_GUEST_MENU_FORM, state.values)) + "</pre>";
  if (full.length <= 4000) return full;
  const names = String(state.values.menu || "")
    .split("\n")
    .filter(Boolean)
    .map(function (line) {
      return line.split("|")[0].trim();
    });
  return (
    intro +
    "Menu zachowane: " +
    escapeHtml_(names.join(", ")) +
    ".\nŻeby je zmienić, wyślij „Menu:” i listę „nazwa | składniki”. Możesz też poprawić źródło po wygenerowaniu PDF."
  );
}

function startGuestMenu_(chat, uid, cardMsgId, pkg) {
  const lead = requireDocumentLead_(uid).rowData;
  if (cardMsgId) refreshLeadCard_(chat, cardMsgId, uid, lead);
  const previous = latestCrmOfferSnapshot_(uid);
  const packageKey =
    pkg ||
    Object.keys(BAROWO_OFFER_CATALOG).find(function (k) {
      return (
        BAROWO_OFFER_CATALOG[k].name.toLowerCase() ===
        String(lead[COL.PACKAGE - 1] || "").toLowerCase()
      );
    });
  if (!pkg && !previous && !packageKey) {
    const kb = {
      inline_keyboard: Object.keys(BAROWO_OFFER_CATALOG).map(function (k) {
        return [{ text: BAROWO_OFFER_CATALOG[k].name, callback_data: "guestpkg_" + k + "_" + uid }];
      }),
    };
    send(
      chat,
      "🍸 <b>Menu dla gości</b>\nWybierz pakiet wyjściowy. Potem możesz zmienić wszystkie koktajle.",
      kb,
    );
    return;
  }
  const basis = !pkg && previous ? previous : BAROWO_OFFER_CATALOG[packageKey];
  if (!basis) throw new Error("Nieznany pakiet menu.");
  const state = {
    action: "guestmenu_form",
    uid: uid,
    leadName: String(lead[COL.NAME - 1] || ""),
    cardMsgId: cardMsgId,
    cardChat: chat,
    values: {
      subtitle: "",
      menu: basis.menu
        .map(function (d) {
          return d.join(" | ");
        })
        .join("\n"),
    },
  };
  assertWizardSize_(state);
  askInput_(chat, state, guestMenuFormText_(state, []));
}

function handleGuestMenuInput_(chat, state, input) {
  if (!/^guestmenu_/.test(state.action || "")) return false;
  const result = applyFormReply_(BAROWO_GUEST_MENU_FORM, state.values, input);
  const prior = state.values;
  state.values = result.values;
  const errors = result.errors.slice();
  let snapshot;
  if (!errors.length)
    try {
      snapshot = guestMenuSnapshot_(state.values, requireDocumentLead_(state.uid).rowData);
      assertWizardSize_(state);
    } catch (error) {
      errors.push(error.message);
    }
  if (errors.length) {
    state.action = "guestmenu_form";
    delete state.nonce;
    try {
      assertWizardSize_(state);
    } catch (error) {
      state.values = prior;
    }
    askInput_(chat, state, guestMenuFormText_(state, errors));
    return true;
  }
  state.action = "guestmenu_confirm";
  state.nonce = Utilities.getUuid().slice(0, 8);
  askInput_(
    chat,
    state,
    "🍸 <b>Sprawdź menu na tablet</b>\n" +
      snapshot.menu.length +
      " koktajli: " +
      escapeHtml_(
        snapshot.menu
          .map(function (d) {
            return d[0];
          })
          .join(", "),
      ) +
      "\n\nSkład możesz poprawić, wysyłając pole „Menu” ponownie. Dłuższe menu dostanie kolejne strony.",
    {
      inline_keyboard: [
        [{ text: "✅ Generuj menu PDF + Word", callback_data: "guestconfirm_" + state.nonce }],
        [{ text: "✖️ Anuluj", callback_data: "cancel" }],
      ],
    },
  );
  return true;
}

function handleGuestMenuCallback_(chat, msgId, data) {
  if (data.startsWith("guestmenu_")) {
    startGuestMenu_(chat, data.slice(10), msgId);
    return true;
  }
  if (data.startsWith("guestpkg_")) {
    const parts = data.split("_");
    startGuestMenu_(chat, parts.slice(2).join("_"), null, parts[1]);
    deleteMsg(chat, msgId);
    return true;
  }
  if (data.startsWith("guestconfirm_")) {
    const nonce = data.slice(13);
    const state = withLock(function () {
      const s = getState(chat);
      if (!s || s.action !== "guestmenu_confirm" || s.nonce !== nonce || s.promptId != msgId)
        throw new Error("To potwierdzenie wygasło albo należy do innej osoby.");
      clearState(chat);
      return s;
    });
    toast_("🍸 Generuję menu…");
    generateGuestMenu_(chat, state, msgId);
    return true;
  }
  return false;
}

function writeGuestMenuSource_(source, snapshot, number) {
  const doc = DocumentApp.openById(source.getId());
  try {
    const body = doc.getBody();
    body.clear();
    body.appendParagraph("BAROWO — menu " + number);
    body.appendParagraph(
      "Edytuj prawą kolumnę. W bocie wybierz nowy PDF + Word; poprzednie wersje pozostają w Dokumentach.",
    );
    body.appendTable([
      [
        "Menu",
        snapshot.menu
          .map(function (d) {
            return d.join(" | ");
          })
          .join("\n"),
      ],
    ]);
  } finally {
    doc.saveAndClose();
  }
}

function readGuestMenuSource_(doc, original) {
  const tables = doc.getBody().getTables();
  if (tables.length !== 1 || ![1, 2].includes(tables[0].getNumRows()))
    throw new Error("Zachowaj tabelę źródła menu.");
  // Older menu sources had a subtitle row. Read their recipes, without printing that row.
  const menuIndex = tables[0].getNumRows() - 1,
    row = tables[0].getRow(menuIndex);
  if (row.getNumCells() !== 2 || row.getCell(0).getText().trim() !== "Menu")
    throw new Error("Zachowaj nazwę pola: Menu");
  const values = { menu: row.getCell(1).getText().trim() };
  const lead = new Array(37).fill("");
  lead[COL.NAME - 1] = original.clientName;
  lead[COL.PACKAGE - 1] = original.packageName;
  return guestMenuSnapshot_(values, lead);
}

function generateGuestMenu_(chat, state, waitId) {
  let record, source;
  try {
    const lead = requireDocumentLead_(state.uid).rowData,
      snapshot = guestMenuSnapshot_(state.values, lead),
      number = nextDocumentNumber_("menu");
    const doc = DocumentApp.create(documentBaseName_("menu", state.uid, number));
    doc.saveAndClose();
    source = DriveApp.getFileById(doc.getId());
    record = createCrmDocumentRecord_(state.uid, "menu", number, source, snapshot);
    moveCrmDocument_(source);
    writeGuestMenuSource_(source, snapshot, number);
    const files = saveCrmDocumentExports_(record);
    deliverCrmDocument_(
      chat,
      record,
      files,
      "🍸 Menu dla gości · " +
        escapeHtml_(number) +
        "\nPDF na tablet i Word do edycji. Zapisane w Dokumentach klienta.",
    );
    appendLeadHistoryByUid_(state.uid, "🍸 menu dla gości " + number);
    if (state.cardMsgId) refreshLeadCard_(state.cardChat || chat, state.cardMsgId, state.uid);
  } catch (error) {
    documentErrorMessage_(chat, record, source, error);
  } finally {
    deleteMsg(chat, waitId);
  }
}

function guestMenuLayout_(snapshot, fonts) {
  const C = BAROWO_OFFER_STYLE,
    width = 595.28,
    capacity = 638,
    shortMenu = snapshot.menu.length <= 7;
  const nameSize = shortMenu ? 30 : 24,
    recipeSize = shortMenu ? 22 : 18.5,
    nameStep = shortMenu ? 31 : 26,
    recipeStep = shortMenu ? 24 : 22,
    blockGap = shortMenu ? 6 : 8;
  const rows = snapshot.menu.map(function (d, index) {
    const names = offerWrap_(d[0], nameSize, "body", 470, fonts),
      recipes = offerWrap_(d[1], recipeSize, "body", 440, fonts);
    const gapBefore =
      index > 0 && /0\s*%/.test(d[0]) && !/0\s*%/.test(snapshot.menu[index - 1][0]) ? 18 : 0;
    return {
      names: names,
      recipes: recipes,
      gapBefore: gapBefore,
      height: names.length * nameStep + recipes.length * recipeStep + blockGap + gapBefore,
    };
  });
  // Balanced consecutive pages; never shrink type to squeeze a long menu.
  const prefix = [0];
  rows.forEach(function (r) {
    prefix.push(prefix[prefix.length - 1] + r.height);
  });
  let groups;
  for (
    let count = Math.max(1, Math.ceil(prefix[rows.length] / capacity));
    count <= rows.length;
    count++
  ) {
    const dp = Array.from({ length: count + 1 }, function () {
        return new Array(rows.length + 1).fill(Infinity);
      }),
      prev = dp.map(function (a) {
        return a.map(function () {
          return -1;
        });
      });
    dp[0][0] = 0;
    for (let k = 1; k <= count; k++)
      for (let end = k; end <= rows.length; end++)
        for (let start = k - 1; start < end; start++) {
          const h = prefix[end] - prefix[start];
          if (h > capacity || !isFinite(dp[k - 1][start])) continue;
          const cost = dp[k - 1][start] + Math.pow(h - prefix[rows.length] / count, 2);
          if (cost < dp[k][end]) {
            dp[k][end] = cost;
            prev[k][end] = start;
          }
        }
    if (isFinite(dp[count][rows.length])) {
      groups = [];
      let end = rows.length;
      for (let k = count; k; k--) {
        const start = prev[k][end];
        groups.unshift(rows.slice(start, end));
        end = start;
      }
      break;
    }
  }
  if (!groups) throw new Error("Koktajl nie mieści się na stronie. Skróć nazwę lub skład.");
  return groups.map(function (group, pageIndex) {
    const items = [{ type: "rect", x: 0, y: 0, w: width, h: 841.89, color: C.navy }];
    function center(text, y, size, role, color, lineHeight) {
      items.push({
        type: "text",
        text: text,
        x: (width - offerTextWidth_(text, size, role, fonts)) / 2,
        y: y,
        size: size,
        role: role,
        color: color,
        lineHeight: lineHeight,
      });
    }
    center("MENU", 61, 66, "display", C.white);
    const total = group.reduce(function (h, r) {
        return h + r.height;
      }, 0),
      gap = Math.min(shortMenu ? 17 : 23, (capacity - total) / group.length);
    let y = 130 + (capacity - total - gap * group.length) / 2;
    group.forEach(function (r) {
      y += r.gapBefore;
      r.names.forEach(function (line) {
        center(line, y, nameSize, "body", C.red, nameStep);
        y += nameStep;
      });
      r.recipes.forEach(function (line) {
        center(line, y, recipeSize, "body", C.white, recipeStep);
        y += recipeStep;
      });
      y += blockGap + gap;
    });
    const logo = barowoBrandLogo_();
    items.push({
      type: "logo",
      x: (width - 90) / 2,
      y: 797,
      w: 90,
      h: (90 * logo.height) / logo.width,
    });
    if (groups.length > 1)
      items.push({
        type: "text",
        text: pageIndex + 1 + " / " + groups.length,
        x: 537,
        y: 818,
        size: 14,
        role: "body",
        color: C.red,
      });
    return { items: items };
  });
}

function guestMenuPdf_(snapshot, filename) {
  const fonts = barowoBrandFonts_();
  return barowoVectorPdf_(guestMenuLayout_(snapshot, fonts), filename, fonts);
}
