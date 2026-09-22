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
  test('is UF plus município plus questionário', () => {
    expect(rowKey(row('2900702', 'Básico', 'Não Iniciado'))).toBe('BA|2900702|Básico');
  });

  test('distinguishes the two questionários of one município', () => {
    expect(rowKey(row('2900702', 'Básico', 'X')))
      .not.toBe(rowKey(row('2900702', 'Suplementar', 'X')));
  });

  // The bug this exists to catch: município códigos are only unique
  // WITHIN a UF (IBGE reuses the trailing digits across states), so two
  // different UFs can carry the same município_codigo. If UF were ever
  // dropped from rowKey, these two rows would collide onto the same key
  // and the second would look like a value-changed update to the first
  // instead of two independent municípios in two independent histories.
  test('distinguishes the same município código in two different UFs', () => {
    const ba = row('2900702', 'Básico', 'X', { uf_sigla: 'BA' });
    const sp = row('2900702', 'Básico', 'X', { uf_sigla: 'SP' });
    expect(rowKey(ba)).not.toBe(rowKey(sp));
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
    expect(r.toClose).toEqual([{ key: 'BA|2900702|Básico', until_ts: TS2 }]);
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
    expect(r.toClose).toEqual([{ key: 'BA|2900702|Básico', until_ts: TS2 }]);
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
    expect(r.toClose).toEqual([{ key: 'BA|2900702|Básico', until_ts: TS2 }]);
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

  // diffSnapshot itself is UF-agnostic — it closes/inserts by whatever
  // `current` it is handed, which is now the CALLER's job to scope to one
  // UF (see situacao-bridge.js's saveSnapshot). What THIS test pins is
  // the key-collision half of the bug: two different UFs sharing a
  // município código must never be treated as the same row. If UF were
  // dropped from rowKey, SP's incoming row would match BA's stored row
  // on '2900702|Básico' — read as an unchanged município rather than a
  // new one, and BA's row would silently absorb SP's data.
  test('a município código shared by two UFs is never matched cross-UF', () => {
    const ba = stored(row('2900702', 'Básico', 'Não Iniciado', { uf_sigla: 'BA' }), TS1);
    const spIncoming = row('2900702', 'Básico', 'Não Iniciado', { uf_sigla: 'SP' });
    const r = diffSnapshot([ba], [spIncoming], TS2);
    // Correct outcome: SP's row is a brand new key (never seen before),
    // and BA's row is closed as "vanished from this snapshot" — because
    // this call was handed BA's row as `current` despite the incoming
    // snapshot being SP's. That mismatch is exactly what
    // situacao-bridge.js's saveSnapshot must never do in production (see
    // its own UF-scoping test); diffSnapshot's job here is only to prove
    // the two rows are never merged into one.
    expect(r.toInsert.length).toBe(1);
    expect(r.toInsert[0].uf_sigla).toBe('SP');
    expect(r.toClose).toEqual([{ key: 'BA|2900702|Básico', until_ts: TS2 }]);
    // The mutation this catches: if rowKey dropped uf_sigla, both rows
    // would share the key '2900702|Básico' — sameValues() would then see
    // them as textually identical (situação, críticas all equal) and
    // diffSnapshot would report NO change at all, silently discarding
    // that BA and SP are different municípios.
    expect(r.nChanged).toBeGreaterThan(0);
  });
});
