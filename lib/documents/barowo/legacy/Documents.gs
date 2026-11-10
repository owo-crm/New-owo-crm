// Versioned, editable CRM documents. No automatic client email delivery.
const BAROWO_DOCUMENT_SCHEMA = Object.freeze({
  name: "Documents",
  headers: [
    "document_id",
    "legacy_uid",
    "kind",
    "number",
    "created_at",
    "created_by",
    "client_name",
    "package_name",
    "price",
    "status",
    "source_url",
    "pdf_url",
    "docx_url",
    "gmail_draft_id",
    "snapshot_json",
    "error",
  ],
});
const BAROWO_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Run once from the editor as the account that executes the production deployment.
// Check Drive access before changing the sheet; do not reset webhooks or triggers.
function prepareBarowoDocumentUpgrade() {
  const config = getBarowoConfig_();
  [config.umowaTemplateId, config.personalOfferTemplateId].forEach(function (id) {
    if (DriveApp.getFileById(id).getMimeType() !== "application/vnd.google-apps.document") {
      throw new Error("Szablon musi być dokumentem Google Docs: " + id);
    }
  });
  const folder = DriveApp.getFolderById(config.documentsFolderId);
  const leads = sheetLidy();
  if (!leads) throw new Error("Brak arkusza Lidy. Sprawdź BAROWO_SPREADSHEET_ID.");
  withLock(function () {
    ensureSheetHeaders_(leads, LEGACY_CRM_SHEET_SCHEMAS.lidy.headers);
    const spam = sheetSpam();
    if (spam) ensureSheetHeaders_(spam, LEGACY_CRM_SHEET_SCHEMAS.spam.headers);
    getOrCreateSheet_(BAROWO_DOCUMENT_SCHEMA);
  });
  return {
    documentsSheet: BAROWO_DOCUMENT_SCHEMA.name,
    documentsFolder: folder.getUrl(),
    contractTemplate: config.umowaTemplateId,
    personalOfferTemplate: config.personalOfferTemplateId,
  };
}

function assertWizardSize_(state) {
  const bytes = encodeURIComponent(JSON.stringify(state)).replace(/%[0-9A-F]{2}/gi, "_").length;
  if (bytes > 8000)
    throw new Error(
      "Oferta jest zbyt długa. Skróć tekst lub dopisz szczegóły później w edytowalnym źródle.",
    );
}

function persistDocumentWizard_(chat, state) {
  assertWizardSize_(state);
  setState(chat, state);
}

function sendCrmLongText_(chat, raw) {
  let chunk = "";
  Array.from(String(raw)).forEach(function (character) {
    if (escapeHtml_(chunk + character).length > 3200) {
      send(chat, escapeHtml_(chunk));
      chunk = "";
    }
    chunk += character;
  });
  if (chunk) send(chat, escapeHtml_(chunk));
}

function parseDocumentMoney_(input) {
  const value = String(input || "")
    .trim()
    .replace(/(?:\s*zł|\s*PLN)$/i, "")
    .replace(/[\s\u00a0]/g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value)) throw new Error("Podaj kwotę, np. 6500 lub 6500,50.");
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000)
    throw new Error("Kwota musi być większa od zera.");
  return Math.round(amount * 100) / 100;
}

function formatDocumentMoney_(amount) {
  return Number(amount)
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function parseDocumentGuests_(input) {
  const value = String(input || "").trim();
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000)
    throw new Error("Podaj liczbę gości od 1 do 10000.");
  return Number(value);
}

function parseDocumentHours_(input) {
  const value = String(input || "").trim();
  const match = value.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
  if (
    !match ||
    Number(match[1]) > 23 ||
    Number(match[3]) > 23 ||
    Number(match[2]) > 59 ||
    Number(match[4]) > 59
  ) {
    throw new Error("Podaj godziny, np. 18:00-02:00.");
  }
  const hours = match.slice(1).map(function (part) {
    return part.padStart(2, "0");
  });
  if (hours[0] === hours[2] && hours[1] === hours[3])
    throw new Error("Początek i koniec obsługi muszą się różnić.");
  return hours[0] + ":" + hours[1] + "-" + hours[2] + ":" + hours[3];
}

function parseDocumentDate_(input) {
  if (input instanceof Date) {
    if (isNaN(input.getTime())) throw new Error("Nieprawidłowa data wydarzenia.");
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  const value = String(input || "")
    .trim()
    .replace(/^'+/, "");
  const dots = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dots && !iso) throw new Error("Uzupełnij datę wydarzenia w CRM (DD.MM.YYYY).");
  const year = Number(dots ? dots[3] : iso[1]);
  const month = Number(dots ? dots[2] : iso[2]);
  const day = Number(dots ? dots[1] : iso[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    throw new Error("Nieprawidłowa data wydarzenia.");
  return date;
}

function requireDocumentLead_(uid) {
  const ref = getLeadRowDataByUid_(sheetLidy(), uid);
  if (!ref) throw new Error("Lead nie znaleziony. Odśwież kartę klienta.");
  if (
    [LEGACY_LEAD_STAGE.SPAM, LEGACY_LEAD_STAGE.DELETED].indexOf(
      inferLegacyLeadStage_(ref.rowData),
    ) >= 0
  ) {
    throw new Error("Przywróć leada przed generowaniem dokumentu.");
  }
  return ref;
}

function documentActor_() {
  return whoIsUser(BAROWO_STATE_ACTOR) || "CRM";
}

function documentBaseName_(kind, uid, number) {
  return (
    (kind === "contract" ? "Umowa" : kind === "menu" ? "Menu" : "Oferta") +
    "_" +
    CONFIG.BRAND.replace(/[^\w-]/g, "_") +
    "_" +
    uid.replace(/[^\w-]/g, "_") +
    "_" +
    number.replace(/[^\w-]/g, "_")
  );
}

function nextDocumentNumber_(kind) {
  return withLock(function () {
    const props = PropertiesService.getScriptProperties();
    // Keep the existing contract numbering sequence.
    const key =
      kind === "contract" ? "umowa_counter" : kind === "menu" ? "menu_counter" : "oferta_counter";
    const current = Number(props.getProperty(key) || "0");
    if (!Number.isSafeInteger(current) || current < 0)
      throw new Error("Nieprawidłowy licznik dokumentów.");
    props.setProperty(key, String(current + 1));
    return current + 1 + " / " + new Date().getFullYear();
  });
}

function moveCrmDocument_(file) {
  const folderId = getBarowoConfig_().documentsFolderId;
  if (folderId) file.moveTo(DriveApp.getFolderById(folderId));
  return file;
}

function documentContainers_(doc) {
  const containers = [];
  function visit(tabs) {
    tabs.forEach(function (tab) {
      const documentTab = tab.asDocumentTab();
      containers.push(documentTab.getBody());
      const header = documentTab.getHeader();
      const footer = documentTab.getFooter();
      if (header) containers.push(header);
      if (footer) containers.push(footer);
      visit(tab.getChildTabs());
    });
  }
  visit(doc.getTabs());
  return containers;
}

function fillCrmDocumentTemplate_(doc, values) {
  // Work in text runs, from the end, to preserve tables/styles and literal $ or backslashes.
  const containers = documentContainers_(doc);
  function fill(element) {
    if (element.getType() === DocumentApp.ElementType.TEXT) {
      const text = element.asText();
      const raw = text.getText();
      const matches = [];
      const regex = /\{\{([A-Z_]+)\}\}/g;
      let match;
      while ((match = regex.exec(raw)))
        matches.push({ start: match.index, end: match.index + match[0].length - 1, key: match[1] });
      matches.reverse().forEach(function (item) {
        if (!Object.prototype.hasOwnProperty.call(values, item.key))
          throw new Error("Brak wartości pola szablonu: " + item.key);
        const attributes = text.getAttributes(item.start);
        const replacement = String(values[item.key]);
        text.insertText(item.start, replacement);
        text.deleteText(item.start + replacement.length, item.end + replacement.length);
        if (replacement.length)
          text.setAttributes(item.start, item.start + replacement.length - 1, attributes);
      });
    } else if (typeof element.getNumChildren === "function") {
      for (let i = 0; i < element.getNumChildren(); i++) fill(element.getChild(i));
    }
  }
  containers.forEach(fill);
  containers.forEach(function (container) {
    if (/\{\{[^{}]+\}\}/.test(container.getText()))
      throw new Error("Szablon zawiera niewypełnione pola. Sprawdź dokument źródłowy.");
  });
}

function exportCrmDocument_(sourceId, mimeType, filename) {
  const url =
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(sourceId) +
    "/export?mimeType=" +
    encodeURIComponent(mimeType);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    if (status === 200) {
      const blob = response.getBlob();
      const bytes = blob.getBytes();
      const isPdf = mimeType === "application/pdf";
      const valid = isPdf
        ? bytes.length > 4 &&
          bytes[0] === 37 &&
          bytes[1] === 80 &&
          bytes[2] === 68 &&
          bytes[3] === 70
        : bytes.length > 2 && bytes[0] === 80 && bytes[1] === 75;
      if (!valid)
        throw new Error("Eksport zwrócił nieprawidłowy plik " + (isPdf ? "PDF" : "DOCX") + ".");
      return blob.setContentType(mimeType).setName(filename);
    }
    if ((status === 429 || status >= 500) && attempt < 2) {
      Utilities.sleep((attempt + 1) * 700);
      continue;
    }
    throw new Error(
      "Eksport dokumentu nie powiódł się (HTTP " + status + "). Źródło zapisano w CRM.",
    );
  }
}

function createCrmDocumentRecord_(uid, kind, number, source, snapshot) {
  const record = {
    document_id: Utilities.getUuid().replace(/-/g, ""),
    legacy_uid: uid,
    kind: kind,
    number: number,
    created_at: new Date().toISOString(),
    created_by: documentActor_(),
    client_name: snapshot.clientName,
    package_name: snapshot.packageName,
    price: snapshot.price,
    status: "source_saved",
    source_url: source.getUrl(),
    pdf_url: "",
    docx_url: "",
    gmail_draft_id: "",
    snapshot_json: JSON.stringify(snapshot),
    error: "",
  };
  withLock(function () {
    const safeRecord = {};
    Object.keys(record).forEach(function (key) {
      safeRecord[key] = crmDocumentCell_(record[key]);
    });
    appendRecordToSheet_(BAROWO_DOCUMENT_SCHEMA, safeRecord);
  });
  return record;
}

function updateCrmDocumentRecord_(id, changes) {
  return withLock(function () {
    const sheet = getOrCreateSheet_(BAROWO_DOCUMENT_SCHEMA);
    const row = findSchemaRowByField_(BAROWO_DOCUMENT_SCHEMA, "document_id", id);
    if (row < 2) throw new Error("Nie znaleziono dokumentu w CRM.");
    const values = sheet.getRange(row, 1, 1, BAROWO_DOCUMENT_SCHEMA.headers.length).getValues()[0];
    Object.keys(changes).forEach(function (key) {
      const index = BAROWO_DOCUMENT_SCHEMA.headers.indexOf(key);
      if (index < 0) throw new Error("Nieznane pole dokumentu: " + key);
      values[index] = crmDocumentCell_(changes[key]);
    });
    sheet.getRange(row, 1, 1, values.length).setValues([values]);
  });
}

function crmDocumentCell_(value) {
  return typeof value === "string" && /^[=+@-]/.test(value) ? "'" + value : value;
}

function recordCrmDocumentFailure_(id, error) {
  const current = getCrmDocumentRecord_(id);
  const changes = { error: error.message };
  if (!["generated", "draft_created", "export_failed"].includes(current.status))
    changes.status = "generation_failed";
  updateCrmDocumentRecord_(id, changes);
  return Object.assign({}, current, changes);
}

function getCrmDocumentRecord_(id) {
  const sheet = getOrCreateSheet_(BAROWO_DOCUMENT_SCHEMA);
  const row = findSchemaRowByField_(BAROWO_DOCUMENT_SCHEMA, "document_id", id);
  if (row < 2) throw new Error("Nie znaleziono dokumentu w CRM.");
  const values = sheet.getRange(row, 1, 1, BAROWO_DOCUMENT_SCHEMA.headers.length).getValues()[0];
  const record = {};
  BAROWO_DOCUMENT_SCHEMA.headers.forEach(function (key, index) {
    record[key] = values[index];
  });
  return record;
}

function saveCrmDocumentExports_(record) {
  const sourceId = String(record.source_url).match(/\/d\/([^/]+)/)[1];
  const revision = Utilities.getUuid().slice(0, 8);
  const base = documentBaseName_(record.kind, record.legacy_uid, record.number) + "_" + revision;
  const files = {};
  try {
    const snapshot = JSON.parse(record.snapshot_json);
    if (record.kind === "menu" && snapshot.guestMenuVersion === 1) {
      files.pdfBlob = guestMenuPdf_(snapshot, base + ".pdf");
      files.pdf = moveCrmDocument_(DriveApp.createFile(files.pdfBlob));
      updateCrmDocumentRecord_(record.document_id, {
        pdf_url: files.pdf.getUrl(),
        docx_url: "",
        status: "pdf_saved",
      });
      files.docxBlob = guestMenuDocx_(snapshot, base + ".docx");
      files.docx = moveCrmDocument_(DriveApp.createFile(files.docxBlob));
      updateCrmDocumentRecord_(record.document_id, {
        docx_url: files.docx.getUrl(),
        status: "generated",
        error: "",
      });
      return files;
    }
    const branded = record.kind === "offer" && snapshot.brandLayoutVersion === 1;
    files.pdfBlob = branded
      ? brandedOfferPdf_(snapshot, String(record.number), base + ".pdf")
      : exportCrmDocument_(sourceId, "application/pdf", base + ".pdf");
    files.pdf = moveCrmDocument_(DriveApp.createFile(files.pdfBlob));
    updateCrmDocumentRecord_(record.document_id, {
      pdf_url: files.pdf.getUrl(),
      docx_url: "",
      status: "pdf_saved",
    });
    files.docxBlob = branded
      ? brandedOfferDocx_(snapshot, String(record.number), base + ".docx")
      : exportCrmDocument_(sourceId, BAROWO_DOCX_MIME, base + ".docx");
    files.docx = moveCrmDocument_(DriveApp.createFile(files.docxBlob));
    updateCrmDocumentRecord_(record.document_id, {
      docx_url: files.docx.getUrl(),
      status: "generated",
      error: "",
    });
    return files;
  } catch (error) {
    updateCrmDocumentRecord_(record.document_id, { status: "export_failed", error: error.message });
    throw error;
  }
}

function documentLinksText_(record) {
  const links = [];
  if (record.source_url)
    links.push(
      '<a href="' + escapeHtml_(String(record.source_url)) + '">Edytuj źródło w Google Docs</a>',
    );
  if (record.pdf_url) links.push('<a href="' + escapeHtml_(String(record.pdf_url)) + '">PDF</a>');
  if (record.docx_url)
    links.push('<a href="' + escapeHtml_(String(record.docx_url)) + '">Word DOCX</a>');
  return links.join(" · ");
}

// Two messages only: PDF (with links and the re-export button) and the Word file.
function deliverCrmDocument_(chat, record, files, caption) {
  const latest = getCrmDocumentRecord_(record.document_id);
  const kb = {
    inline_keyboard: [
      [
        {
          text: "🔄 PDF + Word po edycji źródła",
          callback_data: "docexport_" + record.document_id,
        },
      ],
    ],
  };
  if (record.kind === "offer" && latest.pdf_url)
    kb.inline_keyboard.unshift([
      { text: "📧 Wyślij tę ofertę klientowi", callback_data: "offeremail_" + record.document_id },
    ]);
  let pdfCaption = caption + "\n" + documentLinksText_(latest);
  if (pdfCaption.length > 1000) pdfCaption = caption.slice(0, 1000);
  const pdfResult = sendDocument(chat, files.pdfBlob, pdfCaption, kb);
  const docxResult = files.docxBlob
    ? sendDocument(chat, files.docxBlob, "📝 Word (DOCX) — do edycji")
    : null;
  if (!pdfResult || !pdfResult.ok || (files.docxBlob && (!docxResult || !docxResult.ok))) {
    send(
      chat,
      "⚠️ Nie dostarczono wszystkich załączników. Pobierz pliki przez linki:\n" +
        documentLinksText_(latest),
      kb,
    );
  }
}

function showCrmDocuments_(chat, uid, page) {
  const lead = requireDocumentLead_(uid).rowData;
  const sheet = getOrCreateSheet_(BAROWO_DOCUMENT_SCHEMA);
  const rows =
    sheet.getLastRow() > 1
      ? sheet
          .getRange(2, 1, sheet.getLastRow() - 1, BAROWO_DOCUMENT_SCHEMA.headers.length)
          .getValues()
      : [];
  const allDocuments = rows
    .filter(function (row) {
      return String(row[1]) === uid;
    })
    .reverse();
  const pageIndex = Math.max(
    0,
    Math.min(Number(page) || 0, Math.max(0, Math.ceil(allDocuments.length / 5) - 1)),
  );
  const documents = allDocuments.slice(pageIndex * 5, pageIndex * 5 + 5);
  if (!documents.length) {
    toast_("Brak zapisanych dokumentów dla tego klienta.", true);
    return;
  }
  const lines = ["📂 <b>Dokumenty — " + escapeHtml_(String(lead[COL.NAME - 1] || "")) + "</b>"];
  const buttons = [];
  documents.forEach(function (row) {
    const record = {};
    BAROWO_DOCUMENT_SCHEMA.headers.forEach(function (key, index) {
      record[key] = row[index];
    });
    const title =
      (record.kind === "contract"
        ? "Umowa"
        : record.kind === "menu"
          ? "Menu dla gości"
          : "Oferta") +
      " " +
      String(record.number);
    lines.push(
      "",
      "<b>" +
        escapeHtml_(title) +
        "</b> · " +
        (record.kind === "menu" ? "" : formatDocumentMoney_(record.price) + " zł · ") +
        escapeHtml_(formatIsoShort_(record.created_at)) +
        "\n" +
        documentLinksText_(record),
    );
    if (record.kind === "offer" && record.pdf_url)
      buttons.push([
        { text: "📧 Wyślij " + title, callback_data: "offeremail_" + record.document_id },
      ]);
    if (record.source_url)
      buttons.push([
        {
          text: "🔄 " + title + " — nowy PDF + Word",
          callback_data: "docexport_" + record.document_id,
        },
      ]);
  });
  const navigation = [];
  if (pageIndex > 0)
    navigation.push({
      text: "◀️ Nowsze",
      callback_data: "docspage_" + (pageIndex - 1) + "_" + uid,
    });
  if ((pageIndex + 1) * 5 < allDocuments.length)
    navigation.push({
      text: "Starsze ▶️",
      callback_data: "docspage_" + (pageIndex + 1) + "_" + uid,
    });
  if (navigation.length) buttons.push(navigation);
  const id = send(chat, lines.join("\n"), {
    inline_keyboard: buttons.concat(closeKeyboard_().inline_keyboard),
  });
  if (id && !isDM(chat)) scheduleDelete(chat, id, CONFIG.TTL_LIST);
}

function reexportCrmDocument_(chat, id) {
  let record;
  try {
    record = getCrmDocumentRecord_(id);
    requireDocumentLead_(String(record.legacy_uid));
    const sourceId = String(record.source_url).match(/\/d\/([^/]+)/)[1];
    const source = DocumentApp.openById(sourceId);
    const original = JSON.parse(record.snapshot_json);
    const refreshed =
      record.kind === "menu" && original.guestMenuVersion === 1
        ? readGuestMenuSource_(source, original)
        : record.kind === "offer" && original.brandLayoutVersion === 1
          ? readBrandedOfferSource_(source, original)
          : original;
    const incomplete = documentContainers_(source).some(function (container) {
      return /\{\{[^{}]+\}\}/.test(container.getText());
    });
    source.saveAndClose();
    if (incomplete) throw new Error("Najpierw uzupełnij pola {{...}} w źródle dokumentu.");
    const snapshot = refreshed;
    snapshot.exportOf = id;
    record = createCrmDocumentRecord_(
      String(record.legacy_uid),
      record.kind,
      String(record.number),
      DriveApp.getFileById(sourceId),
      snapshot,
    );
    const files = saveCrmDocumentExports_(record);
    deliverCrmDocument_(
      chat,
      record,
      files,
      "📄 " +
        (record.kind === "contract"
          ? "Umowa"
          : record.kind === "menu"
            ? "Menu dla gości"
            : "Oferta") +
        " " +
        escapeHtml_(String(record.number)) +
        " — nowa wersja ze źródła." +
        (record.kind === "menu"
          ? ""
          : "\n<i>Edycja źródła nie zmienia ceny w CRM ani wcześniejszego szkicu Gmail.</i>"),
    );
    appendLeadHistoryByUid_(String(record.legacy_uid), "🔄 nowa wersja " + String(record.number));
  } catch (error) {
    send(
      chat,
      "❌ " +
        escapeHtml_(error.message) +
        (record ? "\n" + documentLinksText_(getCrmDocumentRecord_(record.document_id)) : ""),
      closeKeyboard_(),
    );
  }
}

function updateDocumentLeadStage_(uid, target) {
  return withLock(function () {
    const sh = sheetLidy();
    const ref = requireDocumentLead_(uid);
    const current = inferLegacyLeadStage_(ref.rowData);
    const keep =
      target === LEGACY_LEAD_STAGE.OFFER_DRAFT
        ? [
            LEGACY_LEAD_STAGE.SIGNED,
            LEGACY_LEAD_STAGE.CONTRACT_GENERATED,
            LEGACY_LEAD_STAGE.OFFER_SENT,
          ]
        : target === LEGACY_LEAD_STAGE.OFFER_SENT
          ? [LEGACY_LEAD_STAGE.SIGNED, LEGACY_LEAD_STAGE.CONTRACT_GENERATED]
          : [LEGACY_LEAD_STAGE.SIGNED];
    if (keep.indexOf(current) < 0) sh.getRange(ref.rowNumber, COL.LEAD_STATUS).setValue(target);
    if (target === LEGACY_LEAD_STAGE.OFFER_SENT)
      sh.getRange(ref.rowNumber, COL.OFERTA).setValue("YES");
    const lead = sh.getRange(ref.rowNumber, 1, 1, sh.getLastColumn()).getValues()[0];
    syncLegacyLeadToModernCrm_(lead);
    return lead;
  });
}
