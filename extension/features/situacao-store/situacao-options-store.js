// Storage logic for the options page.
//
// The options page is an extension page, on the extension's own origin —
// the same origin situacao-worker.js (the service worker) opens the
// history on. So both open the SAME database, through the same
// situacao-db.js, and this file calls it directly rather than messaging
// the worker: there is nothing to bridge to. IndexedDB serialises the two
// as concurrent writers via its transaction model.
//
// What is left here is the page's own logic: status counts, the backup
// JSON's shape and its validation.
//
// This directory is storage-sanctioned by scripts/check-network.sh; the
// options page's OWN files (extension/options/) are not, and must call
// into this module rather than touching indexedDB themselves.
(function () {
  'use strict';

  if (window.__municProSituacaoOptionsStore) return;

  const DBMOD = window.__municProSituacaoDb;
  const DB = DBMOD.criarDb(indexedDB);

  // Snapshot format version. Matches situacao-export.js's snapshotJson
  // exactly — a backup made from the panel and one made from this page
  // must be interchangeable, so this is not an independent choice.
  const SNAPSHOT_VERSION = 1;

  const REQUIRED_ROW_FIELDS = [
    'uf_sigla', 'municipio_codigo', 'questionario', 'situacao', 'from_ts', 'until_ts',
  ];
  const REQUIRED_RUN_FIELDS = ['run_ts'];

  const getAllRows = DB.getAll;
  const getAllRuns = DB.getRuns;
  const rowNaturalKey = DBMOD.rowNaturalKey;

  function runNaturalKey(run) {
    return String(run.run_ts);
  }

  // Status counts for the page: how many runs, how many history rows,
  // which UFs are present (with a row count each), and the first/last
  // reading dates. Pure aggregation over what getAllRows/getAllRuns
  // already returned — kept as one function so "Status" and "what Clear
  // is about to delete" can never disagree about what is actually there.
  function summarize(rows, runs) {
    const ufCounts = new Map();
    for (const r of rows) {
      const uf = r.uf_sigla ?? '(sem UF)';
      ufCounts.set(uf, (ufCounts.get(uf) || 0) + 1);
    }
    const runTimestamps = runs.map((r) => r.run_ts).filter(Boolean).sort();
    return {
      nRuns: runs.length,
      nRows: rows.length,
      ufCounts: [...ufCounts.entries()]
        .map(([uf, n]) => ({ uf, n }))
        .sort((a, b) => a.uf.localeCompare(b.uf)),
      firstReading: runTimestamps.length ? runTimestamps[0] : null,
      lastReading: runTimestamps.length ? runTimestamps[runTimestamps.length - 1] : null,
    };
  }

  async function getStatus() {
    const [rows, runs] = await Promise.all([getAllRows(), getAllRuns()]);
    return summarize(rows, runs);
  }

  // Byte-identical to situacao-export.js's snapshotJson(allRows, runs):
  // same field order, same JSON.stringify(..., null, 2) call, same
  // version number. situacao-export.js cannot be loaded here without
  // also loading munic-common.js and situacao-aggregate.js (it destructures
  // both off `window` at load time for its OTHER exports, denormalizedCsv
  // and stateChangeCsv, which this page has no use for) — pulling in the
  // MAIN-world/report-oriented common helpers into an options page that
  // has nothing to do with the portal would be a strange dependency for
  // one pure function. The shape is small and stable (see
  // tests/situacao-export.test.js and tests/options-store.test.js, which
  // both pin it), so it is reproduced here instead.
  function snapshotJson(allRows, runs) {
    return JSON.stringify({
      version: SNAPSHOT_VERSION,
      exported_at: new Date().toISOString(),
      rows: allRows,
      runs,
    }, null, 2);
  }

  async function exportSnapshotJson() {
    const [rows, runs] = await Promise.all([getAllRows(), getAllRuns()]);
    return snapshotJson(rows, runs);
  }

  // Validates that `parsed` looks like a snapshot this page can import,
  // naming exactly what is wrong rather than failing generically. Returns
  // a list of problem strings; empty means valid. Never throws.
  function validateSnapshot(parsed) {
    const problems = [];
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push('o arquivo não contém um objeto JSON de backup.');
      return problems; // nothing else can be checked meaningfully
    }
    if (!Array.isArray(parsed.rows)) {
      problems.push('campo "rows" ausente ou não é uma lista.');
    }
    if (!Array.isArray(parsed.runs)) {
      problems.push('campo "runs" ausente ou não é uma lista.');
    }
    if (Array.isArray(parsed.rows)) {
      parsed.rows.forEach((row, i) => {
        if (row === null || typeof row !== 'object') {
          problems.push(`rows[${i}] não é um objeto.`);
          return;
        }
        for (const f of REQUIRED_ROW_FIELDS) {
          if (!(f in row)) problems.push(`rows[${i}] não tem o campo "${f}".`);
        }
      });
    }
    if (Array.isArray(parsed.runs)) {
      parsed.runs.forEach((run, i) => {
        if (run === null || typeof run !== 'object') {
          problems.push(`runs[${i}] não é um objeto.`);
          return;
        }
        for (const f of REQUIRED_RUN_FIELDS) {
          if (!(f in run)) problems.push(`runs[${i}] não tem o campo "${f}".`);
        }
      });
    }
    return problems;
  }

  // Public entry point: parses, validates, and only then writes. A
  // malformed file throws before mergeSnapshot ever opens a transaction,
  // so nothing is written for an invalid file — not even a partial
  // import of its valid-looking rows.
  async function importSnapshotJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`arquivo não é um JSON válido: ${err.message}`);
    }
    const problems = validateSnapshot(parsed);
    if (problems.length > 0) {
      throw new Error(`arquivo de backup inválido: ${problems.join(' ')}`);
    }
    return DB.mergeSnapshot(parsed);
  }

  window.__municProSituacaoOptionsStore = {
    getStatus,
    exportSnapshotJson,
    importSnapshotJson,
    clearAll: DB.clearAll,
    // Exposed for tests only.
    snapshotJson,
    validateSnapshot,
    rowNaturalKey,
    runNaturalKey,
    openDb: DB.openDb,
  };
})();
