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

  if (globalThis.__municProSituacaoDiff) return;

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
  //
  // UF is also part of the key: município_codigo is only unique WITHIN a
  // UF (IBGE códigos share digits across states), and changing the page's
  // UF dropdown before refetching must not read as "every município of
  // the previous UF vanished". Each UF keeps its own independent history;
  // someone with access to several UFs simply accumulates all of them.
  function rowKey(row) {
    return `${row.uf_sigla}|${row.municipio_codigo}|${row.questionario}`;
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

  globalThis.__municProSituacaoDiff = { diffSnapshot, rowKey, VALUE_FIELDS };
})();
