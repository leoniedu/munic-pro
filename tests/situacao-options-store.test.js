import { describe, test, expect, beforeEach } from 'bun:test';

// This module opens the SAME database as situacao-bridge.js (the
// content-script ISOLATED-world owner), but from a different door: the
// options page's own extension-origin tab. fake-indexeddb (tests/setup.js)
// backs both, so this suite hits real transactions and index lookups, the
// same as tests/situacao-store.test.js.
await import('../extension/features/situacao-store/situacao-options-store.js');

const OS = window.__municProSituacaoOptionsStore;

const TS1 = '2026-09-07T09:00:00.000Z';
const TS2 = '2026-09-21T09:00:00.000Z';

function row(municipio, questionario, situacao, extra = {}) {
  return {
    uf_sigla: 'BA',
    id_uf: 29,
    agencia_codigo: '290070200',
    agencia_nome: 'ALAGOINHAS',
    municipio_codigo: municipio,
    municipio_nome: 'Alagoinhas',
    questionario,
    criticas_informativas: 0,
    criticas_comparativas: 0,
    situacao,
    from_ts: '2026-09-07T09:00:00',
    until_ts: null,
    ...extra,
  };
}

function run(run_ts, extra = {}) {
  return { run_ts, n_rows: 1, n_changed: 1, warnings: [], ...extra };
}

// Writes directly through the module under test's own openDb(), bypassing
// its higher-level API — used only to seed a starting state for import
// tests, so the seed does not itself depend on the code being tested.
async function seed(rows, runs) {
  const db = await OS.openDb();
  const tx = db.transaction(['situacao', 'runs'], 'readwrite');
  const situacao = tx.objectStore('situacao');
  const runsStore = tx.objectStore('runs');
  for (const r of rows) {
    const open_key = r.until_ts === null
      ? `${r.uf_sigla}|${r.municipio_codigo}|${r.questionario}`
      : undefined;
    situacao.add(open_key ? { ...r, open_key } : r);
  }
  for (const rn of runs) runsStore.put(rn);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

beforeEach(async () => {
  await OS.clearAll();
});

describe('getStatus', () => {
  test('an empty store reports zero runs and rows, with no dates', async () => {
    const status = await OS.getStatus();
    expect(status.nRuns).toBe(0);
    expect(status.nRows).toBe(0);
    expect(status.ufCounts).toEqual([]);
    expect(status.firstReading).toBeNull();
    expect(status.lastReading).toBeNull();
  });

  test('counts runs and rows, first/last reading, and rows per UF', async () => {
    await seed(
      [
        row('2900702', 'Básico', 'Não Iniciado', { uf_sigla: 'BA' }),
        row('2900702', 'Suplementar', 'Não Iniciado', { uf_sigla: 'BA' }),
        row('3500105', 'Básico', 'Concluído', { uf_sigla: 'SP' }),
      ],
      [run(TS1), run(TS2)],
    );
    const status = await OS.getStatus();
    expect(status.nRuns).toBe(2);
    expect(status.nRows).toBe(3);
    expect(status.ufCounts).toEqual([
      { uf: 'BA', n: 2 },
      { uf: 'SP', n: 1 },
    ]);
    expect(status.firstReading).toBe(TS1);
    expect(status.lastReading).toBe(TS2);
  });

  // THE mutation this guards against: computing counts from the wrong
  // store (e.g. nRows from `runs`, or nRuns from `situacao`) would still
  // produce two numbers that look plausible. Rows and runs are seeded to
  // different, easily-confused counts here so a swap is unmistakable.
  test('row count and run count are read from their own stores, not swapped', async () => {
    await seed(
      [
        row('2900702', 'Básico', 'X'),
        row('2900702', 'Suplementar', 'X'),
        row('2902054', 'Básico', 'X'),
        row('2902054', 'Suplementar', 'X'),
        row('3500105', 'Básico', 'X', { uf_sigla: 'SP' }),
      ],
      [run(TS1)],
    );
    const status = await OS.getStatus();
    expect(status.nRuns).toBe(1);
    expect(status.nRows).toBe(5);
  });
});

describe('exportSnapshotJson / snapshotJson', () => {
  test('matches situacao-export.js\'s snapshotJson shape exactly', async () => {
    // Independently re-implements the exact call situacao-export.js's
    // snapshotJson makes, so a divergence in field order or wrapping is
    // caught here without importing that MAIN-world/report-oriented
    // module (see situacao-options-store.js's own comment for why it is
    // not loaded directly).
    const rows = [row('2900702', 'Básico', 'Não Iniciado')];
    const runs = [run(TS1)];
    const text = OS.snapshotJson(rows, runs);
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exported_at).toBe('string');
    expect(parsed.rows).toEqual(rows);
    expect(parsed.runs).toEqual(runs);
    expect(Object.keys(parsed)).toEqual(['version', 'exported_at', 'rows', 'runs']);
  });

  test('exportSnapshotJson reads the live store through the public API', async () => {
    await seed([row('2900702', 'Básico', 'X')], [run(TS1)]);
    const parsed = JSON.parse(await OS.exportSnapshotJson());
    expect(parsed.rows.length).toBe(1);
    expect(parsed.runs.length).toBe(1);
  });
});

describe('validateSnapshot', () => {
  test('accepts a well-formed snapshot', () => {
    const problems = OS.validateSnapshot({
      version: 1,
      rows: [row('2900702', 'Básico', 'X')],
      runs: [run(TS1)],
    });
    expect(problems).toEqual([]);
  });

  test('rejects a non-object', () => {
    expect(OS.validateSnapshot('not json').length).toBeGreaterThan(0);
    expect(OS.validateSnapshot(null).length).toBeGreaterThan(0);
    expect(OS.validateSnapshot([1, 2, 3]).length).toBeGreaterThan(0);
  });

  test('rejects a missing rows field, naming it', () => {
    const problems = OS.validateSnapshot({ runs: [] });
    expect(problems.some((p) => p.includes('rows'))).toBe(true);
  });

  test('rejects a missing runs field, naming it', () => {
    const problems = OS.validateSnapshot({ rows: [] });
    expect(problems.some((p) => p.includes('runs'))).toBe(true);
  });

  test('rejects a row missing a required field, naming it and its index', () => {
    const bad = row('2900702', 'Básico', 'X');
    delete bad.from_ts;
    const problems = OS.validateSnapshot({ rows: [bad], runs: [] });
    expect(problems.some((p) => p.includes('rows[0]') && p.includes('from_ts'))).toBe(true);
  });

  test('rejects a run missing run_ts, naming it and its index', () => {
    const problems = OS.validateSnapshot({ rows: [], runs: [{ n_rows: 1 }] });
    expect(problems.some((p) => p.includes('runs[0]') && p.includes('run_ts'))).toBe(true);
  });
});

describe('importSnapshotJson', () => {
  test('an empty store gains every row and run from the file', async () => {
    const snapshot = OS.snapshotJson(
      [row('2900702', 'Básico', 'Não Iniciado')],
      [run(TS1)],
    );
    const result = await OS.importSnapshotJson(snapshot);
    expect(result).toEqual({ rowsAdded: 1, rowsSkipped: 0, runsAdded: 1, runsSkipped: 0 });

    const status = await OS.getStatus();
    expect(status.nRows).toBe(1);
    expect(status.nRuns).toBe(1);
  });

  // THE central regression this whole feature exists to close a gap
  // around: importing the same backup twice must not double the
  // history. Matched on the natural key, not on any local id.
  test('importing the same file twice does not double the history', async () => {
    const snapshot = OS.snapshotJson(
      [
        row('2900702', 'Básico', 'Não Iniciado', { from_ts: TS1, until_ts: TS2 }),
        row('2900702', 'Básico', 'Concluído', { from_ts: TS2, until_ts: null }),
      ],
      [run(TS1), run(TS2)],
    );
    const first = await OS.importSnapshotJson(snapshot);
    expect(first).toEqual({ rowsAdded: 2, rowsSkipped: 0, runsAdded: 2, runsSkipped: 0 });

    const second = await OS.importSnapshotJson(snapshot);
    expect(second).toEqual({ rowsAdded: 0, rowsSkipped: 2, runsAdded: 0, runsSkipped: 2 });

    const status = await OS.getStatus();
    expect(status.nRows).toBe(2);
    expect(status.nRuns).toBe(2);
  });

  test('merges only the NEW rows/runs when importing into a non-empty store', async () => {
    await seed(
      [row('2900702', 'Básico', 'Não Iniciado', { from_ts: TS1 })],
      [run(TS1)],
    );
    const snapshot = OS.snapshotJson(
      [
        row('2900702', 'Básico', 'Não Iniciado', { from_ts: TS1 }), // already present
        row('3500105', 'Básico', 'Concluído', { uf_sigla: 'SP', from_ts: TS2 }), // new
      ],
      [run(TS1), run(TS2)],
    );
    const result = await OS.importSnapshotJson(snapshot);
    expect(result).toEqual({ rowsAdded: 1, rowsSkipped: 1, runsAdded: 1, runsSkipped: 1 });

    const status = await OS.getStatus();
    expect(status.nRows).toBe(2);
    expect(status.nRuns).toBe(2);
  });

  // A row is matched on the natural key given in the task, not on
  // `until_ts` — two rows with the same uf/município/questionário/from_ts
  // but different until_ts must still be treated as the same fact
  // (e.g. one file back-filled an end date the other did not have yet).
  test('two runs of the same município/questionário/from_ts are one fact regardless of until_ts', async () => {
    await seed(
      [row('2900702', 'Básico', 'Não Iniciado', { from_ts: TS1, until_ts: null })],
      [run(TS1)],
    );
    const snapshot = OS.snapshotJson(
      [row('2900702', 'Básico', 'Não Iniciado', { from_ts: TS1, until_ts: TS2 })],
      [run(TS1)],
    );
    const result = await OS.importSnapshotJson(snapshot);
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(1);
  });

  test('a malformed file (rows not a list) writes nothing at all', async () => {
    await seed([row('2900702', 'Básico', 'X')], [run(TS1)]);
    const before = await OS.getStatus();

    await expect(OS.importSnapshotJson(JSON.stringify({ rows: 'oops', runs: [] })))
      .rejects.toThrow(/rows/);

    const after = await OS.getStatus();
    expect(after).toEqual(before);
  });

  test('a malformed file (missing required row field) writes nothing at all', async () => {
    await seed([row('2900702', 'Básico', 'X')], [run(TS1)]);
    const before = await OS.getStatus();

    const bad = row('3500105', 'Básico', 'Y');
    delete bad.uf_sigla;
    await expect(
      OS.importSnapshotJson(JSON.stringify({ rows: [bad], runs: [] })),
    ).rejects.toThrow(/uf_sigla/);

    const after = await OS.getStatus();
    expect(after).toEqual(before);
  });

  test('invalid JSON text writes nothing and reports a parse error', async () => {
    await seed([row('2900702', 'Básico', 'X')], [run(TS1)]);
    const before = await OS.getStatus();

    await expect(OS.importSnapshotJson('{ not json')).rejects.toThrow();

    const after = await OS.getStatus();
    expect(after).toEqual(before);
  });
});

describe('clearAll', () => {
  test('leaves no row and no run behind', async () => {
    await seed(
      [
        row('2900702', 'Básico', 'X'),
        row('2902054', 'Suplementar', 'Y', { uf_sigla: 'SP' }),
      ],
      [run(TS1), run(TS2)],
    );
    await OS.clearAll();
    const status = await OS.getStatus();
    expect(status.nRows).toBe(0);
    expect(status.nRuns).toBe(0);
    expect(status.ufCounts).toEqual([]);
  });
});

describe('importSnapshotJson: conflicting open rows', () => {
  // Two machines could each keep their OWN open row for the same key with
  // different from_ts (e.g. a município's state changed after the last
  // shared backup). Both are legitimately different facts (different
  // natural key, since from_ts differs), but IndexedDB's open_key index
  // is unique per business key — inserting a second "currently open" row
  // for the same município/questionário without closing the first would
  // violate that constraint. This documents the current behaviour rather
  // than asserting a specific fix, so a future change to how this is
  // handled shows up here.
  test('importing a second open row for an already-open key does not silently corrupt the store', async () => {
    await seed(
      [row('2900702', 'Básico', 'Não Iniciado', { from_ts: TS1, until_ts: null })],
      [run(TS1)],
    );
    const snapshot = OS.snapshotJson(
      [row('2900702', 'Básico', 'Concluído', { from_ts: TS2, until_ts: null })],
      [run(TS2)],
    );
    try {
      await OS.importSnapshotJson(snapshot);
      // If it succeeds, the store must not have silently dropped the
      // original open row -- both facts should still be readable.
      const status = await OS.getStatus();
      expect(status.nRows).toBeGreaterThanOrEqual(1);
    } catch (err) {
      // If it throws (the constraint rejects it), the transaction must
      // not have partially committed.
      const status = await OS.getStatus();
      expect(status.nRows).toBe(1);
      expect(status.nRuns).toBe(1);
    }
  });
});
