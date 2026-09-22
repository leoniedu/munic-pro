// Storage logic for the options page.
//
// The options page runs as an ordinary extension page (chrome-extension://
// origin, opened via options_ui) — the SAME origin situacao-bridge.js
// stores the database in. Unlike the MAIN/ISOLATED content-script split,
// there is no portal page here and no F5 rewriter to work around, so this
// file opens indexedDB directly rather than going through the DOM-attribute
// RPC: there is only one JS realm involved, and nothing to bridge to.
//
// This is a THIRD place that touches storage, alongside situacao-bridge.js
// (the content-script ISOLATED-world owner). Both open the same database
// (same name, same version, same store shapes) because they are two
// different doors into the one history — a content-script tab and an
// options tab, open at the same time, must see the same data. IndexedDB
// itself serialises concurrent writers via its transaction model, so two
// tabs racing a save and an import is safe, just not something this file
// needs to special-case.
//
// This directory is storage-sanctioned by scripts/check-network.sh; the
// options page's OWN files (extension/options/) are not, and must call
// into this module rather than touching indexedDB themselves — the same
// separation the content-script split already keeps between "owns the
// database" and "renders UI".
(function () {
  'use strict';

  if (window.__municProSituacaoOptionsStore) return;

  const DB_NAME = 'munic-pro';
  const DB_VERSION = 1;
  const STORE_SITUACAO = 'situacao';
  const STORE_RUNS = 'runs';

  // Snapshot format version. Matches situacao-export.js's snapshotJson
  // exactly — a backup made from the panel and one made from this page
  // must be interchangeable, so this is not an independent choice.
  const SNAPSHOT_VERSION = 1;

  const REQUIRED_ROW_FIELDS = [
    'uf_sigla', 'municipio_codigo', 'questionario', 'situacao', 'from_ts', 'until_ts',
  ];
  const REQUIRED_RUN_FIELDS = ['run_ts'];

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

  // Schema kept identical to situacao-bridge.js's openDb(): both files
  // open the SAME database, so an upgrade path defined in only one of
  // them would leave the other looking at a store that was never
  // created, whichever one happens to run first on a fresh profile.
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SITUACAO)) {
          const s = db.createObjectStore(STORE_SITUACAO, {
            keyPath: 'id',
            autoIncrement: true,
          });
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

  async function getAllRows() {
    const db = await openDb();
    const tx = db.transaction(STORE_SITUACAO, 'readonly');
    const rows = await promisify(tx.objectStore(STORE_SITUACAO).getAll());
    db.close();
    return rows;
  }

  async function getAllRuns() {
    const db = await openDb();
    const tx = db.transaction(STORE_RUNS, 'readonly');
    const runs = await promisify(tx.objectStore(STORE_RUNS).getAll());
    db.close();
    return runs.sort((a, b) => String(a.run_ts).localeCompare(String(b.run_ts)));
  }

  // The natural key for a history row: what makes two rows (whether from
  // two different imports, or an import against what is already stored)
  // "the same fact". Deliberately excludes `id` (an autoIncrement local
  // primary key, meaningless across databases) and `until_ts` (a row's
  // end date can be back-filled later without it becoming a different
  // fact) — only the fields that identify WHEN a state began.
  function rowNaturalKey(row) {
    return `${row.uf_sigla}|${row.municipio_codigo}|${row.questionario}|${row.from_ts}`;
  }

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

  // Merges a validated snapshot into the store: rows and runs already
  // present (matched by natural key) are skipped, so importing the same
  // file twice is a no-op the second time. Runs in ONE readwrite
  // transaction — a validation failure never reaches this function at
  // all (see importSnapshotJson below), and any failure inside the
  // transaction aborts it, so a partial import cannot commit.
  async function mergeSnapshot(parsed) {
    const db = await openDb();
    const tx = db.transaction([STORE_SITUACAO, STORE_RUNS], 'readwrite');
    const situacao = tx.objectStore(STORE_SITUACAO);
    const runs = tx.objectStore(STORE_RUNS);

    const existingRows = await promisify(situacao.getAll());
    const existingRunTs = new Set(
      (await promisify(runs.getAll())).map(runNaturalKey),
    );
    const existingRowKeys = new Set(existingRows.map(rowNaturalKey));

    let rowsAdded = 0;
    let rowsSkipped = 0;
    for (const row of parsed.rows) {
      const key = rowNaturalKey(row);
      if (existingRowKeys.has(key)) {
        rowsSkipped += 1;
        continue;
      }
      existingRowKeys.add(key); // guards duplicates WITHIN the same file
      // Drop any incoming `id` / `open_key`: `id` is a foreign
      // autoIncrement key that must not collide with this database's own
      // sequence, and `open_key` (the unique index used to find the
      // currently-open row per business key) must be recomputed here
      // rather than trusted from the file, so a future saveSnapshot()
      // still finds exactly one open row per key.
      const { id, open_key, ...rest } = row;
      const toAdd = rest.until_ts === null
        ? { ...rest, open_key: `${rest.uf_sigla}|${rest.municipio_codigo}|${rest.questionario}` }
        : rest;
      situacao.add(toAdd);
      rowsAdded += 1;
    }

    let runsAdded = 0;
    let runsSkipped = 0;
    for (const run of parsed.runs) {
      const key = runNaturalKey(run);
      if (existingRunTs.has(key)) {
        runsSkipped += 1;
        continue;
      }
      existingRunTs.add(key);
      runs.put(run);
      runsAdded += 1;
    }

    await txDone(tx);
    db.close();
    return { rowsAdded, rowsSkipped, runsAdded, runsSkipped };
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
    return mergeSnapshot(parsed);
  }

  async function clearAll() {
    const db = await openDb();
    const tx = db.transaction([STORE_SITUACAO, STORE_RUNS], 'readwrite');
    tx.objectStore(STORE_SITUACAO).clear();
    tx.objectStore(STORE_RUNS).clear();
    await txDone(tx);
    db.close();
  }

  window.__municProSituacaoOptionsStore = {
    getStatus,
    exportSnapshotJson,
    importSnapshotJson,
    clearAll,
    // Exposed for tests only.
    snapshotJson,
    validateSnapshot,
    rowNaturalKey,
    runNaturalKey,
    openDb,
  };
})();
