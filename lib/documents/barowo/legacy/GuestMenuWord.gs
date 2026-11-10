// Editable Word text, using the same page plan, colours and supplied fonts as PDF.
function guestMenuDocx_(snapshot, filename) {
  const plan = guestMenuLayout_(snapshot, barowoBrandFonts_()),
    logo = barowoBrandLogo_();
  const families = { display: "Lozung Caps", label: "Rimma_sans", body: "Kenyan Coffee" };
  function xml(v) {
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function emu(v) {
    return Math.round(v * 12700);
  }
  function metrics(item) {
    const line =
      item.lineHeight ||
      (item.role === "display"
        ? item.size * 1.1
        : item.role === "label"
          ? item.size * 1.2
          : item.size === 24
            ? 26
            : 22);
    const ascent = item.role === "display" ? 0.75 : item.role === "label" ? 1.07 : 0.996;
    const natural = item.role === "display" ? 1.1 : 1.2;
    // Exact-line Word layout adds font leading differently for these typefaces.
    // Calibrated against the PDF baselines after rendering with the actual fonts.
    const correction =
      item.role === "display"
        ? 8.55
        : item.role === "label"
          ? -3
          : item.size >= 24
            ? -1.7
            : item.size >= 18.5
              ? -0.7
              : 0;
    return {
      line: line,
      baseline: item.size * ascent + (line - item.size * natural) / 2 + correction,
    };
  }
  function paragraph(item, before, extra) {
    const m = metrics(item),
      family = families[item.role];
    return (
      '<w:p><w:pPr><w:widowControl w:val="0"/><w:jc w:val="center"/><w:spacing w:before="' +
      Math.round(before * 20) +
      '" w:after="0" w:line="' +
      Math.round(m.line * 20) +
      '" w:lineRule="exact"/>' +
      (extra || "") +
      '</w:pPr><w:r><w:rPr><w:rFonts w:ascii="' +
      family +
      '" w:hAnsi="' +
      family +
      '" w:cs="' +
      family +
      '"/>' +
      (item.role !== "display" ? "<w:b/>" : "") +
      '<w:color w:val="' +
      item.color +
      '"/><w:sz w:val="' +
      Math.round(item.size * 2) +
      '"/><w:szCs w:val="' +
      Math.round(item.size * 2) +
      '"/><w:lang w:val="pl-PL"/><w:noProof/></w:rPr><w:t xml:space="preserve">' +
      xml(item.text) +
      "</w:t></w:r></w:p>"
    );
  }
  function anchor(id, x, y, w, h, graphic, behind) {
    return (
      '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="' +
      (behind ? 0 : 10000) +
      '" behindDoc="' +
      (behind ? 1 : 0) +
      '" locked="1" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>' +
      emu(x) +
      '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>' +
      emu(y) +
      '</wp:posOffset></wp:positionV><wp:extent cx="' +
      emu(w) +
      '" cy="' +
      emu(h) +
      '"/><wp:wrapNone/><wp:docPr id="' +
      id +
      '" name="BAROWO_' +
      id +
      '"/><wp:cNvGraphicFramePr/>' +
      graphic +
      "</wp:anchor></w:drawing></w:r>"
    );
  }
  function shape(w, h, fill, text) {
    return (
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr' +
      (text ? ' txBox="1"' : "") +
      '/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' +
      emu(w) +
      '" cy="' +
      emu(h) +
      '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      (fill ? '<a:solidFill><a:srgbClr val="' + fill + '"/></a:solidFill>' : "<a:noFill/>") +
      "<a:ln><a:noFill/></a:ln></wps:spPr>" +
      (text ? "<wps:txbx><w:txbxContent>" + text + "</w:txbxContent></wps:txbx>" : "") +
      '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>'
    );
  }
  let body = "",
    id = 0;
  plan.forEach(function (page, pageIndex) {
    const text = page.items.filter(function (i) {
        return i.type === "text";
      }),
      mark = page.items.find(function (i) {
        return i.type === "logo";
      });
    let drawings = anchor(++id, 0, 0, 595.28, 841.89, shape(595.28, 841.89, "050134"), true);
    const pic =
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' +
      ++id +
      '" name="BAROWO" descr="Logo BAROWO"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="logo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' +
      emu(mark.w) +
      '" cy="' +
      emu(mark.h) +
      '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
    drawings += anchor(++id, mark.x, mark.y, mark.w, mark.h, pic, false);
    // Position editable text boxes from the PDF plan. Word and LibreOffice use
    // different page-start spacing for body paragraphs; anchors avoid that drift.
    text.forEach(function (item) {
      const m = metrics(item),
        counter = item.y > 790;
      drawings += anchor(
        ++id,
        counter ? 520 : 40,
        item.y - m.baseline,
        counter ? 55 : 515.28,
        m.line + 4,
        shape(counter ? 55 : 515.28, m.line + 4, "", paragraph(item, 0)),
        false,
      );
    });
    body +=
      "<w:p><w:pPr>" +
      (pageIndex ? "<w:pageBreakBefore/>" : "") +
      '<w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr>' +
      drawings +
      "</w:p>";
  });
  body +=
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="0" w:right="800" w:bottom="600" w:left="800" w:header="0" w:footer="0"/></w:sectPr>';
  const ns =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const entries = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="logo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
    "word/document.xml":
      "<w:document " +
      ns +
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
    Utilities.newBlob(Utilities.base64Decode(logo.png), "image/png", "word/media/logo.png"),
  );
  return Utilities.zip(blobs, filename).setContentType(BAROWO_DOCX_MIME);
}
