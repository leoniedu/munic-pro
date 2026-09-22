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
