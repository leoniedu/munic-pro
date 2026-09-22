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

describe('situacaoRec', () => {
  // Ports the 2025 R recode (R/report.R:22-25), but WITHOUT its
  // `.default = "Supervisão/Análise"` — that silently absorbed any
  // unrecognised status into a bucket it was never observed to belong
  // to. Here an unknown situação passes through raw and uncoloured.
  test('recodes the digitação variants into one bucket', () => {
    expect(A.situacaoRec('Dig. Informante')).toBe('Digitação/Validação');
    expect(A.situacaoRec('Dig. Ibge')).toBe('Digitação/Validação');
    expect(A.situacaoRec('Em Validação')).toBe('Digitação/Validação');
  });

  test('passes through Não Iniciado and Concluído unchanged', () => {
    expect(A.situacaoRec('Não Iniciado')).toBe('Não Iniciado');
    expect(A.situacaoRec('Concluído')).toBe('Concluído');
  });

  // The bug this avoids: an unrecognised raw value must NOT be folded
  // into "Supervisão/Análise" or any other bucket.
  test('an unknown situação passes through raw, not folded into a bucket', () => {
    expect(A.situacaoRec('Situação Nova')).toBe('Situação Nova');
  });

  test('null situação passes through as null', () => {
    expect(A.situacaoRec(null)).toBeNull();
  });
});

describe('municipioGrid', () => {
  const rows = [
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
      situacao: 'Não Iniciado', criticas_informativas: 51, criticas_comparativas: 20,
      from_ts: '2026-09-07T09:00:00', until_ts: '2026-09-21T09:00:00' },
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
      situacao: 'Dig. Ibge', criticas_informativas: 35, criticas_comparativas: 12,
      from_ts: '2026-09-21T09:00:00', until_ts: null },
    { municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS', questionario: 'Suplementar',
      situacao: 'Não Iniciado', criticas_informativas: 5, criticas_comparativas: 1,
      from_ts: '2026-09-07T09:00:00', until_ts: null },
  ];
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W39', run_ts: '2026-09-21T09:00:00' },
  ];

  test('three lines per município per questionário', () => {
    const grid = A.municipioGrid(rows, columns);
    // 2 questionários x 3 indicator rows = 6.
    expect(grid.length).toBe(6);
  });

  // The regression this fixes: críticas history was dropped entirely by
  // the old one-row-per-questionário shape. It must now appear, in the
  // Excel's order, on its own row keyed by `name`.
  test('the três rows appear in order with the right name values', () => {
    const grid = A.municipioGrid(rows, columns)
      .filter((g) => g.questionario === 'Básico');
    expect(grid.map((g) => g.name)).toEqual([
      'criticas_informativas', 'criticas_comparativas', 'situacao_rec',
    ]);
  });

  test('críticas counts land in the right cells, falling over time', () => {
    const grid = A.municipioGrid(rows, columns)
      .filter((g) => g.questionario === 'Básico');
    const informativas = grid.find((g) => g.name === 'criticas_informativas');
    expect(informativas.cells).toEqual([51, 35]);
    const comparativas = grid.find((g) => g.name === 'criticas_comparativas');
    expect(comparativas.cells).toEqual([20, 12]);
  });

  // The situacao_rec row holds the BUCKETED status, not the raw one —
  // this is where change #2 (the recode) surfaces in the grid.
  test('situacao_rec row holds the bucketed status', () => {
    const grid = A.municipioGrid(rows, columns)
      .filter((g) => g.questionario === 'Básico');
    const rec = grid.find((g) => g.name === 'situacao_rec');
    expect(rec.cells).toEqual(['Não Iniciado', 'Digitação/Validação']);
  });

  test('a questionário that never moved repeats its situação', () => {
    const grid = A.municipioGrid(rows, columns)
      .filter((g) => g.questionario === 'Suplementar' && g.name === 'situacao_rec');
    expect(grid[0].cells).toEqual(['Não Iniciado', 'Não Iniciado']);
  });

  test('an empty week column yields null cells in all three rows', () => {
    const cols = [...columns, { week: '2026-W40', run_ts: null }];
    const grid = A.municipioGrid(rows, cols)
      .filter((g) => g.questionario === 'Básico');
    for (const line of grid) expect(line.cells[2]).toBeNull();
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

    test('sorts by municipio_nome (pt-BR collation), questionario, then keeps the três rows adjacent', () => {
      const grid = A.municipioGrid(multi, columns);
      expect(grid.map((g) => [g.municipio_nome, g.questionario, g.name])).toEqual([
        ['Araçás', 'Básico', 'criticas_informativas'],
        ['Araçás', 'Básico', 'criticas_comparativas'],
        ['Araçás', 'Básico', 'situacao_rec'],
        ['Araçás', 'Suplementar', 'criticas_informativas'],
        ['Araçás', 'Suplementar', 'criticas_comparativas'],
        ['Araçás', 'Suplementar', 'situacao_rec'],
        ['Aramari', 'Básico', 'criticas_informativas'],
        ['Aramari', 'Básico', 'criticas_comparativas'],
        ['Aramari', 'Básico', 'situacao_rec'],
        ['Aramari', 'Suplementar', 'criticas_informativas'],
        ['Aramari', 'Suplementar', 'criticas_comparativas'],
        ['Aramari', 'Suplementar', 'situacao_rec'],
        ['Belmonte', 'Básico', 'criticas_informativas'],
        ['Belmonte', 'Básico', 'criticas_comparativas'],
        ['Belmonte', 'Básico', 'situacao_rec'],
        ['Belmonte', 'Suplementar', 'criticas_informativas'],
        ['Belmonte', 'Suplementar', 'criticas_comparativas'],
        ['Belmonte', 'Suplementar', 'situacao_rec'],
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

  // Change #2's other surface: groupCounts must bucket raw situações
  // before counting, so 'Dig. Ibge' and 'Dig. Informante' land in one
  // row instead of two.
  test('Dig. Ibge and Dig. Informante collapse into one Digitação/Validação row', () => {
    const raw = [
      { agencia_nome: 'A', situacao: 'Dig. Ibge' },
      { agencia_nome: 'A', situacao: 'Dig. Informante' },
      { agencia_nome: 'A', situacao: 'Em Validação' },
    ];
    const out = A.groupCounts(raw, ['agencia_nome']);
    const digitacao = out.filter((r) => r.situacao === 'Digitação/Validação');
    expect(digitacao.length).toBe(1);
    expect(digitacao[0].n).toBe(3);
  });

  test('an unknown situação passes through raw and uncoloured in the group tabs', () => {
    const raw = [{ agencia_nome: 'A', situacao: 'Situação Nova' }];
    const out = A.groupCounts(raw, ['agencia_nome']);
    expect(out[0].situacao).toBe('Situação Nova');
  });
});

describe('groupCountsByColumn', () => {
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W39', run_ts: '2026-09-21T09:00:00' },
  ];

  // A município moving from Não Iniciado to Dig. Ibge (bucketed:
  // Digitação/Validação) between the two runs — this is the fixture
  // that lets the test tell a per-column implementation apart from one
  // that just repeats the latest snapshot in every column.
  const allRows = [
    { municipio_codigo: '1', agencia_nome: 'A', situacao: 'Não Iniciado',
      from_ts: '2026-09-07T09:00:00', until_ts: '2026-09-21T09:00:00' },
    { municipio_codigo: '1', agencia_nome: 'A', situacao: 'Dig. Ibge',
      from_ts: '2026-09-21T09:00:00', until_ts: null },
    { municipio_codigo: '2', agencia_nome: 'A', situacao: 'Concluído',
      from_ts: '2026-09-07T09:00:00', until_ts: null },
  ];

  test('counts differ across date columns', () => {
    const out = A.groupCountsByColumn(allRows, ['agencia_nome'], columns);
    const naoIniciado = out.find((r) => r.group === 'A' && r.situacao === 'Não Iniciado');
    expect(naoIniciado.cells).toEqual([1, 0]);
    const digitacao = out.find((r) => r.group === 'A' && r.situacao === 'Digitação/Validação');
    expect(digitacao.cells).toEqual([0, 1]);
  });

  test('pctCells are within-group-within-column percentages', () => {
    const out = A.groupCountsByColumn(allRows, ['agencia_nome'], columns);
    const concluido = out.find((r) => r.group === 'A' && r.situacao === 'Concluído');
    // Concluído's município is present at both instants: 1 of 2 in
    // column 1 (Não Iniciado + Concluído open), 1 of 2 in column 2
    // (Digitação/Validação + Concluído open).
    expect(concluido.pctCells[0]).toBeCloseTo(0.5);
    expect(concluido.pctCells[1]).toBeCloseTo(0.5);
  });

  test('a null (gap) column yields null cells, not zero', () => {
    const cols = [...columns, { week: '2026-W40', run_ts: null }];
    const out = A.groupCountsByColumn(allRows, ['agencia_nome'], cols);
    for (const row of out) {
      expect(row.cells[2]).toBeNull();
      expect(row.pctCells[2]).toBeNull();
    }
  });
});
