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
