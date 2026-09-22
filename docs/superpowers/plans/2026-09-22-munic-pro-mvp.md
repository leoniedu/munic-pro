# MUNIC-PRO MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that reads MUNIC 2026 collection status from the SIGC report page, keeps a dated history in IndexedDB, and shows it as a three-tab report — replacing an R package only its author can run.

**Architecture:** A MAIN-world content script on the SIGC MUNIC 2026 report page. One POST to `RelSituacaoMunicipioDados` returns an HTML table; it is parsed with `DOMParser`, validated, and written to IndexedDB as SCD type-2 (only changes stored). A panel renders three tabs from that store. Every run auto-downloads a JSON snapshot so history survives a cleared profile. No network except same-origin to SIGC.

**Tech Stack:** Vanilla JS (no build step), Chrome Manifest V3, IndexedDB, `bun test` + `happy-dom`.

**Spec:** `docs/superpowers/specs/2026-09-22-munic2026-design.md`

## Global Constraints

- **No absolute URLs anywhere in `extension/`** except `manifest.json`. `scripts/check-network.sh` fails the commit otherwise. All requests are relative, via `fetchViaGateway`.
- **`fetch()` only in** `extension/common/` and `extension/features/situacao-fetch/`.
- **Storage APIs only in** `extension/features/situacao-store/`. That directory must never call `fetch()`.
- **Banned everywhere:** `sendBeacon`, `WebSocket`, `EventSource`, `RTCPeerConnection`, `importScripts`, `new XMLHttpRequest`, `new Image`, `import()`, `eval()`, `new Function`.
- **MAIN world, no `chrome.*` APIs** in content scripts. IndexedDB and `Blob` downloads are page APIs and work there; `chrome.storage` does not and is banned anyway.
- **No build step.** Plain `.js` files loaded in `manifest.json` order.
- **IIFE + namespace pattern**, matching sigc-pro: each file is `(function () { 'use strict'; ... })()` and hangs its public surface on `window.__municPro*`.
- **Test-only internals** are exported as `window.__municPro<Feature>Internals`, mirroring `__sigcProUltimoMovimentoExportInternals`.
- **Portuguese for all user-facing strings**; English for code comments and commit messages.
- **Conventional commits**, subject under 72 chars.
- The pre-commit hook auto-bumps `manifest.json` version and rebuilds `dist/`. Never hand-edit the version.
- **Timestamps are local (America/Sao_Paulo)**, stored as ISO strings.
- **Primary key is `(municipio_codigo, questionario)`** — 2026 returns one row per município *per questionário*.

---

### Task 1: Shared helpers (`munic-common.js`)

Copied from sigc-pro, not imported — the two projects share no package.

**Files:**
- Create: `extension/common/munic-common.js`
- Test: `tests/munic-common.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `window.__municPro` with:
  - `normalizeLabel(s) -> string`
  - `f5Prefix(pathname) -> {prefix, hex} | null`
  - `gatewayUrl(origin, pathname, path, simple) -> string`
  - `fetchViaGateway(path, options) -> Promise<Response>`
  - `buildCsv(header, rows) -> string`
  - `downloadFile(filename, text, mimeType, opts) -> void`
  - `timestampSlug() -> {data, hora}`
  - `isoWeek(date) -> string` (e.g. `"2026-W38"`)
  - `mountWidget({id, anchor, insert, when, build}) -> void` — keeps a widget
    present next to a page element across SIGC's re-renders

- [ ] **Step 1: Write the failing test**

Create `tests/munic-common.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/munic-common.js');

const M = window.__municPro;

const F5_HEX = '68747470733a2f2f7733736967636d756e6963323032362e696267652e676f762e6272';
const F5_PATH = `/f5-w-${F5_HEX}$$/Relatorio/RelSituacaoMunicipio`;
const ORIGIN = 'https://portalweb.ibge.gov.br';

describe('f5Prefix', () => {
  test('extracts prefix and hex from a gateway pathname', () => {
    expect(M.f5Prefix(F5_PATH)).toEqual({ prefix: `/f5-w-${F5_HEX}$$`, hex: F5_HEX });
  });

  test('returns null on the direct host', () => {
    expect(M.f5Prefix('/Relatorio/RelSituacaoMunicipio')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(M.f5Prefix('')).toBeNull();
    expect(M.f5Prefix(null)).toBeNull();
  });
});

describe('gatewayUrl', () => {
  test('direct host: origin + path, both modes', () => {
    const p = '/Relatorio/RelSituacaoMunicipioDados';
    expect(M.gatewayUrl(ORIGIN, '/Relatorio/X', p, true)).toBe(`${ORIGIN}${p}`);
    expect(M.gatewayUrl(ORIGIN, '/Relatorio/X', p, false)).toBe(`${ORIGIN}${p}`);
  });

  test('gateway, simple mode: prefix + path', () => {
    const p = '/Relatorio/RelSituacaoMunicipioDados';
    expect(M.gatewayUrl(ORIGIN, F5_PATH, p, true))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$${p}`);
  });

  // The shape captured from live 2026 traffic: a doubled /Relatorio
  // segment around f5-h-$$, then F5_origin and F5CH.
  //
  // Note "?F5_origin", not ";F5_origin". sigc-pro's equivalent uses ";"
  // because ITS endpoint already carries a query string
  // (/relatorio/filtrar?slug=...), making ";" a separator within it.
  // MUNIC's path has no query string, so the params need "?" — copying
  // sigc-pro verbatim here yields a 404 on the fallback URL.
  test('gateway, fallback mode: f5-h-$$ segment plus F5 params', () => {
    const p = '/Relatorio/RelSituacaoMunicipioDados';
    expect(M.gatewayUrl(ORIGIN, F5_PATH, p, false))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/Relatorio/f5-h-$$${p}?F5_origin=${F5_HEX}&F5CH=I`);
  });

  // Guards the rule rather than the one case: a path that already has a
  // query string must extend it with "&", not start a second one.
  test('a path with an existing query string extends it', () => {
    const p = '/Relatorio/Algo?slug=x';
    expect(M.gatewayUrl(ORIGIN, F5_PATH, p, false))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/Relatorio/f5-h-$$${p}&F5_origin=${F5_HEX}&F5CH=I`);
  });
});

describe('buildCsv', () => {
  test('semicolon-delimited with CRLF line endings', () => {
    expect(M.buildCsv(['a', 'b'], [['1', '2']])).toBe('a;b\r\n1;2\r\n');
  });

  test('quotes fields containing the delimiter, quotes or newlines', () => {
    expect(M.buildCsv(['a'], [['x;y']])).toBe('a\r\n"x;y"\r\n');
    expect(M.buildCsv(['a'], [['say "hi"']])).toBe('a\r\n"say ""hi"""\r\n');
  });

  test('renders null and undefined as empty', () => {
    expect(M.buildCsv(['a', 'b'], [[null, undefined]])).toBe('a;b\r\n;\r\n');
  });
});

describe('isoWeek', () => {
  // 2026-09-22 is a Tuesday in ISO week 39.
  test('formats as YYYY-Www', () => {
    expect(M.isoWeek(new Date('2026-09-22T10:00:00'))).toBe('2026-W39');
  });

  // The hard cases: ISO weeks belong to the year containing their Thursday.
  test('a January date can belong to the previous ISO year', () => {
    expect(M.isoWeek(new Date('2027-01-01T10:00:00'))).toBe('2026-W53');
  });

  test('a December date can belong to the next ISO year', () => {
    expect(M.isoWeek(new Date('2024-12-30T10:00:00'))).toBe('2025-W01');
  });

  test('pads single-digit weeks', () => {
    expect(M.isoWeek(new Date('2026-01-08T10:00:00'))).toBe('2026-W02');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/munic-common.test.js`
Expected: FAIL — `Cannot find module '../extension/common/munic-common.js'`

- [ ] **Step 3: Write the implementation**

Create `extension/common/munic-common.js`:

```js
// MUNIC-PRO shared runtime: F5 gateway URL construction, CSV building,
// file download, ISO-week formatting. Loaded before all feature scripts
// (MAIN world), so every feature sees window.__municPro.
//
// Deliberately a copy of sigc-pro's equivalents rather than a shared
// package: the two extensions ship independently and have no build step,
// and a shared dependency would buy less than it costs. Divergence is
// expected and fine.
(function () {
  'use strict';

  if (window.__municPro) return;

  function normalizeLabel(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // F5 BIG-IP URL-rewriting prefix ("/f5-w-<hex>$$"); the hex decodes to
  // the real backend origin. null on the direct host (intranet/VPN),
  // which is how the same code serves both routes with no configuration.
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  // simple=true: plain prefixed path. simple=false: the fuller shape
  // captured from live 2026 traffic (an f5-h-$$ segment inserted after
  // the first path segment, plus F5_origin/F5CH). On the direct host
  // both modes collapse to origin+path.
  //
  // Built by string concatenation, never via URLSearchParams: the "$$"
  // in the F5 segments gets percent-escaped by a query-param builder,
  // and the gateway then 404s.
  //
  // The separator is "?" when the path has no query string and "&" when
  // it does. sigc-pro hardcodes ";" because its only caller's path
  // always carries "?slug=...", where ";" reads as a separator inside
  // the existing query. MUNIC's paths are bare, so ";" there would make
  // F5_origin part of the path segment and 404.
  function gatewayUrl(origin, pathname, path, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}${path}`;
    if (simple) return `${origin}${f5.prefix}${path}`;
    const firstSeg = String(path).split('/')[1] || '';
    const sep = String(path).includes('?') ? '&' : '?';
    return `${origin}${f5.prefix}/${firstSeg}/f5-h-$$${path}` +
      `${sep}F5_origin=${f5.hex}&F5CH=I`;
  }

  // Which form the live gateway needs isn't knowable in advance, so try
  // the simple prefixed URL first and fall back to the full captured one.
  async function fetchViaGateway(path, options) {
    const urls = [...new Set([
      gatewayUrl(location.origin, location.pathname, path, true),
      gatewayUrl(location.origin, location.pathname, path, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function escapeCsvField(v) {
    v = String(v ?? '');
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  // pt-BR Excel expects `;`-delimited CSV (comma is the decimal separator
  // in that locale, so comma-delimited CSVs misparse on import).
  function buildCsv(header, rows) {
    const lines = [header, ...rows].map((r) => r.map(escapeCsvField).join(';'));
    return lines.join('\r\n') + '\r\n';
  }

  function downloadFile(filename, text, mimeType, opts) {
    // UTF-8 BOM so Excel doesn't mangle accented CSVs; pass
    // { bom: false } for formats that declare their own encoding (JSON).
    const bom = !(opts && opts.bom === false);
    const blob = new Blob([bom ? '﻿' + text : text], {
      type: mimeType || 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function timestampSlug() {
    const now = new Date();
    return {
      data: now.toISOString().slice(0, 10),
      hora: now.toTimeString().slice(0, 8).replace(/:/g, ''),
    };
  }

  // ISO-8601 week: weeks start Monday, and a week belongs to the year
  // containing its Thursday. Used for the Município tab's columns (one
  // per week, last run of that week), so it has to agree with what a
  // human would call "week 39" — hence Thursday-anchored rather than a
  // naive day-of-year division.
  function isoWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    // Shift to the Thursday of this ISO week. getDay() is 0 for Sunday,
    // so map Sunday to 7 first.
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + 4 - day);
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  // Keeps a widget present next to a page element. SIGC re-renders its
  // filter area, which silently removes a plainly-inserted button, so a
  // one-shot insert at document_idle does not survive.
  //
  // insert:'after' puts the widget as the anchor's NEXT SIBLING — for
  // anchoring beside a button such as Filtrar, where appending into the
  // anchor's parent would land after unrelated trailing siblings.
  // insert:'append' (default) puts it inside the anchor.
  //
  // Copied from sigc-pro's equivalent, minus its multi-feature context
  // cache: MUNIC-PRO has one mount.
  const mounts = [];
  let mountObserver = null;

  function tickMount(m) {
    // try/catch per mount: a broken mount must never break the others.
    try {
      const existing = document.getElementById(m.id);
      const anchorEl = m.anchor();
      const ok = anchorEl && (!m.when || m.when());
      if (ok && !existing) {
        if (m.insert === 'after') anchorEl.insertAdjacentElement('afterend', m.build());
        else anchorEl.appendChild(m.build());
      } else if (!ok && existing) {
        existing.remove();
      }
    } catch (err) {
      console.error('[munic-pro] mount failed', err);
    }
  }

  function tickAllMounts() {
    for (const m of mounts) tickMount(m);
  }

  function mountWidget(spec) {
    mounts.push(spec);
    tickMount(spec);
    if (!mountObserver) {
      mountObserver = new MutationObserver(tickAllMounts);
      mountObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.__municPro = {
    normalizeLabel,
    f5Prefix,
    gatewayUrl,
    fetchViaGateway,
    buildCsv,
    downloadFile,
    timestampSlug,
    isoWeek,
    mountWidget,
  };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/munic-common.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Verify the network gate still passes**

Run: `./scripts/check-network.sh`
Expected: `network gate: CLEAN`

(`fetch()` lives in `extension/common/`, which is fetch-sanctioned, and the file contains no absolute URL.)

- [ ] **Step 6: Commit**

```bash
git add extension/common/munic-common.js tests/munic-common.test.js
git commit -m "feat: shared helpers — F5 gateway URLs, CSV, ISO weeks"
```

---

### Task 2: Parse the situação table

Pure function over HTML text. No network, no storage — so it is fully testable from the live sample captured during design.

**Files:**
- Create: `extension/features/situacao-fetch/situacao-parse.js`
- Create: `tests/fixtures/situacao-sample.html`
- Test: `tests/situacao-parse.test.js`

**Interfaces:**
- Consumes: `window.__municPro.normalizeLabel` (Task 1)
- Produces: `window.__municProSituacaoParse` with
  `parseSituacao(html) -> { rows, warnings }` where each row is
  `{ uf_sigla, agencia_codigo, agencia_nome, municipio_codigo, municipio_nome, questionario, criticas_informativas, criticas_comparativas, situacao }`
  (codes and names are strings; críticas are numbers) and `warnings` is a
  string array. Throws `Error` on a structurally unusable response.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/situacao-sample.html` with this exact content — captured from live 2026 traffic. Note the HTML entities (`N&#227;o`), the `<span>-</span>` críticas placeholders, and that each município appears twice, once per questionário:

```html
<div id="DivRelatorio">
  <div class="table-responsive">
    <table id="tblMunicipios" class="hover stripe row-border">
      <thead>
        <tr id="colunas">
          <th class="text-start">UF</th>
          <th class="text-start">Agência</th>
          <th class="text-start">Município</th>
          <th class="text-start">Questionário</th>
          <th class="text-start">Críticas Informativas</th>
          <th class="text-start">Críticas Comparativas</th>
          <th class="text-start">Situação</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>BA</td>
          <td>290070200 - ALAGOINHAS</td>
          <td>2900702 - Alagoinhas</td>
          <td>B&#225;sico</td>
          <td><span>-</span></td>
          <td><span>-</span></td>
          <td>N&#227;o Iniciado</td>
        </tr>
        <tr>
          <td>BA</td>
          <td>290070200 - ALAGOINHAS</td>
          <td>2900702 - Alagoinhas</td>
          <td>Suplementar</td>
          <td><span>-</span></td>
          <td><span>-</span></td>
          <td>N&#227;o Iniciado</td>
        </tr>
        <tr>
          <td>BA</td>
          <td>290070200 - ALAGOINHAS</td>
          <td>2902054 - Ara&#231;&#225;s</td>
          <td>B&#225;sico</td>
          <td><span>3</span></td>
          <td><span>1</span></td>
          <td>Dig. Ibge</td>
        </tr>
        <tr>
          <td>BA</td>
          <td>290070200 - ALAGOINHAS</td>
          <td>2902054 - Ara&#231;&#225;s</td>
          <td>Suplementar</td>
          <td><span>-</span></td>
          <td><span>-</span></td>
          <td>N&#227;o Iniciado</td>
        </tr>
        <tr>
          <td>BA</td>
          <td>290570100 - CAMA&#199;ARI</td>
          <td>2915908 - Itanagra</td>
          <td>B&#225;sico</td>
          <td><span>-</span></td>
          <td><span>-</span></td>
          <td>Conclu&#237;do</td>
        </tr>
        <tr>
          <td>BA</td>
          <td>290570100 - CAMA&#199;ARI</td>
          <td>2915908 - Itanagra</td>
          <td>Suplementar</td>
          <td><span>-</span></td>
          <td><span>-</span></td>
          <td>Em Valida&#231;&#227;o</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
<div id="modal">
  <div id="munic_modal" class="modal fade">
    <table><tr><td>this table must never be mistaken for data</td></tr></table>
  </div>
</div>
```

- [ ] **Step 2: Write the failing test**

Create `tests/situacao-parse.test.js`:

```js
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-fetch/situacao-parse.js');

const { parseSituacao } = window.__municProSituacaoParse;
const SAMPLE = readFileSync('tests/fixtures/situacao-sample.html', 'utf8');

describe('parseSituacao', () => {
  test('returns one row per município per questionário', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows.length).toBe(6);
  });

  test('splits the "codigo - nome" cells', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows[0].agencia_codigo).toBe('290070200');
    expect(rows[0].agencia_nome).toBe('ALAGOINHAS');
    expect(rows[0].municipio_codigo).toBe('2900702');
    expect(rows[0].municipio_nome).toBe('Alagoinhas');
  });

  test('decodes HTML entities', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows[0].situacao).toBe('Não Iniciado');
    expect(rows[0].questionario).toBe('Básico');
    expect(rows[2].municipio_nome).toBe('Araçás');
    expect(rows[4].agencia_nome).toBe('CAMAÇARI');
  });

  test('the same município appears once per questionário', () => {
    const { rows } = parseSituacao(SAMPLE);
    const alagoinhas = rows.filter((r) => r.municipio_codigo === '2900702');
    expect(alagoinhas.map((r) => r.questionario).sort())
      .toEqual(['Básico', 'Suplementar']);
  });

  test('a questionário can differ in situação from its sibling', () => {
    const { rows } = parseSituacao(SAMPLE);
    const itanagra = rows.filter((r) => r.municipio_codigo === '2915908');
    const bySit = Object.fromEntries(itanagra.map((r) => [r.questionario, r.situacao]));
    expect(bySit['Básico']).toBe('Concluído');
    expect(bySit['Suplementar']).toBe('Em Validação');
  });

  test('"-" críticas become 0, digits become numbers', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows[0].criticas_informativas).toBe(0);
    expect(rows[0].criticas_comparativas).toBe(0);
    expect(rows[2].criticas_informativas).toBe(3);
    expect(rows[2].criticas_comparativas).toBe(1);
  });

  // The response carries modal markup containing another <table>. Taking
  // "the first table" would eventually pick up the wrong one; the parser
  // targets #tblMunicipios by id.
  test('ignores tables outside #tblMunicipios', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows.some((r) => r.uf_sigla.includes('mistaken'))).toBe(false);
  });

  test('warns about an unrecognised situação instead of bucketing it', () => {
    const html = SAMPLE.replace('Conclu&#237;do', 'Situa&#231;&#227;o Nova');
    const { rows, warnings } = parseSituacao(html);
    expect(rows.find((r) => r.situacao === 'Situação Nova')).toBeTruthy();
    expect(warnings.join(' ')).toContain('Situação Nova');
  });

  test('no warnings for the known vocabulary', () => {
    expect(parseSituacao(SAMPLE).warnings).toEqual([]);
  });

  test('throws when the table is absent', () => {
    expect(() => parseSituacao('<div>Erro</div>')).toThrow(/tblMunicipios/);
  });

  test('throws when a column is missing or renamed', () => {
    const html = SAMPLE.replace('<th class="text-start">Questionário</th>', '');
    expect(() => parseSituacao(html)).toThrow(/colunas/i);
  });

  test('throws when the table has no data rows', () => {
    const html = SAMPLE.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody></tbody>');
    expect(() => parseSituacao(html)).toThrow(/vazia/i);
  });

  test('throws on a duplicate (município, questionário) key', () => {
    const dup = SAMPLE.replace(
      '<td>2902054 - Ara&#231;&#225;s</td>\n          <td>B&#225;sico</td>',
      '<td>2900702 - Alagoinhas</td>\n          <td>B&#225;sico</td>',
    );
    expect(() => parseSituacao(dup)).toThrow(/duplicad/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/situacao-parse.test.js`
Expected: FAIL — cannot find `situacao-parse.js`

- [ ] **Step 4: Write the implementation**

Create `extension/features/situacao-fetch/situacao-parse.js`:

```js
// Parses the RelSituacaoMunicipioDados response into tidy rows.
//
// Pure: takes HTML text, returns data. No network, no storage — which is
// what makes it testable against the live sample in tests/fixtures/.
//
// 2026 returns one row per município PER QUESTIONÁRIO (Básico and
// Suplementar), each with its own situação and críticas. The 2025 R
// package assumed one row per município and would double every count.
(function () {
  'use strict';

  if (window.__municProSituacaoParse) return;

  const { normalizeLabel } = window.__municPro;

  // Expected header labels, left to right. Compared after
  // normalizeLabel, so spacing and case don't matter — but a renamed or
  // reordered column fails the run rather than silently shifting data
  // into the wrong field. Borrowed from sigc-pro's column-assertion
  // approach, which exists because SIGC does change layouts.
  const EXPECTED_COLUMNS = [
    'uf',
    'agência',
    'município',
    'questionário',
    'críticas informativas',
    'críticas comparativas',
    'situação',
  ];

  // The 2025 vocabulary (R/report.R:22-25), treated as a prior rather
  // than a guarantee: at the time of writing only "Não Iniciado" had
  // been seen in 2026, because collection had not started. An unknown
  // value passes through raw and is reported — never mapped into a
  // bucket it was not observed to belong to, which is exactly what the
  // R code's `.default` did silently.
  const KNOWN_SITUACOES = new Set([
    'Não Iniciado',
    'Dig. Informante',
    'Dig. Ibge',
    'Em Validação',
    'Concluído',
  ]);

  // SIGC writes "-" for an absent count.
  function parseCritica(text) {
    const t = String(text ?? '').trim();
    if (t === '' || t === '-' || t === '—') return 0;
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  // "290070200 - ALAGOINHAS" -> ['290070200', 'ALAGOINHAS'].
  // Splits on the FIRST " - " only: a município name may itself contain
  // a hyphen, and splitting on every occurrence would truncate it.
  function splitCodigoNome(text) {
    const t = String(text ?? '').trim();
    const i = t.indexOf(' - ');
    if (i === -1) return [t, ''];
    return [t.slice(0, i).trim(), t.slice(i + 3).trim()];
  }

  function parseSituacao(html) {
    // DOMParser is inert: nothing in the fetched markup can load a
    // resource or run a handler. Same guarantee sigc-pro's parsers rely
    // on.
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.getElementById('tblMunicipios');
    if (!table) {
      throw new Error(
        'Resposta do SIGC sem a tabela #tblMunicipios — ' +
        'a sessão pode ter expirado, ou o relatório mudou.',
      );
    }

    const headers = [...table.querySelectorAll('thead th')]
      .map((th) => normalizeLabel(th.textContent));
    const expected = EXPECTED_COLUMNS.map(normalizeLabel);
    if (headers.length !== expected.length ||
        headers.some((h, i) => h !== expected[i])) {
      throw new Error(
        `Colunas inesperadas no relatório.\n` +
        `Esperado: ${expected.join(' | ')}\n` +
        `Recebido: ${headers.join(' | ')}`,
      );
    }

    const trs = [...table.querySelectorAll('tbody tr')];
    if (trs.length === 0) {
      throw new Error('Tabela de situação vazia — nada foi gravado.');
    }

    const warnings = [];
    const unknown = new Set();
    const seen = new Set();
    const rows = trs.map((tr) => {
      const td = [...tr.querySelectorAll('td')].map((c) => c.textContent.trim());
      const [agencia_codigo, agencia_nome] = splitCodigoNome(td[1]);
      const [municipio_codigo, municipio_nome] = splitCodigoNome(td[2]);
      const situacao = td[6];

      if (situacao && !KNOWN_SITUACOES.has(situacao)) unknown.add(situacao);

      const key = `${municipio_codigo}|${td[3]}`;
      if (seen.has(key)) {
        throw new Error(
          `Linha duplicada para ${municipio_codigo} / ${td[3]} — ` +
          'o relatório não tem o formato esperado.',
        );
      }
      seen.add(key);

      return {
        uf_sigla: td[0],
        agencia_codigo,
        agencia_nome,
        municipio_codigo,
        municipio_nome,
        questionario: td[3],
        criticas_informativas: parseCritica(td[4]),
        criticas_comparativas: parseCritica(td[5]),
        situacao,
      };
    });

    if (unknown.size) {
      warnings.push(
        `Situação desconhecida (mantida como veio, sem cor): ` +
        [...unknown].join(', '),
      );
    }

    return { rows, warnings };
  }

  window.__municProSituacaoParse = { parseSituacao };
})();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/situacao-parse.test.js`
Expected: PASS, 13 tests

- [ ] **Step 6: Run the full suite and the gate**

Run: `bun test && ./scripts/check-network.sh`
Expected: all tests pass; `network gate: CLEAN`

- [ ] **Step 7: Commit**

```bash
git add extension/features/situacao-fetch/situacao-parse.js \
        tests/situacao-parse.test.js tests/fixtures/situacao-sample.html
git commit -m "feat: parse the situação table, one row per município×questionário"
```

---

### Task 3: SCD type-2 store (pure logic)

The diff algorithm, written as a pure function so it can be tested without IndexedDB. Task 4 wires it to the real database.

**Files:**
- Create: `extension/features/situacao-store/situacao-diff.js`
- Test: `tests/situacao-diff.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `window.__municProSituacaoDiff` with
  `diffSnapshot(current, incoming, runTs) -> { toClose, toInsert, nChanged }`
  where `current` and `incoming` are row arrays, `runTs` is an ISO string,
  `toClose` is an array of `{ key, until_ts }`, and `toInsert` is an array of
  rows each carrying `from_ts` and `until_ts: null`. Also exports
  `rowKey(row) -> string` and `VALUE_FIELDS` (string array).

- [ ] **Step 1: Write the failing test**

Create `tests/situacao-diff.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/features/situacao-store/situacao-diff.js');

const { diffSnapshot, rowKey } = window.__municProSituacaoDiff;

const TS1 = '2026-09-15T10:00:00';
const TS2 = '2026-09-22T10:00:00';

function row(municipio, questionario, situacao, extra = {}) {
  return {
    uf_sigla: 'BA',
    agencia_codigo: '290070200',
    agencia_nome: 'ALAGOINHAS',
    municipio_codigo: municipio,
    municipio_nome: 'Alagoinhas',
    questionario,
    criticas_informativas: 0,
    criticas_comparativas: 0,
    situacao,
    ...extra,
  };
}

function stored(r, from_ts) {
  return { ...r, from_ts, until_ts: null };
}

describe('rowKey', () => {
  test('is município plus questionário', () => {
    expect(rowKey(row('2900702', 'Básico', 'Não Iniciado'))).toBe('2900702|Básico');
  });

  test('distinguishes the two questionários of one município', () => {
    expect(rowKey(row('2900702', 'Básico', 'X')))
      .not.toBe(rowKey(row('2900702', 'Suplementar', 'X')));
  });
});

describe('diffSnapshot', () => {
  test('first run inserts everything', () => {
    const incoming = [row('2900702', 'Básico', 'Não Iniciado')];
    const r = diffSnapshot([], incoming, TS1);
    expect(r.toInsert.length).toBe(1);
    expect(r.toClose.length).toBe(0);
    expect(r.nChanged).toBe(1);
    expect(r.toInsert[0].from_ts).toBe(TS1);
    expect(r.toInsert[0].until_ts).toBeNull();
  });

  // Idempotence: the colleague may double-click, or run twice in a day.
  // A second identical run must write nothing, or the Município tab
  // grows a column that says nothing happened.
  test('an unchanged run writes nothing', () => {
    const r0 = row('2900702', 'Básico', 'Não Iniciado');
    const r = diffSnapshot([stored(r0, TS1)], [r0], TS2);
    expect(r.toInsert.length).toBe(0);
    expect(r.toClose.length).toBe(0);
    expect(r.nChanged).toBe(0);
  });

  test('a changed situação closes the old row and opens a new one', () => {
    const before = row('2900702', 'Básico', 'Não Iniciado');
    const after = row('2900702', 'Básico', 'Dig. Ibge');
    const r = diffSnapshot([stored(before, TS1)], [after], TS2);
    expect(r.toClose).toEqual([{ key: '2900702|Básico', until_ts: TS2 }]);
    expect(r.toInsert.length).toBe(1);
    expect(r.toInsert[0].situacao).toBe('Dig. Ibge');
    expect(r.toInsert[0].from_ts).toBe(TS2);
  });

  test('a changed crítica count counts as a change', () => {
    const before = row('2900702', 'Básico', 'Dig. Ibge');
    const after = row('2900702', 'Básico', 'Dig. Ibge', { criticas_informativas: 5 });
    const r = diffSnapshot([stored(before, TS1)], [after], TS2);
    expect(r.toInsert.length).toBe(1);
  });

  // Without this, a município dropped from SIGC stays "current" forever
  // and every as-of read after it lies.
  test('a key that vanishes from the fetch is closed', () => {
    const gone = row('2900702', 'Básico', 'Não Iniciado');
    const kept = row('2902054', 'Básico', 'Não Iniciado');
    const r = diffSnapshot([stored(gone, TS1), stored(kept, TS1)], [kept], TS2);
    expect(r.toClose).toEqual([{ key: '2900702|Básico', until_ts: TS2 }]);
    expect(r.toInsert.length).toBe(0);
    expect(r.nChanged).toBe(1);
  });

  test('a new key is inserted without closing anything', () => {
    const existing = row('2900702', 'Básico', 'Não Iniciado');
    const added = row('2902054', 'Básico', 'Não Iniciado');
    const r = diffSnapshot([stored(existing, TS1)], [existing, added], TS2);
    expect(r.toClose.length).toBe(0);
    expect(r.toInsert.length).toBe(1);
    expect(r.toInsert[0].municipio_codigo).toBe('2902054');
  });

  // The two questionários of one município move independently.
  test('one questionário can change while its sibling does not', () => {
    const basicoBefore = row('2900702', 'Básico', 'Não Iniciado');
    const suplBefore = row('2900702', 'Suplementar', 'Não Iniciado');
    const basicoAfter = row('2900702', 'Básico', 'Concluído');
    const r = diffSnapshot(
      [stored(basicoBefore, TS1), stored(suplBefore, TS1)],
      [basicoAfter, suplBefore],
      TS2,
    );
    expect(r.toClose).toEqual([{ key: '2900702|Básico', until_ts: TS2 }]);
    expect(r.toInsert.length).toBe(1);
    expect(r.toInsert[0].questionario).toBe('Básico');
  });

  // A name correction is not a collection event; it should not open a
  // new history row, or every município would churn on a SIGC rename.
  test('ignores fields that are not collection state', () => {
    const before = row('2900702', 'Básico', 'Não Iniciado');
    const after = row('2900702', 'Básico', 'Não Iniciado', {
      municipio_nome: 'ALAGOINHAS (grafia nova)',
    });
    const r = diffSnapshot([stored(before, TS1)], [after], TS2);
    expect(r.toInsert.length).toBe(0);
    expect(r.toClose.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/situacao-diff.test.js`
Expected: FAIL — cannot find `situacao-diff.js`

- [ ] **Step 3: Write the implementation**

Create `extension/features/situacao-store/situacao-diff.js`:

```js
// SCD type-2 diff: given what is currently open in the store and what
// SIGC just returned, decide what to close and what to open.
//
// Pure and free of IndexedDB so it can be tested directly — the database
// wiring lives in situacao-store.js, which calls this.
//
// Type 2 means history is kept by row rather than by snapshot: a row is
// written once when a state begins (from_ts) and stamped when it ends
// (until_ts), so an unchanged município costs nothing no matter how
// often the tool runs.
(function () {
  'use strict';

  if (window.__municProSituacaoDiff) return;

  // The fields that constitute collection state. A change in any of them
  // is a real event worth a new history row.
  //
  // Deliberately excludes the name fields: SIGC correcting a município
  // or agência spelling is not a collection event, and treating it as
  // one would churn the entire history on a rename.
  const VALUE_FIELDS = [
    'situacao',
    'criticas_informativas',
    'criticas_comparativas',
    'agencia_codigo',
  ];

  // 2026 returns one row per município PER QUESTIONÁRIO, and the two move
  // independently — Básico can be Concluído while Suplementar has not
  // started. The key must therefore include the questionário.
  function rowKey(row) {
    return `${row.municipio_codigo}|${row.questionario}`;
  }

  function sameValues(a, b) {
    return VALUE_FIELDS.every((f) => a[f] === b[f]);
  }

  function diffSnapshot(current, incoming, runTs) {
    const currentByKey = new Map(current.map((r) => [rowKey(r), r]));
    const incomingByKey = new Map(incoming.map((r) => [rowKey(r), r]));

    const toClose = [];
    const toInsert = [];

    for (const [key, next] of incomingByKey) {
      const prev = currentByKey.get(key);
      if (!prev) {
        toInsert.push({ ...next, from_ts: runTs, until_ts: null });
        continue;
      }
      if (!sameValues(prev, next)) {
        toClose.push({ key, until_ts: runTs });
        toInsert.push({ ...next, from_ts: runTs, until_ts: null });
      }
    }

    // Keys that disappeared from SIGC. Closed but not reopened, so
    // as-of reads stop reporting them as current.
    for (const key of currentByKey.keys()) {
      if (!incomingByKey.has(key)) {
        toClose.push({ key, until_ts: runTs });
      }
    }

    return { toClose, toInsert, nChanged: toClose.length + toInsert.length };
  }

  window.__municProSituacaoDiff = { diffSnapshot, rowKey, VALUE_FIELDS };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/situacao-diff.test.js`
Expected: PASS, 9 tests

Note the `nChanged` assertion in the "unchanged run" test: `toClose` and
`toInsert` are both empty, so it is 0.

- [ ] **Step 5: Run the full suite and the gate**

Run: `bun test && ./scripts/check-network.sh`
Expected: all pass; `network gate: CLEAN`

- [ ] **Step 6: Commit**

```bash
git add extension/features/situacao-store/situacao-diff.js tests/situacao-diff.test.js
git commit -m "feat: SCD type-2 diff, keyed on município and questionário"
```

---

### Task 4: IndexedDB persistence

Wraps Task 3's diff in real storage. `fake-indexeddb` gives the tests a real IndexedDB implementation.

**Files:**
- Create: `extension/features/situacao-store/situacao-store.js`
- Modify: `tests/setup.js`
- Modify: `package.json` (add `fake-indexeddb`)
- Test: `tests/situacao-store.test.js`

**Interfaces:**
- Consumes: `window.__municProSituacaoDiff.diffSnapshot`, `rowKey` (Task 3)
- Produces: `window.__municProSituacaoStore` with:
  - `openDb() -> Promise<IDBDatabase>`
  - `saveSnapshot(rows, runTs, warnings) -> Promise<{nChanged, nRows}>`
  - `getCurrent() -> Promise<row[]>` (rows with `until_ts === null`)
  - `getAll() -> Promise<row[]>` (full history)
  - `getRuns() -> Promise<{run_ts, n_rows, n_changed, warnings}[]>` ascending by `run_ts`
  - `clearAll() -> Promise<void>` (tests and a future reset)

- [ ] **Step 1: Add the test dependency**

Run: `bun add -d fake-indexeddb@6.0.0`

- [ ] **Step 2: Register it in the test setup**

Modify `tests/setup.js` — append after the existing `GlobalRegistrator.register()`:

```js
// happy-dom has no IndexedDB. fake-indexeddb is a real, spec-compliant
// implementation, so the store tests exercise actual transactions and
// index lookups rather than a hand-rolled stub that could agree with a
// broken implementation.
import 'fake-indexeddb/auto';
```

- [ ] **Step 3: Write the failing test**

Create `tests/situacao-store.test.js`:

```js
import { describe, test, expect, beforeEach } from 'bun:test';

await import('../extension/features/situacao-store/situacao-diff.js');
await import('../extension/features/situacao-store/situacao-store.js');

const S = window.__municProSituacaoStore;

const TS1 = '2026-09-15T10:00:00';
const TS2 = '2026-09-22T10:00:00';

function row(municipio, questionario, situacao) {
  return {
    uf_sigla: 'BA',
    agencia_codigo: '290070200',
    agencia_nome: 'ALAGOINHAS',
    municipio_codigo: municipio,
    municipio_nome: 'Alagoinhas',
    questionario,
    criticas_informativas: 0,
    criticas_comparativas: 0,
    situacao,
  };
}

beforeEach(async () => {
  await S.clearAll();
});

describe('saveSnapshot', () => {
  test('first run stores every row as current', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'Não Iniciado')], TS1, []);
    const current = await S.getCurrent();
    expect(current.length).toBe(1);
    expect(current[0].situacao).toBe('Não Iniciado');
    expect(current[0].from_ts).toBe(TS1);
  });

  test('an unchanged second run adds no history rows', async () => {
    const r = row('2900702', 'Básico', 'Não Iniciado');
    await S.saveSnapshot([r], TS1, []);
    await S.saveSnapshot([r], TS2, []);
    expect((await S.getAll()).length).toBe(1);
    expect((await S.getCurrent()).length).toBe(1);
  });

  test('a change closes the old row and leaves exactly one current', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'Não Iniciado')], TS1, []);
    await S.saveSnapshot([row('2900702', 'Básico', 'Dig. Ibge')], TS2, []);

    const all = await S.getAll();
    expect(all.length).toBe(2);

    const closed = all.find((r) => r.until_ts !== null);
    expect(closed.situacao).toBe('Não Iniciado');
    expect(closed.until_ts).toBe(TS2);

    const current = await S.getCurrent();
    expect(current.length).toBe(1);
    expect(current[0].situacao).toBe('Dig. Ibge');
  });

  test('reports how many rows changed', async () => {
    const first = await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS1, []);
    expect(first.nChanged).toBe(1);
    const second = await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS2, []);
    expect(second.nChanged).toBe(0);
  });

  test('a vanished município is closed, not left current', async () => {
    const a = row('2900702', 'Básico', 'Não Iniciado');
    const b = row('2902054', 'Básico', 'Não Iniciado');
    await S.saveSnapshot([a, b], TS1, []);
    await S.saveSnapshot([b], TS2, []);

    const current = await S.getCurrent();
    expect(current.length).toBe(1);
    expect(current[0].municipio_codigo).toBe('2902054');
  });
});

describe('getRuns', () => {
  // Every run is recorded even when nothing changed, so the Município
  // tab can tell "we ran and nothing moved" from "nobody ran it".
  test('records a run even when nothing changed', async () => {
    const r = row('2900702', 'Básico', 'Não Iniciado');
    await S.saveSnapshot([r], TS1, []);
    await S.saveSnapshot([r], TS2, []);

    const runs = await S.getRuns();
    expect(runs.length).toBe(2);
    expect(runs[0].run_ts).toBe(TS1);
    expect(runs[1].run_ts).toBe(TS2);
    expect(runs[1].n_changed).toBe(0);
    expect(runs[1].n_rows).toBe(1);
  });

  test('returns runs in ascending timestamp order', async () => {
    const r = row('2900702', 'Básico', 'X');
    await S.saveSnapshot([r], TS2, []);
    await S.saveSnapshot([r], TS1, []);
    const runs = await S.getRuns();
    expect(runs.map((x) => x.run_ts)).toEqual([TS1, TS2]);
  });

  test('stores warnings alongside the run', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS1, ['situação nova: X']);
    const runs = await S.getRuns();
    expect(runs[0].warnings).toEqual(['situação nova: X']);
  });
});

describe('clearAll', () => {
  test('empties both stores', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS1, []);
    await S.clearAll();
    expect(await S.getAll()).toEqual([]);
    expect(await S.getRuns()).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test tests/situacao-store.test.js`
Expected: FAIL — cannot find `situacao-store.js`

- [ ] **Step 5: Write the implementation**

Create `extension/features/situacao-store/situacao-store.js`:

```js
// IndexedDB persistence for the situação history.
//
// IndexedDB rather than chrome.storage: this is a growing time series,
// and chrome.storage is a quota-limited key-value bag. It is also a page
// API, so it works from the MAIN world where chrome.* does not.
//
// This directory is storage-sanctioned by scripts/check-network.sh and
// must never touch the network — no fetching of any kind belongs here.
(function () {
  'use strict';

  if (window.__municProSituacaoStore) return;

  const { diffSnapshot, rowKey } = window.__municProSituacaoDiff;

  const DB_NAME = 'munic-pro';
  const DB_VERSION = 1;
  const STORE_SITUACAO = 'situacao';
  const STORE_RUNS = 'runs';

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SITUACAO)) {
          // Auto-increment: one município+questionário has MANY rows over
          // time (one per state), so the key cannot be the business key.
          const s = db.createObjectStore(STORE_SITUACAO, {
            keyPath: 'id',
            autoIncrement: true,
          });
          // Open rows are looked up on every save. IndexedDB cannot index
          // on null, so `open_key` holds the row key while the row is
          // current and is deleted when it closes — making this index
          // contain exactly the open rows.
          s.createIndex('open_key', 'open_key', { unique: true });
        }
        if (!db.objectStoreNames.contains(STORE_RUNS)) {
          db.createObjectStore(STORE_RUNS, { keyPath: 'run_ts' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCurrent() {
    const db = await openDb();
    const tx = db.transaction(STORE_SITUACAO, 'readonly');
    const rows = await promisify(tx.objectStore(STORE_SITUACAO).getAll());
    db.close();
    return rows.filter((r) => r.until_ts === null);
  }

  async function getAll() {
    const db = await openDb();
    const tx = db.transaction(STORE_SITUACAO, 'readonly');
    const rows = await promisify(tx.objectStore(STORE_SITUACAO).getAll());
    db.close();
    return rows;
  }

  async function getRuns() {
    const db = await openDb();
    const tx = db.transaction(STORE_RUNS, 'readonly');
    const runs = await promisify(tx.objectStore(STORE_RUNS).getAll());
    db.close();
    return runs.sort((a, b) => String(a.run_ts).localeCompare(String(b.run_ts)));
  }

  async function clearAll() {
    const db = await openDb();
    const tx = db.transaction([STORE_SITUACAO, STORE_RUNS], 'readwrite');
    tx.objectStore(STORE_SITUACAO).clear();
    tx.objectStore(STORE_RUNS).clear();
    await txDone(tx);
    db.close();
  }

  // Applies one fetch to the store: closes what changed or vanished,
  // opens what is new, and records the run either way.
  //
  // The whole thing runs in ONE readwrite transaction, so a failure
  // halfway cannot leave history half-updated.
  async function saveSnapshot(rows, runTs, warnings) {
    const db = await openDb();
    const tx = db.transaction([STORE_SITUACAO, STORE_RUNS], 'readwrite');
    const situacao = tx.objectStore(STORE_SITUACAO);
    const runs = tx.objectStore(STORE_RUNS);

    const stored = await promisify(situacao.getAll());
    const current = stored.filter((r) => r.until_ts === null);

    const { toClose, toInsert, nChanged } = diffSnapshot(current, rows, runTs);

    const byKey = new Map(current.map((r) => [rowKey(r), r]));
    for (const { key, until_ts } of toClose) {
      const existing = byKey.get(key);
      if (!existing) continue;
      // Drop open_key as the row closes: the index then holds only open
      // rows, and its uniqueness constraint stays satisfiable when the
      // replacement row for the same key is inserted below.
      const { open_key, ...rest } = existing;
      situacao.put({ ...rest, until_ts });
    }

    for (const r of toInsert) {
      situacao.add({ ...r, open_key: rowKey(r) });
    }

    runs.put({
      run_ts: runTs,
      n_rows: rows.length,
      n_changed: nChanged,
      warnings: warnings || [],
    });

    await txDone(tx);
    db.close();
    return { nChanged, nRows: rows.length };
  }

  window.__municProSituacaoStore = {
    openDb,
    saveSnapshot,
    getCurrent,
    getAll,
    getRuns,
    clearAll,
  };
})();
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/situacao-store.test.js`
Expected: PASS, 9 tests

- [ ] **Step 7: Run the full suite and the gate**

Run: `bun test && ./scripts/check-network.sh`
Expected: all pass; `network gate: CLEAN`

(The gate allows `indexedDB` only in this directory, and forbids `fetch()` here — this file has neither problem.)

- [ ] **Step 8: Commit**

```bash
git add extension/features/situacao-store/situacao-store.js \
        tests/situacao-store.test.js tests/setup.js package.json bun.lock
git commit -m "feat: IndexedDB store with SCD type-2 history and a runs log"
```

---

### Task 5: Fetch from SIGC

Builds the request, calls the endpoint, hands the response to Task 2's parser.

**Files:**
- Create: `extension/features/situacao-fetch/situacao-fetch.js`
- Test: `tests/situacao-fetch.test.js`

**Interfaces:**
- Consumes: `window.__municPro.fetchViaGateway` (Task 1), `window.__municProSituacaoParse.parseSituacao` (Task 2)
- Produces: `window.__municProSituacaoFetch` with
  `fetchSituacao(uf) -> Promise<{rows, warnings, html}>` and
  `window.__municProSituacaoFetchInternals` with
  `buildBody(uf) -> string`, `readUf() -> string`, `REQUEST_HEADERS` (object),
  `SITUACAO_PATH` (string).

- [ ] **Step 1: Write the failing test**

Create `tests/situacao-fetch.test.js`:

```js
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-fetch/situacao-parse.js');
await import('../extension/features/situacao-fetch/situacao-fetch.js');

const F = window.__municProSituacaoFetch;
const I = window.__municProSituacaoFetchInternals;
const SAMPLE = readFileSync('tests/fixtures/situacao-sample.html', 'utf8');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('buildBody', () => {
  // Matches the body captured from live 2026 traffic exactly.
  test('URL-encodes the objJson payload', () => {
    expect(I.buildBody(29)).toBe(
      'objJson=' + encodeURIComponent(
        '{"IdUf":29,"IdAgencia":1,"IdMunicipio":0,"TipoQuestionario":0}',
      ),
    );
  });

  test('decodes back to the captured shape', () => {
    const decoded = decodeURIComponent(I.buildBody(29).replace('objJson=', ''));
    expect(JSON.parse(decoded)).toEqual({
      IdUf: 29, IdAgencia: 1, IdMunicipio: 0, TipoQuestionario: 0,
    });
  });

  test('accepts a UF given as a string', () => {
    const decoded = decodeURIComponent(I.buildBody('29').replace('objJson=', ''));
    expect(JSON.parse(decoded).IdUf).toBe(29);
  });
});

describe('REQUEST_HEADERS', () => {
  // Not decorative: these are ASP.NET MVC partial views and commonly
  // gate on IsAjaxRequest(), which keys off X-Requested-With.
  test('declares the AJAX and form-encoding headers', () => {
    expect(I.REQUEST_HEADERS['X-Requested-With']).toBe('XMLHttpRequest');
    expect(I.REQUEST_HEADERS['Content-Type'])
      .toBe('application/x-www-form-urlencoded; charset=UTF-8');
  });
});

describe('readUf', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  // select2 hides the real <select> but leaves it in the DOM, so
  // reading .value still works — same approach sigc-pro uses.
  test('reads the UF from the page select', () => {
    document.body.innerHTML = '<select id="IdUf"><option value="29" selected>29 - BAHIA</option></select>';
    expect(I.readUf()).toBe('29');
  });

  test('returns empty string when the select is absent', () => {
    expect(I.readUf()).toBe('');
  });
});

describe('fetchSituacao', () => {
  test('posts to the situação endpoint and parses the response', async () => {
    let seen = null;
    globalThis.fetch = async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 200, text: async () => SAMPLE };
    };

    const result = await F.fetchSituacao(29);

    expect(seen.options.method).toBe('POST');
    expect(seen.options.credentials).toBe('same-origin');
    expect(seen.url).toContain('/Relatorio/RelSituacaoMunicipioDados');
    expect(result.rows.length).toBe(6);
    expect(result.warnings).toEqual([]);
    expect(result.html).toBe(SAMPLE);
  });

  // An expired session returns HTTP 200 carrying the login page, so a
  // status check alone would treat it as success.
  test('reports an expired session rather than a parse failure', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<form><input type="password" name="Password"></form>',
    });
    await expect(F.fetchSituacao(29)).rejects.toThrow(/sess/i);
  });

  test('reports the F5 interstitial as a dead portal session', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><title>Working...</title></html>',
    });
    await expect(F.fetchSituacao(29)).rejects.toThrow(/portalweb|sess/i);
  });

  test('propagates a transport failure', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    await expect(F.fetchSituacao(29)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/situacao-fetch.test.js`
Expected: FAIL — cannot find `situacao-fetch.js`

- [ ] **Step 3: Write the implementation**

Create `extension/features/situacao-fetch/situacao-fetch.js`:

```js
// Fetches the MUNIC situação report from SIGC.
//
// One POST covers the whole UF: IdAgencia=1 does NOT filter (live
// responses span several agências), IdMunicipio=0 means all, and
// TipoQuestionario=0 returns both Básico and Suplementar. The 2025 R
// package made one request per município for críticas — about 417 of
// them — which this replaces entirely.
//
// This directory is fetch-sanctioned by scripts/check-network.sh, which
// also forbids absolute URLs here: every request goes through
// fetchViaGateway and is therefore relative to location.origin.
(function () {
  'use strict';

  if (window.__municProSituacaoFetch) return;

  const { fetchViaGateway } = window.__municPro;
  const { parseSituacao } = window.__municProSituacaoParse;

  const SITUACAO_PATH = '/Relatorio/RelSituacaoMunicipioDados';

  const REQUEST_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    // ASP.NET MVC partial views commonly gate on IsAjaxRequest(), which
    // reads this header. Both endpoints here are partial views.
    'X-Requested-With': 'XMLHttpRequest',
  };

  function buildBody(uf) {
    const objJson = JSON.stringify({
      IdUf: Number(uf),
      IdAgencia: 1,
      IdMunicipio: 0,
      TipoQuestionario: 0,
    });
    return 'objJson=' + encodeURIComponent(objJson);
  }

  // The filter form's UF <select> is dressed as a select2 combobox: the
  // visible text is a rendered span, but the original <select> stays in
  // the DOM and its .value is still readable.
  function readUf() {
    const s = document.getElementById('IdUf');
    return s ? s.value : '';
  }

  // Both failures below arrive as HTTP 200, so they must be detected by
  // body content. Checked before parsing, so the user is told the
  // session died rather than that a table was missing.
  function assertAuthenticated(html) {
    if (/<title>\s*Working/i.test(html)) {
      throw new Error(
        'A sessão do portalweb expirou. Recarregue a página, ' +
        'faça login novamente e repita.',
      );
    }
    if (/type=["']password["']/i.test(html)) {
      throw new Error(
        'A sessão do SIGC expirou. Recarregue a página, ' +
        'faça login novamente e repita.',
      );
    }
  }

  async function fetchSituacao(uf) {
    const res = await fetchViaGateway(SITUACAO_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: REQUEST_HEADERS,
      body: buildBody(uf),
    });
    const html = await res.text();
    assertAuthenticated(html);
    const { rows, warnings } = parseSituacao(html);
    return { rows, warnings, html };
  }

  window.__municProSituacaoFetch = { fetchSituacao };
  window.__municProSituacaoFetchInternals = {
    buildBody,
    readUf,
    REQUEST_HEADERS,
    SITUACAO_PATH,
  };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/situacao-fetch.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Run the full suite and the gate**

Run: `bun test && ./scripts/check-network.sh`
Expected: all pass; `network gate: CLEAN`

- [ ] **Step 6: Commit**

```bash
git add extension/features/situacao-fetch/situacao-fetch.js tests/situacao-fetch.test.js
git commit -m "feat: fetch the situação report in one request per UF"
```

---

### Task 6: Report aggregation (pure)

Turns stored history into the three tabs' data. Pure functions, so the whole report is testable without a DOM.

**Files:**
- Create: `extension/features/situacao-report/situacao-aggregate.js`
- Test: `tests/situacao-aggregate.test.js`

**Interfaces:**
- Consumes: `window.__municPro.isoWeek` (Task 1)
- Produces: `window.__municProSituacaoAggregate` with:
  - `weekColumns(runs) -> {week, run_ts}[]` — last run of each ISO week, ascending, with empty weeks filled in as `{week, run_ts: null}`
  - `situacaoAsOf(allRows, ts) -> row[]` — rows open at `ts`
  - `municipioGrid(allRows, columns) -> {key, municipio_codigo, municipio_nome, agencia_nome, questionario, cells}` — `cells` is an array parallel to `columns`, each a situação string or `null`
  - `groupCounts(rows, groupFields) -> {group, situacao, n, pct}[]`
  - `SITUACAO_ORDER` (string array)

- [ ] **Step 1: Write the failing test**

Create `tests/situacao-aggregate.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-report/situacao-aggregate.js');

const A = window.__municProSituacaoAggregate;

describe('weekColumns', () => {
  // The 2025 R code picked, per ISO week, the snapshot whose weekday was
  // closest to the latest snapshot's weekday. That assumes near-daily
  // runs. The 2026 cadence is uncertain, so this takes the LAST run of
  // each week — well defined at any cadence.
  test('takes the last run of each ISO week', () => {
    const runs = [
      { run_ts: '2026-09-21T09:00:00' }, // Mon, W39
      { run_ts: '2026-09-23T09:00:00' }, // Wed, W39
      { run_ts: '2026-09-28T09:00:00' }, // Mon, W40
    ];
    expect(A.weekColumns(runs)).toEqual([
      { week: '2026-W39', run_ts: '2026-09-23T09:00:00' },
      { week: '2026-W40', run_ts: '2026-09-28T09:00:00' },
    ]);
  });

  test('a single run yields a single column', () => {
    expect(A.weekColumns([{ run_ts: '2026-09-22T10:00:00' }]))
      .toEqual([{ week: '2026-W39', run_ts: '2026-09-22T10:00:00' }]);
  });

  test('no runs yields no columns', () => {
    expect(A.weekColumns([])).toEqual([]);
  });

  // A skipped week must be visible as a gap, not silently closed up —
  // otherwise two non-adjacent weeks look consecutive.
  test('weeks with no run appear as empty columns', () => {
    const runs = [
      { run_ts: '2026-09-07T09:00:00' }, // W37
      { run_ts: '2026-09-21T09:00:00' }, // W39
    ];
    expect(A.weekColumns(runs)).toEqual([
      { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
      { week: '2026-W38', run_ts: null },
      { week: '2026-W39', run_ts: '2026-09-21T09:00:00' },
    ]);
  });

  test('handles a year boundary without inventing weeks', () => {
    const runs = [
      { run_ts: '2026-12-28T09:00:00' }, // 2026-W53
      { run_ts: '2027-01-04T09:00:00' }, // 2027-W01
    ];
    const cols = A.weekColumns(runs);
    expect(cols.map((c) => c.week)).toEqual(['2026-W53', '2027-W01']);
  });
});

describe('situacaoAsOf', () => {
  const rows = [
    { municipio_codigo: '1', questionario: 'Básico', situacao: 'Não Iniciado',
      from_ts: '2026-09-01T00:00:00', until_ts: '2026-09-15T00:00:00' },
    { municipio_codigo: '1', questionario: 'Básico', situacao: 'Dig. Ibge',
      from_ts: '2026-09-15T00:00:00', until_ts: null },
  ];

  test('returns the state open at that instant', () => {
    expect(A.situacaoAsOf(rows, '2026-09-10T00:00:00')[0].situacao)
      .toBe('Não Iniciado');
  });

  test('an open row is current at any later instant', () => {
    expect(A.situacaoAsOf(rows, '2026-09-20T00:00:00')[0].situacao)
      .toBe('Dig. Ibge');
  });

  // from_ts is inclusive, until_ts exclusive — otherwise a row would
  // appear twice at the exact instant of a change.
  test('the change instant belongs to the new row only', () => {
    const at = A.situacaoAsOf(rows, '2026-09-15T00:00:00');
    expect(at.length).toBe(1);
    expect(at[0].situacao).toBe('Dig. Ibge');
  });

  test('returns nothing before the first row opened', () => {
    expect(A.situacaoAsOf(rows, '2026-08-01T00:00:00')).toEqual([]);
  });
});

describe('municipioGrid', () => {
  const rows = [
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
      situacao: 'Não Iniciado',
      from_ts: '2026-09-07T09:00:00', until_ts: '2026-09-21T09:00:00' },
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
      situacao: 'Dig. Ibge',
      from_ts: '2026-09-21T09:00:00', until_ts: null },
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Suplementar',
      situacao: 'Não Iniciado',
      from_ts: '2026-09-07T09:00:00', until_ts: null },
  ];
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W39', run_ts: '2026-09-21T09:00:00' },
  ];

  test('one line per município per questionário', () => {
    const grid = A.municipioGrid(rows, columns);
    expect(grid.length).toBe(2);
    expect(grid.map((g) => g.questionario).sort())
      .toEqual(['Básico', 'Suplementar']);
  });

  test('cells hold the situação at each column instant', () => {
    const grid = A.municipioGrid(rows, columns);
    const basico = grid.find((g) => g.questionario === 'Básico');
    expect(basico.cells).toEqual(['Não Iniciado', 'Dig. Ibge']);
  });

  test('a questionário that never moved repeats its situação', () => {
    const grid = A.municipioGrid(rows, columns);
    const supl = grid.find((g) => g.questionario === 'Suplementar');
    expect(supl.cells).toEqual(['Não Iniciado', 'Não Iniciado']);
  });

  test('an empty week column yields null cells', () => {
    const cols = [...columns, { week: '2026-W40', run_ts: null }];
    const grid = A.municipioGrid(rows, cols);
    expect(grid[0].cells[2]).toBeNull();
  });
});

describe('groupCounts', () => {
  const rows = [
    { agencia_nome: 'A', situacao: 'Não Iniciado' },
    { agencia_nome: 'A', situacao: 'Não Iniciado' },
    { agencia_nome: 'A', situacao: 'Concluído' },
    { agencia_nome: 'B', situacao: 'Concluído' },
  ];

  test('counts by group and situação', () => {
    const out = A.groupCounts(rows, ['agencia_nome']);
    const a = out.filter((r) => r.group === 'A');
    expect(a.find((r) => r.situacao === 'Não Iniciado').n).toBe(2);
    expect(a.find((r) => r.situacao === 'Concluído').n).toBe(1);
  });

  test('percentages are within the group, not the whole', () => {
    const out = A.groupCounts(rows, ['agencia_nome']);
    const a = out.filter((r) => r.group === 'A');
    expect(a.find((r) => r.situacao === 'Não Iniciado').pct).toBeCloseTo(2 / 3);
    const b = out.filter((r) => r.group === 'B');
    expect(b.find((r) => r.situacao === 'Concluído').pct).toBeCloseTo(1);
  });

  test('each group sums to 100%', () => {
    const out = A.groupCounts(rows, ['agencia_nome']);
    for (const g of ['A', 'B']) {
      const total = out.filter((r) => r.group === g)
        .reduce((s, r) => s + r.pct, 0);
      expect(total).toBeCloseTo(1);
    }
  });

  test('joins multiple group fields', () => {
    const multi = [{ assistencia_nome: 'X', agencia_nome: 'A', situacao: 'Concluído' }];
    const out = A.groupCounts(multi, ['assistencia_nome', 'agencia_nome']);
    expect(out[0].group).toBe('X | A');
  });

  test('no rows yields no groups', () => {
    expect(A.groupCounts([], ['agencia_nome'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/situacao-aggregate.test.js`
Expected: FAIL — cannot find `situacao-aggregate.js`

- [ ] **Step 3: Write the implementation**

Create `extension/features/situacao-report/situacao-aggregate.js`:

```js
// Turns stored SCD type-2 history into the three tabs' data.
//
// Pure functions over plain arrays: no DOM, no IndexedDB. The rendering
// in situacao-report.js does no arithmetic of its own, so all of the
// report's logic is covered by tests that need neither a browser nor a
// portal session.
(function () {
  'use strict';

  if (window.__municProSituacaoAggregate) return;

  const { isoWeek } = window.__municPro;

  // Display order for the buckets. Unknown values are appended at the
  // end by the caller rather than folded into one of these.
  const SITUACAO_ORDER = [
    'Não Iniciado',
    'Dig. Informante',
    'Dig. Ibge',
    'Em Validação',
    'Concluído',
  ];

  // One column per ISO week, holding the LAST run of that week.
  //
  // Deliberately not the 2025 rule (R/report.R:141-163), which picked
  // the run whose weekday was closest to the latest run's weekday. That
  // is sensible for near-daily runs and misleading for irregular ones: a
  // week represented by a Monday run would sit beside a week represented
  // by a Friday run as though they were comparable.
  //
  // Weeks with no run are emitted with run_ts null, so a gap in
  // monitoring is visible instead of being closed up.
  function weekColumns(runs) {
    if (!runs.length) return [];

    const lastByWeek = new Map();
    for (const r of runs) {
      const week = isoWeek(new Date(r.run_ts));
      const prev = lastByWeek.get(week);
      if (!prev || String(r.run_ts) > String(prev)) {
        lastByWeek.set(week, r.run_ts);
      }
    }

    const sortedTs = runs.map((r) => r.run_ts).sort();
    const first = new Date(sortedTs[0]);
    const last = new Date(sortedTs[sortedTs.length - 1]);

    // Walk week by week from the first run to the last so gaps appear.
    // Stepping 7 days from a normalized Monday avoids month-length and
    // year-boundary arithmetic entirely.
    const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    cursor.setDate(cursor.getDate() - ((cursor.getDay() || 7) - 1));

    const out = [];
    const guard = 1000; // a run history longer than ~19 years is a bug
    for (let i = 0; cursor <= last && i < guard; i += 1) {
      const week = isoWeek(cursor);
      out.push({ week, run_ts: lastByWeek.get(week) ?? null });
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  }

  // The rows open at an instant. from_ts is inclusive and until_ts
  // exclusive, so at the exact moment of a change only the new row
  // matches — otherwise a município would appear twice in that column.
  function situacaoAsOf(allRows, ts) {
    const t = String(ts);
    return allRows.filter((r) =>
      String(r.from_ts) <= t && (r.until_ts === null || String(r.until_ts) > t));
  }

  function gridKey(r) {
    return `${r.municipio_codigo}|${r.questionario}`;
  }

  // One line per município per questionário, with one cell per column.
  function municipioGrid(allRows, columns) {
    const byKey = new Map();
    for (const r of allRows) {
      const key = gridKey(r);
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          municipio_codigo: r.municipio_codigo,
          municipio_nome: r.municipio_nome,
          agencia_nome: r.agencia_nome,
          questionario: r.questionario,
          cells: [],
        });
      }
    }

    const asOfCache = columns.map((c) =>
      (c.run_ts === null ? null : situacaoAsOf(allRows, c.run_ts)));

    for (const [key, line] of byKey) {
      line.cells = asOfCache.map((rows) => {
        if (rows === null) return null;
        const hit = rows.find((r) => gridKey(r) === key);
        return hit ? hit.situacao : null;
      });
    }

    return [...byKey.values()].sort((a, b) =>
      a.municipio_nome.localeCompare(b.municipio_nome, 'pt-BR') ||
      a.questionario.localeCompare(b.questionario, 'pt-BR'));
  }

  // Counts and within-group percentages. Percentages are of the group's
  // own total, matching the 2025 report's *_pct sheets (R/report.R:196-200).
  function groupCounts(rows, groupFields) {
    const totals = new Map();
    const counts = new Map();

    for (const r of rows) {
      const group = groupFields.map((f) => r[f] ?? '').join(' | ');
      totals.set(group, (totals.get(group) || 0) + 1);
      const k = `${group}\u0000${r.situacao}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }

    const out = [];
    for (const [k, n] of counts) {
      const [group, situacao] = k.split('\u0000');
      out.push({ group, situacao, n, pct: n / totals.get(group) });
    }

    return out.sort((a, b) =>
      a.group.localeCompare(b.group, 'pt-BR') ||
      SITUACAO_ORDER.indexOf(a.situacao) - SITUACAO_ORDER.indexOf(b.situacao));
  }

  window.__municProSituacaoAggregate = {
    weekColumns,
    situacaoAsOf,
    municipioGrid,
    groupCounts,
    SITUACAO_ORDER,
  };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/situacao-aggregate.test.js`
Expected: PASS, 17 tests

- [ ] **Step 5: Run the full suite and the gate**

Run: `bun test && ./scripts/check-network.sh`
Expected: all pass; `network gate: CLEAN`

- [ ] **Step 6: Commit**

```bash
git add extension/features/situacao-report/situacao-aggregate.js \
        tests/situacao-aggregate.test.js
git commit -m "feat: report aggregation with last-run-of-week columns"
```

---

### Task 7: Exports

JSON snapshot (auto-downloaded every run) and the two CSV shapes.

**Files:**
- Create: `extension/features/situacao-export/situacao-export.js`
- Test: `tests/situacao-export.test.js`

**Interfaces:**
- Consumes: `window.__municPro.buildCsv`, `downloadFile`, `timestampSlug` (Task 1);
  `window.__municProSituacaoAggregate.situacaoAsOf` (Task 6) — the
  denormalized CSV needs the state as of each run
- Produces: `window.__municProSituacaoExport` with:
  - `snapshotJson(allRows, runs) -> string`
  - `denormalizedCsv(allRows, runs) -> string`
  - `stateChangeCsv(allRows) -> string`
  - `downloadSnapshot(allRows, runs) -> void`
  - `downloadDenormalizedCsv(allRows, runs) -> void`
  - `downloadStateChangeCsv(allRows) -> void`

- [ ] **Step 1: Write the failing test**

Create `tests/situacao-export.test.js`:

```js
import { describe, test, expect } from 'bun:test';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-report/situacao-aggregate.js');
await import('../extension/features/situacao-export/situacao-export.js');

const E = window.__municProSituacaoExport;

const ROWS = [
  { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
    agencia_codigo: '290070200', agencia_nome: 'ALAGOINHAS',
    questionario: 'Básico', situacao: 'Não Iniciado',
    criticas_informativas: 0, criticas_comparativas: 0,
    from_ts: '2026-09-07T09:00:00', until_ts: '2026-09-21T09:00:00' },
  { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
    agencia_codigo: '290070200', agencia_nome: 'ALAGOINHAS',
    questionario: 'Básico', situacao: 'Dig. Ibge',
    criticas_informativas: 3, criticas_comparativas: 1,
    from_ts: '2026-09-21T09:00:00', until_ts: null },
];

const RUNS = [
  { run_ts: '2026-09-07T09:00:00', n_rows: 1, n_changed: 1, warnings: [] },
  { run_ts: '2026-09-21T09:00:00', n_rows: 1, n_changed: 1, warnings: [] },
];

describe('snapshotJson', () => {
  test('round-trips rows and runs', () => {
    const parsed = JSON.parse(E.snapshotJson(ROWS, RUNS));
    expect(parsed.rows.length).toBe(2);
    expect(parsed.runs.length).toBe(2);
  });

  test('carries a version and an export timestamp', () => {
    const parsed = JSON.parse(E.snapshotJson(ROWS, RUNS));
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exported_at).toBe('string');
  });
});

describe('stateChangeCsv', () => {
  test('one line per stored row plus a header', () => {
    const lines = E.stateChangeCsv(ROWS).trim().split('\r\n');
    expect(lines.length).toBe(3);
  });

  test('header names the interval columns', () => {
    const header = E.stateChangeCsv(ROWS).split('\r\n')[0];
    expect(header).toContain('from_ts');
    expect(header).toContain('until_ts');
    expect(header).toContain('questionario');
  });

  test('an open row has an empty until_ts', () => {
    const lines = E.stateChangeCsv(ROWS).trim().split('\r\n');
    expect(lines[2].endsWith(';')).toBe(true);
  });
});

describe('denormalizedCsv', () => {
  // One row per run per município: every line is a timestamped
  // observation, so a pivot needs no interval reasoning.
  test('emits every município for every run', () => {
    const lines = E.denormalizedCsv(ROWS, RUNS).trim().split('\r\n');
    expect(lines.length).toBe(3); // header + 1 município × 2 runs
  });

  test('each line carries the situação as of that run', () => {
    const lines = E.denormalizedCsv(ROWS, RUNS).trim().split('\r\n');
    expect(lines[1]).toContain('Não Iniciado');
    expect(lines[2]).toContain('Dig. Ibge');
  });

  test('header starts with the run timestamp', () => {
    expect(E.denormalizedCsv(ROWS, RUNS).split(';')[0]).toBe('run_ts');
  });

  test('no runs yields only a header', () => {
    expect(E.denormalizedCsv(ROWS, []).trim().split('\r\n').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/situacao-export.test.js`
Expected: FAIL — cannot find `situacao-export.js`

- [ ] **Step 3: Write the implementation**

Create `extension/features/situacao-export/situacao-export.js`:

```js
// Exports: a JSON snapshot (the durability artifact) and two CSV shapes.
//
// The CSVs are for the author's analysis in R and for LibreOffice — NOT
// for the colleague's daily use. The machine running this has Excel
// Online, which cannot pivot a local CSV, which is why the in-browser
// panel carries the report.
//
// No network here: Blob + object URL only, which is why this directory
// is not fetch-sanctioned.
(function () {
  'use strict';

  if (window.__municProSituacaoExport) return;

  const { buildCsv, downloadFile, timestampSlug } = window.__municPro;
  const { situacaoAsOf } = window.__municProSituacaoAggregate;

  const STATE_HEADER = [
    'municipio_codigo', 'municipio_nome',
    'agencia_codigo', 'agencia_nome',
    'questionario', 'situacao',
    'criticas_informativas', 'criticas_comparativas',
    'from_ts', 'until_ts',
  ];

  const DENORM_HEADER = [
    'run_ts',
    'municipio_codigo', 'municipio_nome',
    'agencia_codigo', 'agencia_nome',
    'questionario', 'situacao',
    'criticas_informativas', 'criticas_comparativas',
  ];

  // Full fidelity, for re-import after a cleared profile and for
  // reconciling two machines' histories.
  function snapshotJson(allRows, runs) {
    return JSON.stringify({
      version: 1,
      exported_at: new Date().toISOString(),
      rows: allRows,
      runs,
    }, null, 2);
  }

  // One line per stored state, mirroring the store exactly. Compact, and
  // the right shape for interval analysis in R.
  function stateChangeCsv(allRows) {
    const rows = allRows.map((r) => STATE_HEADER.map((f) => r[f] ?? ''));
    return buildCsv(STATE_HEADER, rows);
  }

  // One line per run per município: every line is an independent
  // timestamped observation, so a pivot table needs no interval logic.
  // Larger than the state-change form, and much easier to consume.
  function denormalizedCsv(allRows, runs) {
    const rows = [];
    for (const run of runs) {
      for (const r of situacaoAsOf(allRows, run.run_ts)) {
        rows.push([
          run.run_ts,
          r.municipio_codigo, r.municipio_nome,
          r.agencia_codigo, r.agencia_nome,
          r.questionario, r.situacao,
          r.criticas_informativas, r.criticas_comparativas,
        ]);
      }
    }
    return buildCsv(DENORM_HEADER, rows);
  }

  function downloadSnapshot(allRows, runs) {
    const { data } = timestampSlug();
    // bom:false — JSON declares its own encoding, and a BOM breaks
    // strict parsers on re-import.
    downloadFile(
      `munic2026_${data}.json`,
      snapshotJson(allRows, runs),
      'application/json;charset=utf-8',
      { bom: false },
    );
  }

  function downloadDenormalizedCsv(allRows, runs) {
    const { data } = timestampSlug();
    downloadFile(`munic2026_observacoes_${data}.csv`,
      denormalizedCsv(allRows, runs));
  }

  function downloadStateChangeCsv(allRows) {
    const { data } = timestampSlug();
    downloadFile(`munic2026_mudancas_${data}.csv`, stateChangeCsv(allRows));
  }

  window.__municProSituacaoExport = {
    snapshotJson,
    denormalizedCsv,
    stateChangeCsv,
    downloadSnapshot,
    downloadDenormalizedCsv,
    downloadStateChangeCsv,
  };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/situacao-export.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Run the full suite and the gate**

Run: `bun test && ./scripts/check-network.sh`
Expected: all pass; `network gate: CLEAN`

- [ ] **Step 6: Commit**

```bash
git add extension/features/situacao-export/situacao-export.js tests/situacao-export.test.js
git commit -m "feat: JSON snapshot and two CSV exports"
```

---

### Task 8: The panel and buttons

Renders the three tabs and wires the buttons onto the SIGC page. Last task, because it consumes everything above.

**Where the buttons go.**

Page: `/Relatorio/RelSituacaoMunicipio`, titled **"Situação das Prefeituras,
com Críticas da UF"**. On the gateway its URL carries the F5 prefix; on the
intranet it does not. The manifest matches both origins.

Its own buttons, confirmed from a live screenshot, are:

```
Atualizar críticas | Abrir | PDF | Excel
```

**There is no `#btnFiltrar` on this page.** sigc-pro anchors to that id
(`ultimo-movimento-export.js:245`), and copying it here would find nothing
and silently mount no buttons at all.

The real markup, captured from the live page:

```html
<div class="col-12 text-sm-end">
  <a href="javascript:…RelDados('/Relatorio/AtualizarCriticas')…"
     id="btnAtualizarCriticas" class="btn btn-primary"
     style="min-width: 85px; margin-right: 10px;">Atualizar críticas</a>
  <a href="javascript:…RelDados('/Relatorio/RelSituacaoMunicipioDados')…"
     id="btnAbrir" class="btn btn-primary"
     style="min-width: 85px; margin-right: 10px;">Abrir</a>
  <a href="javascript:…RelDownload(2)…" id="btnAbrirPdf" …>PDF</a>
  <a href="javascript:…RelDownload(3)…" id="btnAbrirExcel"
     class="btn btn-primary" style="min-width: 85px;">Excel</a>
</div>
```

**Anchor: `insertAdjacentElement('afterend')` on `#btnAbrirExcel`**, the last
button in the row — so ours appear after SIGC's own, in a row that already
exists on page load.

Three things this markup settles:

1. **The endpoints are confirmed from the page's own code.** Stripped of the
   F5 `javascript:` wrapper, `#btnAbrir` calls
   `RelDados('/Relatorio/RelSituacaoMunicipioDados')` and
   `#btnAtualizarCriticas` calls `RelDados('/Relatorio/AtualizarCriticas')` —
   the two endpoints this plan uses, verbatim, and both through the *same*
   `RelDados()` helper. Whatever `AtualizarCriticas` does, it is invoked
   exactly like the data call, with the same `objJson` body.
2. **They are `<a class="btn btn-primary">`, not `<button>`.** Ours must be
   too, or they will look foreign in the row. `min-width: 85px` and
   `margin-right: 10px` (on all but the last) are how the row spaces itself.
3. **Our `<a>` elements must not carry an `href`.** SIGC's are `javascript:`
   URLs rewritten by the F5 layer; adding one of our own risks the rewriter
   touching it. A click handler alone is enough, with
   `style="cursor: pointer"` to keep the pointer.

Not `document.querySelector('h6')`: that takes the *first* h6 on the page,
which is not necessarily the report header.

**MUNIC-PRO does not require a prior Abrir.** The POST carries its own
`objJson` and is self-contained, so the colleague can land on the page and
click Atualizar immediately. This differs from the Último Movimento features,
which parse the rendered results table and therefore need a Filtrar first.

**The Agência dropdown is deliberately ignored.** The form offers one
(a screenshot shows `SALVADOR 01` selected), but the captured POST sends
`IdAgencia: 1` and comes back spanning several agências — matching the card's
own title, "Críticas **da UF**". MUNIC-PRO always fetches the whole UF.

This is not a simplification, it is a correctness requirement: the SCD diff
closes every key absent from a fetch, so a snapshot narrowed to one agência
would mark every município outside it as having vanished. Only `#IdUf` is
read from the page.

**A MutationObserver, not a poll.** SIGC re-renders its filter area, which
removes a plainly-inserted button. `mountWidget` (Task 1) re-inserts it
whenever that happens and removes it when the page no longer qualifies.

**Files:**
- Create: `extension/features/situacao-report/situacao-report.js`
- Test: `tests/situacao-report.test.js`

**Interfaces:**
- Consumes: all previous modules
- Produces: `window.__municProSituacaoReport` with `buildActions() -> HTMLElement`, and
  `window.__municProSituacaoReportInternals` with:
  - `onSituacaoPage() -> boolean` — true when all four of SIGC's own
    buttons are present
  - `makeButton(text, onClick) -> HTMLAnchorElement`
  - `situacaoClass(situacao) -> string` (`''` for unknown values)
  - `renderMunicipioTab(grid, columns) -> HTMLElement`
  - `renderGroupTab(counts) -> HTMLElement`
  - `buildPanel(data) -> HTMLElement`
  - `PAGE_BUTTON_IDS` (string array), `ANCHOR_ID` (string)

The module self-mounts at load via `mountWidget`; nothing calls it.

- [ ] **Step 1: Write the failing test**

Create `tests/situacao-report.test.js`:

```js
import { describe, test, expect, beforeEach } from 'bun:test';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-report/situacao-aggregate.js');
await import('../extension/features/situacao-report/situacao-report.js');

const R = window.__municProSituacaoReportInternals;

describe('onSituacaoPage', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  // Detection is by the presence of THIS page's own buttons, not by its
  // title. An earlier draft matched the text "situacao municipio" and
  // would have returned false on the live page, whose card is titled
  // "Situação das Prefeituras, com Críticas da UF" — the same class of
  // silent miss sigc-pro documents in ultimo-movimento-export.js:26-33.
  // The ids come from the page's own markup and are what we anchor to
  // anyway, so detection and anchoring cannot drift apart.
  test('true when the page action buttons are present', () => {
    document.body.innerHTML =
      '<a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a>';
    expect(R.onSituacaoPage()).toBe(true);
  });

  test('false when the anchor button is absent', () => {
    document.body.innerHTML = '<a id="btnAtualizarCriticas"></a>';
    expect(R.onSituacaoPage()).toBe(false);
  });

  test('false on an unrelated report page', () => {
    document.body.innerHTML = '<a id="btnFiltrar"></a><h6>Relatório Último Movimento</h6>';
    expect(R.onSituacaoPage()).toBe(false);
  });

  test('false on an empty page', () => {
    expect(R.onSituacaoPage()).toBe(false);
  });
});

describe('makeButton', () => {
  // SIGC's own buttons are <a class="btn btn-primary">, not <button>.
  // Matching that is what makes ours look native in the row.
  test('builds an anchor with SIGC button classes', () => {
    const b = R.makeButton('Atualizar', () => {});
    expect(b.tagName).toBe('A');
    expect(b.className).toContain('btn');
    expect(b.className).toContain('btn-primary');
  });

  // SIGC's hrefs are javascript: URLs rewritten by the F5 layer. Ours
  // carries none, so the rewriter has nothing of ours to touch.
  test('carries no href', () => {
    expect(R.makeButton('X', () => {}).hasAttribute('href')).toBe(false);
  });

  test('keeps the pointer cursor without an href', () => {
    expect(R.makeButton('X', () => {}).style.cursor).toBe('pointer');
  });

  test('calls its handler on click', () => {
    let called = false;
    const b = R.makeButton('X', () => { called = true; });
    b.click();
    expect(called).toBe(true);
  });
});

describe('situacaoClass', () => {
  test('maps each known situação to its bucket class', () => {
    expect(R.situacaoClass('Não Iniciado')).toBe('munic-pro-nao-iniciado');
    expect(R.situacaoClass('Dig. Ibge')).toBe('munic-pro-digitacao');
    expect(R.situacaoClass('Dig. Informante')).toBe('munic-pro-digitacao');
    expect(R.situacaoClass('Em Validação')).toBe('munic-pro-digitacao');
    expect(R.situacaoClass('Concluído')).toBe('munic-pro-concluido');
  });

  // An unknown value gets NO class, so it renders uncoloured and
  // visibly different rather than being silently miscoloured as
  // something it is not.
  test('unknown situação gets no class', () => {
    expect(R.situacaoClass('Situação Nova')).toBe('');
    expect(R.situacaoClass(null)).toBe('');
  });
});

describe('renderMunicipioTab', () => {
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W38', run_ts: null },
  ];
  const grid = [{
    key: '2900702|Básico',
    municipio_codigo: '2900702',
    municipio_nome: 'Alagoinhas',
    agencia_nome: 'ALAGOINHAS',
    questionario: 'Básico',
    cells: ['Não Iniciado', null],
  }];

  test('renders one row per grid line', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  test('shows the questionário as its own column', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.textContent).toContain('Básico');
  });

  // The header carries the real run date, so a stale column cannot be
  // mistaken for a fresh one.
  test('column headers carry the week and the run date', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const ths = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(ths.some((t) => t.includes('2026-W37') && t.includes('07/09'))).toBe(true);
  });

  test('a week with no run is labelled as such', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const ths = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(ths.some((t) => t.includes('2026-W38') && /sem coleta|—/i.test(t))).toBe(true);
  });

  test('colours cells by situação', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.querySelector('.munic-pro-nao-iniciado')).toBeTruthy();
  });
});

describe('renderGroupTab', () => {
  const counts = [
    { group: 'A', situacao: 'Não Iniciado', n: 2, pct: 2 / 3 },
    { group: 'A', situacao: 'Concluído', n: 1, pct: 1 / 3 },
  ];

  test('one row per group-situação pair', () => {
    const el = R.renderGroupTab(counts);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });

  test('shows count and percentage together', () => {
    const el = R.renderGroupTab(counts);
    const text = el.textContent;
    expect(text).toContain('2');
    expect(text).toMatch(/66[.,]7\s*%/);
  });
});

describe('page anchor', () => {
  // Pinned to the ids captured from the live page. If SIGC renames a
  // button, this fails loudly here instead of the extension quietly
  // mounting nothing and the colleague reporting "the buttons are gone".
  test('anchors to the last of SIGC own buttons', () => {
    expect(R.PAGE_BUTTON_IDS).toEqual([
      'btnAtualizarCriticas', 'btnAbrir', 'btnAbrirPdf', 'btnAbrirExcel',
    ]);
    expect(R.ANCHOR_ID).toBe('btnAbrirExcel');
  });

  test('the anchor is one of the detected buttons', () => {
    expect(R.PAGE_BUTTON_IDS).toContain(R.ANCHOR_ID);
  });
});

describe('buildPanel', () => {
  const data = {
    grid: [],
    columns: [],
    porAssistencia: [],
    porAgencia: [],
    warnings: [],
    lastRun: '2026-09-22T10:00:00',
  };

  test('has the three tabs', () => {
    const panel = R.buildPanel(data);
    const tabs = [...panel.querySelectorAll('[data-munic-pro-tab]')]
      .map((t) => t.textContent.trim());
    expect(tabs).toEqual(['Município', 'Assistência', 'Agência']);
  });

  test('shows warnings when present', () => {
    const panel = R.buildPanel({ ...data, warnings: ['situação nova: X'] });
    expect(panel.textContent).toContain('situação nova: X');
  });

  test('shows no warning banner when there are none', () => {
    const panel = R.buildPanel(data);
    expect(panel.querySelector('.munic-pro-avisos')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/situacao-report.test.js`
Expected: FAIL — cannot find `situacao-report.js`

- [ ] **Step 3: Write the implementation**

Create `extension/features/situacao-report/situacao-report.js`:

```js
// The report panel: three tabs over the stored history, plus the buttons
// that drive a fetch and the exports.
//
// Renders only — every count, percentage and column choice comes from
// situacao-aggregate.js, so the arithmetic is tested without a DOM.
(function () {
  'use strict';

  if (window.__municProSituacaoReport) return;

  const { normalizeLabel, downloadFile } = window.__municPro;
  const AGG = window.__municProSituacaoAggregate;

  const TAG = '[munic-pro]';

  // Colours ported verbatim from the 2025 workbook (R/report.R:320-336),
  // so the report reads the same to anyone used to the spreadsheet.
  const SITUACAO_CLASS = {
    'Não Iniciado': 'munic-pro-nao-iniciado',
    'Dig. Informante': 'munic-pro-digitacao',
    'Dig. Ibge': 'munic-pro-digitacao',
    'Em Validação': 'munic-pro-digitacao',
    'Concluído': 'munic-pro-concluido',
  };

  const STYLE = `
    .munic-pro-panel { font-size: 13px; margin: 12px 0; }
    .munic-pro-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .munic-pro-tabs button { padding: 4px 12px; cursor: pointer; }
    .munic-pro-tabs button[aria-selected="true"] { font-weight: bold; }
    .munic-pro-panel table { border-collapse: collapse; width: 100%; }
    .munic-pro-panel th, .munic-pro-panel td {
      border: 1px solid #ccc; padding: 2px 6px; text-align: left;
      white-space: nowrap;
    }
    .munic-pro-panel thead th { position: sticky; top: 0; background: #f5f5f5; }
    .munic-pro-nao-iniciado { color: #9C0006; background: #FFC7CE; }
    .munic-pro-digitacao    { color: #9C5700; background: #FFEB9C; }
    .munic-pro-supervisao   { color: #006100; background: #C6EFCE; }
    .munic-pro-concluido    { color: #0B77A0; background: #CAEEFB; }
    .munic-pro-avisos { background: #FFEB9C; padding: 6px; margin-bottom: 8px; }
    .munic-pro-vazio { color: #999; }
  `;

  // This page's own action buttons, from its live markup. ANCHOR_ID is
  // the last of them, so ours land after SIGC's.
  const PAGE_BUTTON_IDS = [
    'btnAtualizarCriticas', 'btnAbrir', 'btnAbrirPdf', 'btnAbrirExcel',
  ];
  const ANCHOR_ID = 'btnAbrirExcel';

  // Detected by the page's own buttons rather than by its title.
  //
  // An earlier draft matched the header text "situacao municipio" and
  // would have been false on the live page, which is titled "Situação
  // das Prefeituras, com Críticas da UF". Anchoring to the same ids we
  // detect on means detection and anchoring cannot drift apart: if the
  // ids change, we mount nothing rather than mounting somewhere wrong.
  function onSituacaoPage() {
    return PAGE_BUTTON_IDS.every((id) => document.getElementById(id));
  }

  // Mirrors SIGC's own buttons: <a class="btn btn-primary"> with the same
  // inline metrics. No href — SIGC's are javascript: URLs rewritten by
  // the F5 layer, and ours has nothing for it to rewrite.
  function makeButton(text, onClick) {
    const a = document.createElement('a');
    a.className = 'btn btn-primary';
    a.textContent = text;
    a.style.minWidth = '85px';
    a.style.marginLeft = '10px';
    a.style.cursor = 'pointer';
    a.addEventListener('click', onClick);
    return a;
  }

  // '' for anything unrecognised: an unknown situação renders uncoloured
  // and visibly odd, rather than being miscoloured as a bucket it may
  // not belong to.
  function situacaoClass(situacao) {
    return SITUACAO_CLASS[situacao] || '';
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.appendChild(c);
    return node;
  }

  function fmtPct(p) {
    return `${(p * 100).toFixed(1).replace('.', ',')}%`;
  }

  function fmtColumnHeader(col) {
    if (col.run_ts === null) return `${col.week}\n— sem coleta —`;
    const d = new Date(col.run_ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${col.week}\n(${dd}/${mm})`;
  }

  function renderMunicipioTab(grid, columns) {
    const head = el('tr', {}, [
      el('th', { text: 'Agência' }),
      el('th', { text: 'Município' }),
      el('th', { text: 'Questionário' }),
      ...columns.map((c) => el('th', { text: fmtColumnHeader(c) })),
    ]);

    const body = grid.map((line) => el('tr', {}, [
      el('td', { text: line.agencia_nome }),
      el('td', { text: line.municipio_nome }),
      el('td', { text: line.questionario }),
      ...line.cells.map((cell) => el('td', {
        text: cell === null ? '—' : cell,
        class: cell === null ? 'munic-pro-vazio' : situacaoClass(cell),
      })),
    ]));

    return el('table', {}, [
      el('thead', {}, [head]),
      el('tbody', {}, body),
    ]);
  }

  function renderGroupTab(counts) {
    const head = el('tr', {}, [
      el('th', { text: 'Grupo' }),
      el('th', { text: 'Situação' }),
      el('th', { text: 'Municípios' }),
      el('th', { text: '%' }),
    ]);

    const body = counts.map((c) => el('tr', {}, [
      el('td', { text: c.group }),
      el('td', { text: c.situacao, class: situacaoClass(c.situacao) }),
      el('td', { text: String(c.n) }),
      el('td', { text: fmtPct(c.pct) }),
    ]));

    return el('table', {}, [
      el('thead', {}, [head]),
      el('tbody', {}, body),
    ]);
  }

  function buildPanel(data) {
    const panel = el('div', { class: 'munic-pro-panel' });
    panel.appendChild(el('style', { text: STYLE }));

    if (data.warnings && data.warnings.length) {
      panel.appendChild(el('div', {
        class: 'munic-pro-avisos',
        text: data.warnings.join(' | '),
      }));
    }

    const tabNames = ['Município', 'Assistência', 'Agência'];
    const panes = [
      renderMunicipioTab(data.grid, data.columns),
      renderGroupTab(data.porAssistencia),
      renderGroupTab(data.porAgencia),
    ];

    const buttons = tabNames.map((name, i) => {
      const b = el('button', { type: 'button', text: name });
      b.setAttribute('data-munic-pro-tab', String(i));
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        buttons.forEach((other, j) => {
          other.setAttribute('aria-selected', i === j ? 'true' : 'false');
          panes[j].style.display = i === j ? '' : 'none';
        });
      });
      return b;
    });

    panes.forEach((p, i) => { p.style.display = i === 0 ? '' : 'none'; });

    panel.appendChild(el('div', { class: 'munic-pro-tabs' }, buttons));
    for (const p of panes) panel.appendChild(p);
    return panel;
  }

  // Builds the button row. Kept thin: every piece of logic it calls is
  // tested on its own.
  function buildActions() {
    const status = el('span', { id: 'munic-pro-status' });
    status.style.marginLeft = '10px';
    const bar = el('span', { id: 'munic-pro-actions' });

    const say = (msg) => { status.textContent = msg; };

    const atualizar = makeButton('Atualizar', async () => {
      const FETCH = window.__municProSituacaoFetch;
      const STORE = window.__municProSituacaoStore;
      const EXPORT = window.__municProSituacaoExport;
      // Only the UF is read from the page. The Agência dropdown is
      // ignored on purpose: this report is UF-wide ("Críticas da UF"),
      // and a snapshot narrowed to one agência would make the SCD diff
      // close every município outside it.
      const uf = window.__municProSituacaoFetchInternals.readUf();
      if (!uf) { say('Selecione a Unidade Estadual.'); return; }

      say('buscando…');
      try {
        const { rows, warnings } = await FETCH.fetchSituacao(uf);
        const runTs = new Date().toISOString().slice(0, 19);
        const { nChanged } = await STORE.saveSnapshot(rows, runTs, warnings);
        // Auto-download so the history survives a cleared profile
        // without anyone having to remember to export it.
        EXPORT.downloadSnapshot(await STORE.getAll(), await STORE.getRuns());
        say(`${rows.length} linhas, ${nChanged} mudança(s).` +
            (warnings.length ? ` ${warnings.join(' | ')}` : ''));
      } catch (err) {
        console.error(TAG, err);
        say(`erro: ${err.message}`);
      }
    });

    const relatorio = makeButton('Relatório', async () => {
      const STORE = window.__municProSituacaoStore;
      const existing = document.querySelector('.munic-pro-panel');
      if (existing) existing.remove();

      const allRows = await STORE.getAll();
      const runs = await STORE.getRuns();
      if (!runs.length) { say('Sem histórico ainda — clique em Atualizar.'); return; }

      const columns = AGG.weekColumns(runs);
      const current = AGG.situacaoAsOf(allRows, runs[runs.length - 1].run_ts);
      const panel = buildPanel({
        grid: AGG.municipioGrid(allRows, columns),
        columns,
        porAssistencia: AGG.groupCounts(current, ['agencia_nome']),
        porAgencia: AGG.groupCounts(current, ['agencia_nome', 'municipio_nome']),
        warnings: runs[runs.length - 1].warnings || [],
        lastRun: runs[runs.length - 1].run_ts,
      });
      // The button row sits in a right-aligned div; the panel belongs
      // below the whole card, full width.
      const card = bar.closest('.card') || bar.parentElement.parentElement;
      card.parentElement.insertBefore(panel, card.nextSibling);
      say('');
    });

    const csvObs = makeButton('CSV observações', async () => {
      const STORE = window.__municProSituacaoStore;
      window.__municProSituacaoExport.downloadDenormalizedCsv(
        await STORE.getAll(), await STORE.getRuns());
    });

    const csvMud = makeButton('CSV mudanças', async () => {
      const STORE = window.__municProSituacaoStore;
      window.__municProSituacaoExport.downloadStateChangeCsv(await STORE.getAll());
    });

    for (const b of [atualizar, relatorio, csvObs, csvMud]) bar.appendChild(b);
    bar.appendChild(status);
    return bar;
  }

  window.__municProSituacaoReport = { buildActions };
  window.__municProSituacaoReportInternals = {
    onSituacaoPage,
    makeButton,
    situacaoClass,
    renderMunicipioTab,
    renderGroupTab,
    buildPanel,
    PAGE_BUTTON_IDS,
    ANCHOR_ID,
  };

  // Inserted after SIGC's last button, and re-inserted whenever the page
  // re-renders and drops it. mountWidget also removes it if the page
  // stops qualifying, so a SPA navigation leaves nothing orphaned.
  if (typeof document !== 'undefined' && document.body) {
    window.__municPro.mountWidget({
      id: 'munic-pro-actions',
      anchor: () => document.getElementById(ANCHOR_ID),
      insert: 'after',
      when: () => onSituacaoPage(),
      build: buildActions,
    });
  }
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/situacao-report.test.js`
Expected: PASS, 22 tests

- [ ] **Step 5: Run the full suite and the gate**

Run: `bun test && ./scripts/check-network.sh`
Expected: all pass; `network gate: CLEAN`

- [ ] **Step 6: Verify the manifest loads every file in dependency order**

Read `extension/manifest.json` and confirm `content_scripts[0].js` lists exactly, in this order:

```
common/munic-common.js
features/situacao-store/situacao-diff.js
features/situacao-store/situacao-store.js
features/situacao-fetch/situacao-parse.js
features/situacao-fetch/situacao-fetch.js
features/situacao-report/situacao-aggregate.js
features/situacao-report/situacao-report.js
features/situacao-export/situacao-export.js
```

The scaffold's manifest lists only five files and omits `situacao-diff.js`,
`situacao-parse.js` and `situacao-aggregate.js`. Update it to the list above.
Order matters: each file reads its dependencies off `window` at load time.

- [ ] **Step 7: Add a manifest load-order test**

Append to `tests/smoke.test.js`:

```js
// Each file reads its dependencies off window at load time, so a wrong
// order is a TypeError at page load — in the browser, where nobody is
// watching. Pinned here instead.
test('manifest loads scripts in dependency order', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  expect(manifest.content_scripts[0].js).toEqual([
    'common/munic-common.js',
    'features/situacao-store/situacao-diff.js',
    'features/situacao-store/situacao-store.js',
    'features/situacao-fetch/situacao-parse.js',
    'features/situacao-fetch/situacao-fetch.js',
    'features/situacao-report/situacao-aggregate.js',
    'features/situacao-report/situacao-report.js',
    'features/situacao-export/situacao-export.js',
  ]);
});
```

- [ ] **Step 8: Run the full suite**

Run: `bun test && ./scripts/check-network.sh`
Expected: all pass; `network gate: CLEAN`

- [ ] **Step 9: Commit**

```bash
git add extension/features/situacao-report/situacao-report.js \
        tests/situacao-report.test.js tests/smoke.test.js extension/manifest.json
git commit -m "feat: three-tab report panel and page buttons"
```

---

## Manual verification

Automated tests cover parsing, diffing, storage, aggregation and export
against fixtures. What they cannot cover is the live portal. After Task 8,
load the extension unpacked and check:

- [ ] On the **Situação das Prefeituras, com Críticas da UF** page, our four
      buttons appear **after SIGC's Excel button**, in the same row, styled
      like the native ones.
- [ ] They appear **without clicking Abrir first** — the POST is
      self-contained.
- [ ] Changing the Agência dropdown does **not** change what gets stored:
      the report stays UF-wide.
- [ ] **Atualizar** reports a row count and a change count, and a
      `munic2026_YYYY-MM-DD.json` lands in Downloads.
- [ ] A second **Atualizar** minutes later reports **0 mudanças** — the
      idempotence guarantee, visible.
- [ ] **Relatório** opens the panel; all three tabs render and switch.
- [ ] The Município tab shows one row per município **per questionário**.
- [ ] Both CSV buttons download files that open correctly in LibreOffice
      with accents intact.
- [ ] Let the session expire (or log out in another tab), then click
      **Atualizar**: the message names the expired session rather than
      showing a parse error.
- [ ] Confirm which URL form the gateway accepted — check the Network tab
      for whether the simple or the fallback URL succeeded, and note it in
      the spec.

## Deferred (not in this MVP)

Per the spec, and each needing a decision before it is built:

- **`AtualizarCriticas` trigger** — off until its semantics are known. It
  mutates server state for the whole UF, and if it is asynchronous a fixed
  wait yields stale numbers with no error.
- **Assistência enrichment and RCD 202531** — Task 8 groups the
  "Assistência" tab by agência as a placeholder. Whether `orce` or SIGC is
  authoritative for agência, and whether RCD 202531 still applies in 2026,
  are open questions in the spec. Resolving them adds a lookup table and
  changes only `groupCounts`' arguments.
- **`.xlsx` export** — the panel plus CSV cover the need.
- **Snapshot import/merge** — export exists; import is only needed once a
  second machine or a cleared profile actually happens.
