// ISOLATED-world owner of the IndexedDB history.
//
// The content script runs in the MAIN world (situacao-report.js reads the
// page's own jQuery/DataTables, situacao-fetch.js reuses the page's
// authenticated session) — which means indexedDB.open() there opens a
// database on the PAGE's origin, not the extension's. Three matched hosts
// then mean up to three separate, silently diverging histories, and
// clearing site data for the page (the standard fix for an F5 login loop)
// destroys the history along with it.
//
// This script is the fix: it runs in the ISOLATED world (the extension's
// own origin) and is the ONLY place IndexedDB is touched. The MAIN-world
// situacao-store.js keeps the same public API, but every call is now a
// window.postMessage request answered here.
//
// This directory is storage-sanctioned by scripts/check-network.sh and
// must never touch the network — no fetching of any kind belongs here.
(function () {
  'use strict';

  if (window.__municProSituacaoBridge) return;

  const { diffSnapshot, rowKey } = window.__municProSituacaoDiff;

  const DB_NAME = 'munic-pro';
  const DB_VERSION = 1;
  const STORE_SITUACAO = 'situacao';
  const STORE_RUNS = 'runs';

  // Message channel contract with situacao-store.js (MAIN world):
  //   request:  { source: 'munic-pro-main', id, method, args }
  //   response: { source: 'munic-pro-isolated', id, result } or { ..., error }
  //
  // Origin-checked on both ends (window.postMessage(..., location.origin)
  // and a matching event.origin check here) so no other frame or page
  // script can drive this database.
  const SOURCE_MAIN = 'munic-pro-main';
  const SOURCE_ISOLATED = 'munic-pro-isolated';

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
          // Auto-increment: one município+questionário+UF has MANY rows
          // over time (one per state), so the key cannot be the business
          // key.
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

    // Scoped to the incoming snapshot's OWN UF: diffSnapshot must never
    // be shown another UF's open rows as "current", or every município
    // of the previous UF would be closed as "vanished" the moment the
    // page's UF dropdown changes and a different UF is fetched — the
    // exact corruption UF-in-the-key exists to prevent. rowKey already
    // includes uf_sigla, so cross-UF keys never collide, but that alone
    // does not stop THIS diff call from seeing rows it has no business
    // comparing against.
    const ufAtual = rows.length ? rows[0].uf_sigla : null;
    const stored = await promisify(situacao.getAll());
    const current = stored.filter((r) =>
      r.until_ts === null && (ufAtual === null || r.uf_sigla === ufAtual));

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

    // uf_sigla/id_uf are not part of VALUE_FIELDS (they are part of the
    // key, not a mutable value), so they are not diffed here, only carried
    // onto the run record — a run is always for exactly one UF, since the
    // fetch layer reads the page's #IdUf select and posts one UF per
    // request.
    runs.put({
      run_ts: runTs,
      n_rows: rows.length,
      n_changed: nChanged,
      warnings: warnings || [],
      uf_sigla: rows.length ? rows[0].uf_sigla : null,
      id_uf: rows.length ? rows[0].id_uf ?? null : null,
    });

    await txDone(tx);
    db.close();
    return { nChanged, nRows: rows.length };
  }

  // openDb is deliberately NOT in the RPC table: an IDBDatabase handle
  // cannot cross postMessage's structured-clone boundary, and nothing on
  // the MAIN side needs the handle itself — only the operations below.
  const METHODS = { saveSnapshot, getCurrent, getAll, getRuns, clearAll };

  window.addEventListener('message', (event) => {
    // Same-origin only: the extension's own MAIN-world script posts with
    // location.origin as the target, and a legitimate request always
    // arrives with that same origin as its source.
    if (event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== SOURCE_MAIN) return;

    const { id, method, args } = msg;
    const fn = METHODS[method];
    if (typeof fn !== 'function') {
      window.postMessage(
        { source: SOURCE_ISOLATED, id, error: `Método desconhecido: ${method}` },
        location.origin,
      );
      return;
    }

    Promise.resolve()
      .then(() => fn(...(args || [])))
      .then((result) => {
        window.postMessage({ source: SOURCE_ISOLATED, id, result }, location.origin);
      })
      .catch((err) => {
        window.postMessage(
          { source: SOURCE_ISOLATED, id, error: String((err && err.message) || err) },
          location.origin,
        );
      });
  });

  // Exposed only for the ISOLATED-world test suite, which exercises the
  // real IndexedDB logic directly rather than through postMessage.
  window.__municProSituacaoBridge = {
    ...METHODS, openDb, SOURCE_MAIN, SOURCE_ISOLATED,
  };
})();
