// A minimal .xlsx writer: sheets of typed cells in, workbook bytes out.
//
// Hand-rolled rather than vendored — MUNIC-PRO ships no third-party
// libraries (see scripts/check-network.sh). An .xlsx is a zip of a few
// XML parts, and a zip whose entries are STORED (uncompressed) is just
// headers and a CRC-32 per file, so the whole format fits here.
//
// Cells are { v, tipo, situacao }: tipo 'texto' | 'numero' | 'pct' (a
// fraction, shown as 0.0%), v null for an empty cell, and situacao the
// bucket whose colour the cell takes — the panel's own colours, which are
// the 2025 workbook's.
(function () {
  'use strict';

  if (window.__municProXlsx) return;

  // --- zip (stored) -------------------------------------------------------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // files: [{ name, data: Uint8Array }] → one Uint8Array.
  function zipStored(files) {
    const enc = new TextEncoder();
    const partes = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const nome = enc.encode(f.name);
      const crc = crc32(f.data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034B50, true);
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint32(14, crc, true);
      local.setUint32(18, f.data.length, true);
      local.setUint32(22, f.data.length, true);
      local.setUint16(26, nome.length, true);
      partes.push(new Uint8Array(local.buffer), nome, f.data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014B50, true);
      cd.setUint16(4, 20, true); // version made by
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, f.data.length, true);
      cd.setUint32(24, f.data.length, true);
      cd.setUint16(28, nome.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nome);

      offset += 30 + nome.length + f.data.length;
    }

    const tamanhoCentral = central.reduce((n, p) => n + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054B50, true);
    fim.setUint16(8, files.length, true);
    fim.setUint16(10, files.length, true);
    fim.setUint32(12, tamanhoCentral, true);
    fim.setUint32(16, offset, true);

    const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
    const out = new Uint8Array(todas.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of todas) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // --- spreadsheet XML ----------------------------------------------------

  // XML 1.0 forbids most control characters outright; SIGC text should
  // never carry one, but one stray byte would make Excel refuse the file.
  function esc(s) {
    return String(s)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colLetra(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    }
    return s;
  }

  // Font colour / fill per bucket, as in situacao-report.js's STYLE.
  const CORES = [
    ['Não Iniciado', '9C0006', 'FFC7CE'],
    ['Digitação/Validação', '9C5700', 'FFEB9C'],
    ['Supervisão/Análise', '006100', 'C6EFCE'],
    ['Concluído', '0B77A0', 'CAEEFB'],
  ];

  // cellXfs indexes: 0 plain, 1 header, 2 percentage, then one per bucket.
  const XF_CABECALHO = 1;
  const XF_PCT = 2;
  const XF_SITUACAO = Object.fromEntries(CORES.map(([nome], i) => [nome, 3 + i]));

  function stylesXml() {
    const fontes = ['<font><sz val="11"/><name val="Calibri"/></font>',
      '<font><b/><sz val="11"/><name val="Calibri"/></font>',
      ...CORES.map(([, cor]) =>
        `<font><color rgb="FF${cor}"/><sz val="11"/><name val="Calibri"/></font>`)];
    const fills = ['<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>',
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F5"/></patternFill></fill>',
      ...CORES.map(([, , fundo]) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="FF${fundo}"/></patternFill></fill>`)];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
      ...CORES.map((_, i) =>
        `<xf numFmtId="0" fontId="${2 + i}" fillId="${3 + i}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`)];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
      `<fonts count="${fontes.length}">${fontes.join('')}</fonts>` +
      `<fills count="${fills.length}">${fills.join('')}</fills>` +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function celulaXml(ref, cel) {
    if (!cel || cel.v === null || cel.v === undefined) return '';
    const cor = cel.situacao ? XF_SITUACAO[cel.situacao] : undefined;
    if (cel.tipo === 'numero' || cel.tipo === 'pct') {
      const s = cel.tipo === 'pct' ? XF_PCT : cor;
      return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${Number(cel.v)}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"${cor ? ` s="${cor}"` : ''}>` +
      `<is><t xml:space="preserve">${esc(cel.v)}</t></is></c>`;
  }

  function sheetXml({ cabecalho, linhas }) {
    const larguras = cabecalho.map((h, i) => Math.min(60, Math.max(
      String(h).length,
      ...linhas.map((l) => String((l[i] && l[i].v) ?? '').length),
    ) + 2));
    const ultima = colLetra(Math.max(0, cabecalho.length - 1));
    const rows = [
      `<row r="1">${cabecalho.map((h, i) =>
        `<c r="${colLetra(i)}1" t="inlineStr" s="${XF_CABECALHO}">` +
        `<is><t xml:space="preserve">${esc(h)}</t></is></c>`).join('')}</row>`,
      ...linhas.map((l, j) => `<row r="${j + 2}">${
        l.map((cel, i) => celulaXml(`${colLetra(i)}${j + 2}`, cel)).join('')}</row>`),
    ];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      `<cols>${larguras.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
      `<sheetData>${rows.join('')}</sheetData>` +
      `<autoFilter ref="A1:${ultima}${linhas.length + 1}"/>` +
      '</worksheet>';
  }

  // Excel's sheet-name rules: at most 31 characters, none of []:*?/\ .
  function nomeAba(nome) {
    return String(nome).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Planilha';
  }

  // sheets: [{ nome, cabecalho: [string], linhas: [[cell]] }]
  function workbook(sheets) {
    const enc = new TextEncoder();
    const xml = (s) => enc.encode(s);
    const n = sheets.length;
    const idx = [...Array(n).keys()];
    const files = [
      { name: '[Content_Types].xml', data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        idx.map((i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
        '</Types>') },
      { name: '_rels/.rels', data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>') },
      { name: 'xl/workbook.xml', data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        idx.map((i) => `<sheet name="${esc(nomeAba(sheets[i].nome))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        // An autoFilter needs its hidden defined name, or Excel repairs the file.
        '<definedNames>' + idx.map((i) => {
          const ultima = colLetra(Math.max(0, sheets[i].cabecalho.length - 1));
          const nome = nomeAba(sheets[i].nome).replace(/'/g, "''");
          return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">` +
            `${esc(`'${nome}'!$A$1:$${ultima}$${sheets[i].linhas.length + 1}`)}</definedName>`;
        }).join('') + '</definedNames>' +
        '</workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        idx.map((i) => `<Relationship Id="rId${i + 1}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
          `Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${n + 1}" ` +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>') },
      { name: 'xl/styles.xml', data: xml(stylesXml()) },
      ...idx.map((i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml(sheetXml(sheets[i])) })),
    ];
    return zipStored(files);
  }

  window.__municProXlsx = { workbook, zipStored, crc32, colLetra, nomeAba, sheetXml };
})();
