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
