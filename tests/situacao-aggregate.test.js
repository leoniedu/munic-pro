import { describe, test, expect } from 'bun:test';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-report/situacao-aggregate.js');

const A = window.__municProSituacaoAggregate;

describe('runColumns', () => {
  // One column per run that produced a change — replaces the old
  // ISO-week bucketing entirely. A run with n_changed 0 must be invisible
  // to the grid; it is still recorded in the runs table, just uncolumned.
  test('a run with changes yields a column', () => {
    const runs = [{ run_ts: '2026-09-21T09:00:00', n_changed: 3 }];
    expect(A.runColumns(runs)).toEqual([{ run_ts: '2026-09-21T09:00:00' }]);
  });

  // This is the mutation the test exists to catch: a no-change run must
  // add NO column. Asserted both by absence from the array and by exact
  // length, so a change to the filter predicate cannot pass silently.
  test('a run with n_changed 0 adds no column', () => {
    const runs = [
      { run_ts: '2026-09-07T09:00:00', n_changed: 2 },
      { run_ts: '2026-09-14T09:00:00', n_changed: 0 },
      { run_ts: '2026-09-21T09:00:00', n_changed: 1 },
    ];
    const cols = A.runColumns(runs);
    expect(cols.length).toBe(2);
    expect(cols.map((c) => c.run_ts)).toEqual([
      '2026-09-07T09:00:00', '2026-09-21T09:00:00',
    ]);
    expect(cols.some((c) => c.run_ts === '2026-09-14T09:00:00')).toBe(false);
  });

  test('every run with no changes yields no columns at all', () => {
    const runs = [
      { run_ts: '2026-09-07T09:00:00', n_changed: 0 },
      { run_ts: '2026-09-14T09:00:00', n_changed: 0 },
    ];
    expect(A.runColumns(runs)).toEqual([]);
  });

  test('no runs yields no columns', () => {
    expect(A.runColumns([])).toEqual([]);
  });

  // A run record with no n_changed field at all (defensive: older data,
  // or a caller that omitted it) is treated as no change, not as a change.
  test('a missing n_changed field is treated as no change', () => {
    expect(A.runColumns([{ run_ts: '2026-09-21T09:00:00' }])).toEqual([]);
  });

  // Columns keep run order — every run that changed something, in the
  // order the runs table returns them (ascending run_ts).
  test('preserves run order across a year boundary', () => {
    const runs = [
      { run_ts: '2026-12-28T09:00:00', n_changed: 1 },
      { run_ts: '2027-01-04T09:00:00', n_changed: 2 },
    ];
    expect(A.runColumns(runs).map((c) => c.run_ts)).toEqual([
      '2026-12-28T09:00:00', '2027-01-04T09:00:00',
    ]);
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
    { run_ts: '2026-09-07T09:00:00' },
    { run_ts: '2026-09-21T09:00:00' },
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

  // A column at a timestamp before the município's history opened (e.g. a
  // município added to the response later than another's first run)
  // still yields null cells, not a crash or a fabricated zero.
  test('a column before a row opened yields null cells', () => {
    const cols = [{ run_ts: '2026-01-01T00:00:00' }, ...columns];
    const grid = A.municipioGrid(rows, cols)
      .filter((g) => g.questionario === 'Básico');
    for (const line of grid) expect(line.cells[0]).toBeNull();
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
    { run_ts: '2026-09-07T09:00:00' },
    { run_ts: '2026-09-21T09:00:00' },
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

  // A column at a timestamp before any row opened yields zero counts (no
  // rows are open yet) rather than null — situacaoAsOf legitimately
  // returns an empty array, distinct from the "no column" case that
  // runColumns() now handles upstream by omitting no-change runs entirely.
  test('a column before any row opened yields zero counts, not null', () => {
    const cols = [{ run_ts: '2026-01-01T00:00:00' }, ...columns];
    const out = A.groupCountsByColumn(allRows, ['agencia_nome'], cols);
    for (const row of out) {
      expect(row.cells[0]).toBe(0);
      expect(row.pctCells[0]).toBeNull();
    }
  });
});

describe('selecionarColunas', () => {
  const cols = (...ts) => ts.map((run_ts) => ({ run_ts }));
  const ts = (cs) => cs.map((c) => c.run_ts);

  test('keeps only the last two runs of today', () => {
    const c = cols('2026-09-23T08:00:00', '2026-09-23T10:00:00',
      '2026-09-23T14:00:00');
    expect(ts(A.selecionarColunas(c, '2026-09-23'))).toEqual([
      '2026-09-23T10:00:00', '2026-09-23T14:00:00',
    ]);
  });

  // "The last date before today" is the latest day that HAS a run, not
  // literally yesterday — Friday, when today is Monday.
  test('keeps the last run of the latest earlier day with runs', () => {
    const c = cols('2026-09-18T08:00:00', '2026-09-18T17:00:00',
      '2026-09-21T09:00:00');
    expect(ts(A.selecionarColunas(c, '2026-09-21'))).toEqual([
      '2026-09-18T17:00:00', '2026-09-21T09:00:00',
    ]);
  });

  test('older runs thin to the last one of each ISO week', () => {
    const c = cols(
      '2026-09-07T09:00:00', // Mon, week of 09-07
      '2026-09-11T09:00:00', // Fri, week of 09-07
      '2026-09-14T09:00:00', // Mon, week of 09-14
      '2026-09-16T09:00:00', // Wed, week of 09-14
      '2026-09-22T09:00:00', // latest earlier day
      '2026-09-23T09:00:00', // today
    );
    expect(ts(A.selecionarColunas(c, '2026-09-23'))).toEqual([
      '2026-09-11T09:00:00', '2026-09-16T09:00:00',
      '2026-09-22T09:00:00', '2026-09-23T09:00:00',
    ]);
  });

  // Sunday belongs to the week that started the Monday before it, and a
  // week straddling the new year is still one week.
  test('weeks start on Monday, across a year boundary', () => {
    const c = cols(
      '2026-12-27T09:00:00', // Sun, week of 12-21
      '2026-12-29T09:00:00', // Tue, week of 12-28
      '2027-01-02T09:00:00', // Sat, week of 12-28
      '2027-01-05T09:00:00', // latest earlier day
    );
    expect(ts(A.selecionarColunas(c, '2027-01-06'))).toEqual([
      '2026-12-27T09:00:00', '2027-01-02T09:00:00', '2027-01-05T09:00:00',
    ]);
  });

  test('no run today still shows the earlier ones', () => {
    const c = cols('2026-09-14T09:00:00', '2026-09-22T09:00:00');
    expect(ts(A.selecionarColunas(c, '2026-09-23'))).toEqual([
      '2026-09-14T09:00:00', '2026-09-22T09:00:00',
    ]);
  });

  test('no columns yields no columns', () => {
    expect(A.selecionarColunas([], '2026-09-23')).toEqual([]);
  });
});
