import { describe, test, expect } from 'bun:test';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-report/situacao-aggregate.js');

const A = window.__municProSituacaoAggregate;

describe('weekColumns', () => {
  // The 2025 R code picked, per ISO week, the snapshot whose weekday was
  // closest to the latest snapshot's weekday. That assumes near-daily
  // runs. The 2026 cadence is uncertain, so this takes the LAST run of
  // each week — well defined at any cadence.
  test('takes the last run of each ISO week', () => {
    const runs = [
      { run_ts: '2026-09-21T09:00:00' }, // Mon, W39
      { run_ts: '2026-09-23T09:00:00' }, // Wed, W39
      { run_ts: '2026-09-28T09:00:00' }, // Mon, W40
    ];
    expect(A.weekColumns(runs)).toEqual([
      { week: '2026-W39', run_ts: '2026-09-23T09:00:00' },
      { week: '2026-W40', run_ts: '2026-09-28T09:00:00' },
    ]);
  });

  test('a single run yields a single column', () => {
    expect(A.weekColumns([{ run_ts: '2026-09-22T10:00:00' }]))
      .toEqual([{ week: '2026-W39', run_ts: '2026-09-22T10:00:00' }]);
  });

  test('no runs yields no columns', () => {
    expect(A.weekColumns([])).toEqual([]);
  });

  // A skipped week must be visible as a gap, not silently closed up —
  // otherwise two non-adjacent weeks look consecutive.
  test('weeks with no run appear as empty columns', () => {
    const runs = [
      { run_ts: '2026-09-07T09:00:00' }, // W37
      { run_ts: '2026-09-21T09:00:00' }, // W39
    ];
    expect(A.weekColumns(runs)).toEqual([
      { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
      { week: '2026-W38', run_ts: null },
      { week: '2026-W39', run_ts: '2026-09-21T09:00:00' },
    ]);
  });

  test('handles a year boundary without inventing weeks', () => {
    const runs = [
      { run_ts: '2026-12-28T09:00:00' }, // 2026-W53
      { run_ts: '2027-01-04T09:00:00' }, // 2027-W01
    ];
    const cols = A.weekColumns(runs);
    expect(cols.map((c) => c.week)).toEqual(['2026-W53', '2027-W01']);
  });
});

describe('situacaoAsOf', () => {
  const rows = [
    { municipio_codigo: '1', questionario: 'Básico', situacao: 'Não Iniciado',
      from_ts: '2026-09-01T00:00:00', until_ts: '2026-09-15T00:00:00' },
    { municipio_codigo: '1', questionario: 'Básico', situacao: 'Dig. Ibge',
      from_ts: '2026-09-15T00:00:00', until_ts: null },
  ];

  test('returns the state open at that instant', () => {
    expect(A.situacaoAsOf(rows, '2026-09-10T00:00:00')[0].situacao)
      .toBe('Não Iniciado');
  });

  test('an open row is current at any later instant', () => {
    expect(A.situacaoAsOf(rows, '2026-09-20T00:00:00')[0].situacao)
      .toBe('Dig. Ibge');
  });

  // from_ts is inclusive, until_ts exclusive — otherwise a row would
  // appear twice at the exact instant of a change.
  test('the change instant belongs to the new row only', () => {
    const at = A.situacaoAsOf(rows, '2026-09-15T00:00:00');
    expect(at.length).toBe(1);
    expect(at[0].situacao).toBe('Dig. Ibge');
  });

  test('returns nothing before the first row opened', () => {
    expect(A.situacaoAsOf(rows, '2026-08-01T00:00:00')).toEqual([]);
  });
});

describe('municipioGrid', () => {
  const rows = [
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
      situacao: 'Não Iniciado',
      from_ts: '2026-09-07T09:00:00', until_ts: '2026-09-21T09:00:00' },
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
      situacao: 'Dig. Ibge',
      from_ts: '2026-09-21T09:00:00', until_ts: null },
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Suplementar',
      situacao: 'Não Iniciado',
      from_ts: '2026-09-07T09:00:00', until_ts: null },
  ];
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W39', run_ts: '2026-09-21T09:00:00' },
  ];

  test('one line per município per questionário', () => {
    const grid = A.municipioGrid(rows, columns);
    expect(grid.length).toBe(2);
    expect(grid.map((g) => g.questionario).sort())
      .toEqual(['Básico', 'Suplementar']);
  });

  test('cells hold the situação at each column instant', () => {
    const grid = A.municipioGrid(rows, columns);
    const basico = grid.find((g) => g.questionario === 'Básico');
    expect(basico.cells).toEqual(['Não Iniciado', 'Dig. Ibge']);
  });

  test('a questionário that never moved repeats its situação', () => {
    const grid = A.municipioGrid(rows, columns);
    const supl = grid.find((g) => g.questionario === 'Suplementar');
    expect(supl.cells).toEqual(['Não Iniciado', 'Não Iniciado']);
  });

  test('an empty week column yields null cells', () => {
    const cols = [...columns, { week: '2026-W40', run_ts: null }];
    const grid = A.municipioGrid(rows, cols);
    expect(grid[0].cells[2]).toBeNull();
  });

  // getAll() returns rows in insertion order, i.e. the earliest-inserted
  // (closed) row for a key comes first. Display names must come from the
  // row with the latest from_ts, not whichever row is encountered first —
  // otherwise a SIGC spelling correction never reaches the panel.
  test('display names come from the row with the latest from_ts, not the first row', () => {
    const renamed = [
      { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
        agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
        situacao: 'Não Iniciado',
        from_ts: '2026-09-07T09:00:00', until_ts: '2026-09-21T09:00:00' },
      { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas Corrigido',
        agencia_nome: 'ALAGOINHAS NOVA', questionario: 'Básico',
        situacao: 'Dig. Ibge',
        from_ts: '2026-09-21T09:00:00', until_ts: null },
    ];
    const grid = A.municipioGrid(renamed, columns);
    expect(grid[0].municipio_nome).toBe('Alagoinhas Corrigido');
    expect(grid[0].agencia_nome).toBe('ALAGOINHAS NOVA');
  });

  describe('sort order across multiple municípios', () => {
    // Three municípios across two agências, both questionários each.
    // Includes an accent-collation pair (Araçás vs Aramari) so the
    // 'pt-BR' locale argument in the comparator is load-bearing: a plain
    // codepoint compare would order 'Araçás' after 'Aramari' (ç > a).
    const multi = [];
    const add = (codigo, nome, agencia, questionario) => {
      multi.push({
        municipio_codigo: codigo, municipio_nome: nome, agencia_nome: agencia,
        questionario, situacao: 'Não Iniciado',
        from_ts: '2026-09-07T09:00:00', until_ts: null,
      });
    };
    add('1', 'Aramari', 'AG1', 'Básico');
    add('1', 'Aramari', 'AG1', 'Suplementar');
    add('2', 'Araçás', 'AG1', 'Básico');
    add('2', 'Araçás', 'AG1', 'Suplementar');
    add('3', 'Belmonte', 'AG2', 'Básico');
    add('3', 'Belmonte', 'AG2', 'Suplementar');

    test('sorts by municipio_nome (pt-BR collation) then questionario', () => {
      const grid = A.municipioGrid(multi, columns);
      expect(grid.map((g) => [g.municipio_nome, g.questionario])).toEqual([
        ['Araçás', 'Básico'],
        ['Araçás', 'Suplementar'],
        ['Aramari', 'Básico'],
        ['Aramari', 'Suplementar'],
        ['Belmonte', 'Básico'],
        ['Belmonte', 'Suplementar'],
      ]);
    });
  });
});

describe('groupCounts', () => {
  const rows = [
    { agencia_nome: 'A', situacao: 'Não Iniciado' },
    { agencia_nome: 'A', situacao: 'Não Iniciado' },
    { agencia_nome: 'A', situacao: 'Concluído' },
    { agencia_nome: 'B', situacao: 'Concluído' },
  ];

  test('counts by group and situação', () => {
    const out = A.groupCounts(rows, ['agencia_nome']);
    const a = out.filter((r) => r.group === 'A');
    expect(a.find((r) => r.situacao === 'Não Iniciado').n).toBe(2);
    expect(a.find((r) => r.situacao === 'Concluído').n).toBe(1);
  });

  test('percentages are within the group, not the whole', () => {
    const out = A.groupCounts(rows, ['agencia_nome']);
    const a = out.filter((r) => r.group === 'A');
    expect(a.find((r) => r.situacao === 'Não Iniciado').pct).toBeCloseTo(2 / 3);
    const b = out.filter((r) => r.group === 'B');
    expect(b.find((r) => r.situacao === 'Concluído').pct).toBeCloseTo(1);
  });

  test('each group sums to 100%', () => {
    const out = A.groupCounts(rows, ['agencia_nome']);
    for (const g of ['A', 'B']) {
      const total = out.filter((r) => r.group === g)
        .reduce((s, r) => s + r.pct, 0);
      expect(total).toBeCloseTo(1);
    }
  });

  test('joins multiple group fields', () => {
    const multi = [{ assistencia_nome: 'X', agencia_nome: 'A', situacao: 'Concluído' }];
    const out = A.groupCounts(multi, ['assistencia_nome', 'agencia_nome']);
    expect(out[0].group).toBe('X | A');
  });

  test('no rows yields no groups', () => {
    expect(A.groupCounts([], ['agencia_nome'])).toEqual([]);
  });
});
