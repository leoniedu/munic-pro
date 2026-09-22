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
