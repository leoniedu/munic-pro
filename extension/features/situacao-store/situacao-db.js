// The history database itself: every IndexedDB operation, in one place.
//
// Where it runs decides whose database it is. Content scripts — MAIN and
// ISOLATED world alike — get the PORTAL's origin for IndexedDB, not the
// extension's; the extension's own origin is reachable only from its own
// pages and service worker. So the live history is opened by
// situacao-worker.js (service worker) and by the options page, both on
// the extension's origin, and therefore the same database. The ISOLATED
// bridge opens it on the portal's origin only to migrate what earlier
// versions left there (see situacao-bridge.js).
//
// criarDb(factory) binds every operation to one IDBFactory, which is how
// the bridge names the portal-origin database explicitly and how tests
// keep the two origins apart inside a single process.
//
// Written against globalThis rather than window: it also loads in the
// service worker, which has no window.
//
// This directory is storage-sanctioned by scripts/check-network.sh and
// must never touch the network.
(function () {
  'use strict';

  if (globalThis.__municProSituacaoDb) return;

  const DB_NAME = 'munic-pro';
  // 2 adds the prefs store (hidden panel columns).
  const DB_VERSION = 2;
  const STORE_SITUACAO = 'situacao';
  const STORE_RUNS = 'runs';
  const STORE_PREFS = 'prefs';

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

  // Same string as situacao-diff.js's rowKey(); repeated here so the
  // options page can merge without loading the diff module.
  function chaveAberta(row) {
    return `${row.uf_sigla}|${row.municipio_codigo}|${row.questionario}`;
  }

  // The natural key for a history row: what makes two rows (whether from
  // two different imports, or an import against what is already stored)
  // "the same fact". Deliberately excludes `id` (an autoIncrement local
  // primary key, meaningless across databases) and `until_ts` (a row's
  // end date can be back-filled later without it becoming a different
  // fact) — only the fields that identify WHEN a state began.
  function rowNaturalKey(row) {
    return `${chaveAberta(row)}|${row.from_ts}`;
  }

  function criarDb(factory) {
    function openDb() {
      return new Promise((resolve, reject) => {
        const req = factory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_SITUACAO)) {
            // Auto-increment: one município+questionário+UF has MANY rows
            // over time (one per state), so the key cannot be the
            // business key.
            const s = db.createObjectStore(STORE_SITUACAO, {
              keyPath: 'id',
              autoIncrement: true,
            });
            // Open rows are looked up on every save. IndexedDB cannot
            // index on null, so `open_key` holds the row key while the row
            // is current and is deleted when it closes — making this index
            // contain exactly the open rows.
            s.createIndex('open_key', 'open_key', { unique: true });
          }
          if (!db.objectStoreNames.contains(STORE_RUNS)) {
            db.createObjectStore(STORE_RUNS, { keyPath: 'run_ts' });
          }
          if (!db.objectStoreNames.contains(STORE_PREFS)) {
            db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function getAll() {
      const db = await openDb();
      const tx = db.transaction(STORE_SITUACAO, 'readonly');
      const rows = await promisify(tx.objectStore(STORE_SITUACAO).getAll());
      db.close();
      return rows;
    }

    async function getCurrent() {
      return (await getAll()).filter((r) => r.until_ts === null);
    }

    async function getRuns() {
      const db = await openDb();
      const tx = db.transaction(STORE_RUNS, 'readonly');
      const runs = await promisify(tx.objectStore(STORE_RUNS).getAll());
      db.close();
      return runs.sort((a, b) => String(a.run_ts).localeCompare(String(b.run_ts)));
    }

    // History only: a "clear history" must not also forget which columns
    // the colleague hid.
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
      const { diffSnapshot, rowKey } = globalThis.__municProSituacaoDiff;
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
      // key, not a mutable value), so they are not diffed here, only
      // carried onto the run record — a run is always for exactly one UF,
      // since the fetch layer reads the page's #IdUf select and posts one
      // UF per request.
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

    // Merges {rows, runs} into the store: rows and runs already present
    // (matched by natural key) are skipped, so merging the same data twice
    // is a no-op the second time. ONE readwrite transaction — any failure
    // aborts it, so a partial merge cannot commit.
    //
    // Two histories can each hold an OPEN row for the same município and
    // questionário, begun at different times — two portal hosts, or a
    // backup from another machine. Only one can stay open (the open_key
    // index is unique), so the one that began later wins, and the other
    // is closed at the moment the winner began. Without this, the second
    // host's migration or such an import failed outright.
    async function mergeSnapshot({ rows, runs: runsIn }) {
      const db = await openDb();
      const tx = db.transaction([STORE_SITUACAO, STORE_RUNS], 'readwrite');
      const situacao = tx.objectStore(STORE_SITUACAO);
      const runs = tx.objectStore(STORE_RUNS);

      const existingRows = await promisify(situacao.getAll());
      const existingRunTs = new Set(
        (await promisify(runs.getAll())).map((r) => String(r.run_ts)),
      );
      const existingRowKeys = new Set(existingRows.map(rowNaturalKey));
      const abertasExistentes = new Map(existingRows
        .filter((r) => r.until_ts === null)
        .map((r) => [chaveAberta(r), r]));

      // Drop any incoming `id` / `open_key`: `id` is a foreign
      // autoIncrement key that must not collide with this database's own
      // sequence, and `open_key` is recomputed below rather than trusted.
      let rowsSkipped = 0;
      const novas = [];
      for (const row of rows) {
        const key = rowNaturalKey(row);
        if (existingRowKeys.has(key)) {
          rowsSkipped += 1;
          continue;
        }
        existingRowKeys.add(key); // guards duplicates WITHIN the same data
        const { id, open_key, ...rest } = row;
        novas.push(rest);
      }

      // The latest-begun open row per key, across stored and incoming.
      const vencedora = new Map(
        [...abertasExistentes].map(([k, r]) => [k, r.from_ts]));
      for (const r of novas) {
        if (r.until_ts !== null) continue;
        const k = chaveAberta(r);
        if (!vencedora.has(k) || String(r.from_ts) > String(vencedora.get(k))) {
          vencedora.set(k, r.from_ts);
        }
      }

      for (const [k, r] of abertasExistentes) {
        const from = vencedora.get(k);
        if (from === r.from_ts) continue;
        const { open_key, ...rest } = r;
        situacao.put({ ...rest, until_ts: from });
      }

      // No two candidates share a from_ts: that would be the same natural
      // key, already skipped above.
      for (const r of novas) {
        if (r.until_ts !== null) {
          situacao.add(r);
          continue;
        }
        const k = chaveAberta(r);
        const from = vencedora.get(k);
        situacao.add(from === r.from_ts
          ? { ...r, open_key: k }
          : { ...r, until_ts: from });
      }

      let runsAdded = 0;
      let runsSkipped = 0;
      for (const run of runsIn) {
        const key = String(run.run_ts);
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
      return { rowsAdded: novas.length, rowsSkipped, runsAdded, runsSkipped };
    }

    async function getPref(key) {
      const db = await openDb();
      const tx = db.transaction(STORE_PREFS, 'readonly');
      const hit = await promisify(tx.objectStore(STORE_PREFS).get(key));
      db.close();
      return hit ? hit.value : null;
    }

    async function setPref(key, value) {
      const db = await openDb();
      const tx = db.transaction(STORE_PREFS, 'readwrite');
      tx.objectStore(STORE_PREFS).put({ key, value });
      await txDone(tx);
      db.close();
    }

    return {
      openDb, getAll, getCurrent, getRuns, clearAll, saveSnapshot,
      mergeSnapshot, getPref, setPref,
    };
  }

  // Deletes the whole database on `factory` — used once the bridge has
  // moved a portal-origin history into the extension's.
  function apagarBanco(factory) {
    return new Promise((resolve, reject) => {
      const req = factory.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('banco antigo em uso'));
    });
  }

  globalThis.__municProSituacaoDb = {
    criarDb, apagarBanco, rowNaturalKey, DB_NAME, DB_VERSION,
  };
})();
