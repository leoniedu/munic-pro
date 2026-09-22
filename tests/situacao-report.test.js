import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

await import('../extension/common/munic-common.js');
await import('../extension/common/assistencias.js');
await import('../extension/features/situacao-report/situacao-aggregate.js');
await import('../extension/features/situacao-report/situacao-report.js');

const R = window.__municProSituacaoReportInternals;

describe('onSituacaoPage', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  // Detection is by the presence of THIS page's own buttons, not by its
  // title. An earlier draft matched the text "situacao municipio" and
  // would have returned false on the live page, whose card is titled
  // "Situação das Prefeituras, com Críticas da UF" — the same class of
  // silent miss sigc-pro documents in ultimo-movimento-export.js:26-33.
  // The ids come from the page's own markup and are what we anchor to
  // anyway, so detection and anchoring cannot drift apart.
  test('true when the page action buttons are present', () => {
    document.body.innerHTML =
      '<a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a>';
    expect(R.onSituacaoPage()).toBe(true);
  });

  test('false when the anchor button is absent', () => {
    document.body.innerHTML = '<a id="btnAtualizarCriticas"></a>';
    expect(R.onSituacaoPage()).toBe(false);
  });

  test('false on an unrelated report page', () => {
    document.body.innerHTML = '<a id="btnFiltrar"></a><h6>Relatório Último Movimento</h6>';
    expect(R.onSituacaoPage()).toBe(false);
  });

  test('false on an empty page', () => {
    expect(R.onSituacaoPage()).toBe(false);
  });
});

describe('makeButton', () => {
  // SIGC's own buttons are <a class="btn btn-primary">, not <button>.
  // Matching that is what makes ours look native in the row.
  test('builds an anchor with SIGC button classes', () => {
    const b = R.makeButton('Atualizar', () => {});
    expect(b.tagName).toBe('A');
    expect(b.className).toContain('btn');
    expect(b.className).toContain('btn-primary');
  });

  // SIGC's hrefs are javascript: URLs rewritten by the F5 layer. Ours
  // carries none, so the rewriter has nothing of ours to touch.
  test('carries no href', () => {
    expect(R.makeButton('X', () => {}).hasAttribute('href')).toBe(false);
  });

  test('keeps the pointer cursor without an href', () => {
    expect(R.makeButton('X', () => {}).style.cursor).toBe('pointer');
  });

  test('calls its handler on click', () => {
    let called = false;
    const b = R.makeButton('X', () => { called = true; });
    b.click();
    expect(called).toBe(true);
  });
});

describe('situacaoClass', () => {
  // SITUACAO_CLASS now keys on the four Excel buckets only — the raw
  // digitação variants ('Dig. Ibge', 'Dig. Informante', 'Em Validação')
  // are no longer looked up directly; they must be recoded to
  // 'Digitação/Validação' by situacaoRec() before reaching this table.
  test('maps each bucket name to its class', () => {
    expect(R.situacaoClass('Não Iniciado')).toBe('munic-pro-nao-iniciado');
    expect(R.situacaoClass('Digitação/Validação')).toBe('munic-pro-digitacao');
    expect(R.situacaoClass('Supervisão/Análise')).toBe('munic-pro-supervisao');
    expect(R.situacaoClass('Concluído')).toBe('munic-pro-concluido');
  });

  // A raw (unbucketed) digitação variant is no longer a valid key — this
  // is the change #2 contract: bucketing happens upstream in
  // situacaoRec(), not here.
  test('a raw digitação variant is not itself a class key', () => {
    expect(R.situacaoClass('Dig. Ibge')).toBe('');
  });

  // An unknown value gets NO class, so it renders uncoloured and
  // visibly different rather than being silently miscoloured as
  // something it is not.
  test('unknown situação gets no class', () => {
    expect(R.situacaoClass('Situação Nova')).toBe('');
    expect(R.situacaoClass(null)).toBe('');
  });
});

describe('renderMunicipioTab', () => {
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W38', run_ts: null },
  ];
  const grid = [
    {
      key: '2900702|Básico|criticas_informativas',
      municipio_codigo: '2900702',
      municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS',
      questionario: 'Básico',
      name: 'criticas_informativas',
      cells: [51, null],
    },
    {
      key: '2900702|Básico|criticas_comparativas',
      municipio_codigo: '2900702',
      municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS',
      questionario: 'Básico',
      name: 'criticas_comparativas',
      cells: [20, null],
    },
    {
      key: '2900702|Básico|situacao_rec',
      municipio_codigo: '2900702',
      municipio_nome: 'Alagoinhas',
      agencia_nome: 'ALAGOINHAS',
      questionario: 'Básico',
      name: 'situacao_rec',
      cells: ['Não Iniciado', null],
    },
  ];

  test('renders one row per grid line', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
  });

  test('shows the questionário as its own column', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.textContent).toContain('Básico');
  });

  // The Indicador column is the new one this change adds — it is what
  // lets the três rows (críticas informativas, críticas comparativas,
  // situação) be told apart.
  test('has an Indicador column header', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const ths = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(ths).toContain('Indicador');
  });

  test('shows the name of each indicator row', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.textContent).toContain('criticas_informativas');
    expect(el.textContent).toContain('criticas_comparativas');
    expect(el.textContent).toContain('situacao_rec');
  });

  // The header carries the real run date, so a stale column cannot be
  // mistaken for a fresh one.
  test('column headers carry the week and the run date', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const ths = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(ths.some((t) => t.includes('2026-W37') && t.includes('07/09'))).toBe(true);
  });

  test('a week with no run is labelled as such', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const ths = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(ths.some((t) => t.includes('2026-W38') && /sem coleta|—/i.test(t))).toBe(true);
  });

  // Only situacao_rec rows are coloured. Críticas rows are plain
  // numbers, matching the Excel where only the situação row is
  // colour-coded.
  test('colours only the situacao_rec row', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.querySelector('.munic-pro-nao-iniciado')).toBeTruthy();
    const rows = [...el.querySelectorAll('tbody tr')];
    const criticasRow = rows.find((tr) => tr.textContent.includes('criticas_informativas'));
    expect(criticasRow.querySelector('.munic-pro-nao-iniciado')).toBeNull();
    expect(criticasRow.querySelector('.munic-pro-digitacao')).toBeNull();
  });

  test('críticas cells show plain numbers', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const rows = [...el.querySelectorAll('tbody tr')];
    const criticasRow = rows.find((tr) => tr.textContent.includes('criticas_informativas'));
    expect(criticasRow.textContent).toContain('51');
  });

  // The gap week (run_ts: null) yields a null cell in the grid. It must
  // render as a visible placeholder — its own text and its own class —
  // never as a blank <td> that would be indistinguishable from missing
  // data, in EVERY row type (críticas or situação).
  test('a gap cell shows the placeholder, not a blank cell, in all three row types', () => {
    const el = R.renderMunicipioTab(grid, columns);
    for (const tr of [...el.querySelectorAll('tbody tr')]) {
      const tds = [...tr.querySelectorAll('td')];
      const gapCell = tds[tds.length - 1];
      expect(gapCell.textContent).toBe('—');
      expect(gapCell.className).toContain('munic-pro-vazio');
      expect(gapCell.className).not.toContain('munic-pro-nao-iniciado');
      expect(gapCell.className).not.toContain('munic-pro-digitacao');
      expect(gapCell.className).not.toContain('munic-pro-supervisao');
      expect(gapCell.className).not.toContain('munic-pro-concluido');
    }
  });
});

describe('renderGroupTab', () => {
  // Change #3: the group tabs now carry one column per date, not one
  // snapshot column. counts is a list of {group, situacao, cells[]} (or
  // pctCells[] for the percentage tab), parallel to `columns`.
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W39', run_ts: '2026-09-21T09:00:00' },
  ];
  const counts = [
    { group: 'A', situacao: 'Não Iniciado', cells: [2, 1] },
    { group: 'A', situacao: 'Concluído', cells: [1, 2] },
  ];

  test('one row per group-situação pair', () => {
    const el = R.renderGroupTab(counts, columns, R.fmtCount);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });

  test('has one column per date, after group and situação', () => {
    const el = R.renderGroupTab(counts, columns, R.fmtCount);
    const ths = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(ths.some((t) => t.includes('2026-W37'))).toBe(true);
    expect(ths.some((t) => t.includes('2026-W39'))).toBe(true);
  });

  // This is the test that would fail against a per-snapshot
  // implementation: the counts must differ between the two date columns.
  test('counts differ across date columns', () => {
    const el = R.renderGroupTab(counts, columns, R.fmtCount);
    const row = [...el.querySelectorAll('tbody tr')][0];
    const tds = [...row.querySelectorAll('td')].map((td) => td.textContent);
    expect(tds).toContain('2');
    expect(tds).toContain('1');
  });

  test('the percentage tab formats cells with fmtPct', () => {
    const pctCounts = [
      { group: 'A', situacao: 'Não Iniciado', cells: [2 / 3, 1 / 3] },
    ];
    const el = R.renderGroupTab(pctCounts, columns, R.fmtPct);
    expect(el.textContent).toMatch(/66[.,]7\s*%/);
  });
});

describe('page anchor', () => {
  // Pinned to the ids captured from the live page. If SIGC renames a
  // button, this fails loudly here instead of the extension quietly
  // mounting nothing and the colleague reporting "the buttons are gone".
  test('anchors to the last of SIGC own buttons', () => {
    expect(R.PAGE_BUTTON_IDS).toEqual([
      'btnAtualizarCriticas', 'btnAbrir', 'btnAbrirPdf', 'btnAbrirExcel',
    ]);
    expect(R.ANCHOR_ID).toBe('btnAbrirExcel');
  });

  test('the anchor is one of the detected buttons', () => {
    expect(R.PAGE_BUTTON_IDS).toContain(R.ANCHOR_ID);
  });
});

describe('buildPanel', () => {
  const data = {
    grid: [],
    columns: [],
    porAssistencia: [],
    porAssistenciaPct: [],
    porAgencia: [],
    porAgenciaPct: [],
    warnings: [],
    lastRun: '2026-09-22T10:00:00',
  };

  // Change #3 (2025 excel parity, revisited): "Agência × Município" stays
  // dropped — with roughly one município per group, every row there read
  // 100%, which was noise. But the earlier cut also dropped the plain
  // Agência view the 2025 workbook had (grouped by agência alone, not by
  // agência AND município), so it is restored here as its own pair of
  // tabs, mirroring Assistência / Assistência %.
  test('has five tabs in the 2025-workbook order', () => {
    const panel = R.buildPanel(data);
    const tabs = [...panel.querySelectorAll('[data-munic-pro-tab]')]
      .map((t) => t.textContent.trim());
    expect(tabs).toEqual([
      'Município', 'Assistência', 'Assistência %', 'Agência', 'Agência %',
    ]);
    expect(tabs).not.toContain('Agência × Município');
  });

  test('shows warnings when present', () => {
    const panel = R.buildPanel({ ...data, warnings: ['situação nova: X'] });
    expect(panel.textContent).toContain('situação nova: X');
  });

  test('shows no warning banner when there are none', () => {
    const panel = R.buildPanel(data);
    expect(panel.querySelector('.munic-pro-avisos')).toBeNull();
  });
});

describe('buildActions — Relatório panel placement', () => {
  const realStore = window.__municProSituacaoStore;

  afterEach(() => {
    window.__municProSituacaoStore = realStore;
  });

  // The button row's own parent chain has no ancestor with class "card"
  // (unlike the live SIGC page, where the row does sit inside one). This
  // exercises the `bar.closest('.card') || bar.parentElement.parentElement`
  // fallback: the panel must still land in the tree without throwing.
  //
  // Kept detached from document.body: mountWidget's own MutationObserver
  // watches the live document for the same #munic-pro-actions id this
  // buildActions() call also produces, and would otherwise tear this
  // manually-built bar down mid-test as an unwanted mount.
  test('inserts the panel even with no .card ancestor', async () => {
    window.__municProSituacaoStore = {
      getAll: async () => [],
      getRuns: async () => [
        { run_ts: '2026-09-22T10:00:00', warnings: [] },
      ],
    };

    const root = document.createElement('div');
    const grandparent = document.createElement('div');
    const parent = document.createElement('div');
    root.appendChild(grandparent);
    grandparent.appendChild(parent);

    const bar = window.__municProSituacaoReport.buildActions();
    parent.appendChild(bar);

    const relatorioButton = [...bar.querySelectorAll('a')]
      .find((a) => a.textContent === 'Relatório');
    relatorioButton.click();
    // Let the async click handler's microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.munic-pro-panel')).toBeTruthy();
  });

  // The Agência tabs (change #1) group by agencia_nome directly — no
  // assistência mapping involved — and, like Assistência, carry one
  // column per date. A município moving from one agência's Não Iniciado
  // bucket into Concluído between the two runs is what tells a real
  // per-column implementation apart from one that just repeats the
  // latest snapshot in every column: a repeated-snapshot bug would show
  // the same counts in both date columns.
  test('Relatório panel has an Agência tab whose counts differ across dates', async () => {
    // Adjacent ISO weeks (no gap week between them), so weekColumns()
    // yields exactly two columns and the two runs land one per column.
    window.__municProSituacaoStore = {
      getAll: async () => [
        { municipio_codigo: '1', municipio_nome: 'Alagoinhas',
          agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
          situacao: 'Não Iniciado',
          from_ts: '2026-09-07T09:00:00', until_ts: '2026-09-14T09:00:00' },
        { municipio_codigo: '1', municipio_nome: 'Alagoinhas',
          agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
          situacao: 'Concluído',
          from_ts: '2026-09-14T09:00:00', until_ts: null },
      ],
      getRuns: async () => [
        { run_ts: '2026-09-07T09:00:00', warnings: [] },
        { run_ts: '2026-09-14T09:00:00', warnings: [] },
      ],
    };

    const root = document.createElement('div');
    const grandparent = document.createElement('div');
    const parent = document.createElement('div');
    root.appendChild(grandparent);
    grandparent.appendChild(parent);
    const bar = window.__municProSituacaoReport.buildActions();
    parent.appendChild(bar);

    const relatorioButton = [...bar.querySelectorAll('a')]
      .find((a) => a.textContent === 'Relatório');
    relatorioButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = root.querySelector('.munic-pro-panel');
    expect(panel).toBeTruthy();
    const tabs = [...panel.querySelectorAll('[data-munic-pro-tab]')];
    const agenciaTab = tabs.find((t) => t.textContent.trim() === 'Agência');
    expect(agenciaTab).toBeTruthy();

    agenciaTab.click();
    const idx = tabs.indexOf(agenciaTab);
    const panes = [...panel.querySelectorAll('table')];
    const agenciaPane = panes[idx];
    expect(agenciaPane.textContent).toContain('ALAGOINHAS');

    const rows = [...agenciaPane.querySelectorAll('tbody tr')];
    const naoIniciadoRow = rows.find((tr) => tr.textContent.includes('Não Iniciado'));
    const concluidoRow = rows.find((tr) => tr.textContent.includes('Concluído'));
    const naoIniciadoCells = [...naoIniciadoRow.querySelectorAll('td')]
      .slice(2).map((td) => td.textContent);
    const concluidoCells = [...concluidoRow.querySelectorAll('td')]
      .slice(2).map((td) => td.textContent);
    // Column 1: 1 Não Iniciado, 0 Concluído. Column 2: the reverse.
    expect(naoIniciadoCells).toEqual(['1', '0']);
    expect(concluidoCells).toEqual(['0', '1']);
  });
});

describe('button styling and placement', () => {
  // The buttons must be visually distinguishable from SIGC's own, which are
  // also .btn.btn-primary. A screenshot of the live page showed ours
  // indistinguishable from the portal's, so the colleague could not tell
  // which four were the extension's.
  test('buttons carry the PRO blue, not SIGC btn-primary default', () => {
    const b = R.makeButton('X', () => {});
    expect(b.style.background).toBeTruthy();
    expect(b.style.borderColor).toBeTruthy();
    // Distinct from the portal's own #4a7ba7-ish primary.
    expect(b.style.background).not.toBe('');
  });

  // Spacing moved from per-button margins to the row's flex `gap` when the
  // buttons were found rendering off-screen on the live page: the row
  // carried Bootstrap's `col-12`, which only behaves inside a `.row`, and
  // outside one its width rules pushed the last buttons past the container
  // edge — they only became visible if you zoomed out.
  test('the button row is flex, so it wraps instead of overflowing', () => {
    const bar = R.buildActions();
    expect(bar.style.display).toBe('flex');
    expect(bar.style.flexWrap).toBe('wrap');
    expect(bar.style.gap).toBe('10px');
  });

  test('the button row carries no Bootstrap grid class', () => {
    // `col-12` outside a `.row` is what put the buttons off-screen.
    expect(R.buildActions().className).not.toContain('col-');
  });

  test('the button row cannot exceed its container width', () => {
    const bar = R.buildActions();
    expect(bar.style.width).toBe('100%');
    expect(bar.style.boxSizing).toBe('border-box');
  });

  test('all four buttons are present in the row', () => {
    // Two of the four were reported missing on the live page; they were
    // off-screen rather than absent, but the count is worth pinning.
    const labels = [...R.buildActions().querySelectorAll('a')]
      .map((a) => a.textContent);
    expect(labels).toEqual([
      'Atualizar', 'Relatório', 'CSV observações', 'CSV mudanças',
    ]);
  });
});

describe('actionsAnchor', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  // The live markup nests the col-12 button row inside SIGC's flex/row
  // container, which is itself the last child of the card body. The old
  // contract anchored to the col-12 row and inserted 'after' it, as the
  // row's NEXT SIBLING — landing outside the row's parent (and, on the
  // live page, outside the card's padded area) rather than inside it.
  // The new contract anchors to the row's PARENT and appends into it, so
  // our row becomes one more child of the same container SIGC's row is
  // in — a full-width row below it, still inside the card.
  test('resolves to the parent of the containing col-12 row', () => {
    document.body.innerHTML =
      '<div class="card"><div class="card-body">' +
      '<div class="row">' +
      '<div class="col-12 text-sm-end">' +
      '<a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a></div>' +
      '</div></div></div>';
    const row = document.querySelector('div.col-12');
    const anchor = R.actionsAnchor();
    expect(anchor).toBe(row.parentElement);
    expect(anchor.className).toContain('row');
  });

  // Appending our row into that parent must not escape the card: the
  // parent (and the mounted widget) both stay inside .card.
  test('the resolved anchor stays inside the card', () => {
    document.body.innerHTML =
      '<div class="card"><div class="card-body">' +
      '<div class="row">' +
      '<div class="col-12 text-sm-end">' +
      '<a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a></div>' +
      '</div></div></div>';
    const anchor = R.actionsAnchor();
    expect(anchor.closest('.card')).toBeTruthy();
  });

  // A markup change must degrade to a working placement, not to no
  // buttons: with no col-12 wrapper, fall back to the button's own
  // parent so the widget still mounts somewhere sane.
  test('falls back to the button\'s parent when no col-12 wrapper exists', () => {
    document.body.innerHTML =
      '<span><a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a></span>';
    const span = document.querySelector('span');
    expect(R.actionsAnchor()).toBe(span);
  });

  test('returns null when the anchor button is absent', () => {
    expect(R.actionsAnchor()).toBeNull();
  });
});

describe('table column counts (DataTables mismatch guard)', () => {
  // sigc-pro documents that DataTables reports a header/body column-count
  // mismatch through its own alert() — a modal a try/catch cannot contain.
  // The builders must keep header and body cell counts equal by
  // construction; this asserts that invariant directly rather than
  // trusting it.
  const columns = [
    { week: '2026-W37', run_ts: '2026-09-07T09:00:00' },
    { week: '2026-W38', run_ts: null },
  ];

  test('renderMunicipioTab keeps header and body cell counts equal', () => {
    const grid = [
      { key: 'k1', municipio_codigo: '1', municipio_nome: 'A',
        agencia_nome: 'AG', questionario: 'Básico', name: 'situacao_rec',
        cells: ['Não Iniciado', null] },
    ];
    const el = R.renderMunicipioTab(grid, columns);
    expect(R.colunasBatem(el)).toBe(true);
  });

  test('renderGroupTab keeps header and body cell counts equal', () => {
    const counts = [
      { group: 'A', situacao: 'Não Iniciado', cells: [2, 1] },
      { group: 'A', situacao: 'Concluído', cells: [1, 2] },
    ];
    const el = R.renderGroupTab(counts, columns, R.fmtCount);
    expect(R.colunasBatem(el)).toBe(true);
  });

  test('colunasBatem is false for a genuinely mismatched table', () => {
    document.body.innerHTML =
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>1</td></tr></tbody></table>';
    expect(R.colunasBatem(document.querySelector('table'))).toBe(false);
  });

  test('colunasBatem is true for an empty-header-free table (no thead)', () => {
    document.body.innerHTML = '<table><tbody><tr><td>1</td></tr></tbody></table>';
    // No header at all — nCols is 0, which sigc-pro's own colunasBatem
    // treats as "do not initialize" (false), a safe default here too.
    expect(R.colunasBatem(document.querySelector('table'))).toBe(false);
  });
});

describe('initPanelTables — jQuery/DataTables absent', () => {
  // The panel must never depend on DataTables existing: with no
  // window.jQuery (or no $.fn.dataTable), the plain tables stay exactly
  // as rendered — still working, just unsorted and unpaged.
  test('does nothing when window.jQuery is absent', () => {
    const savedJquery = window.jQuery;
    const saved$ = window.$;
    delete window.jQuery;
    delete window.$;
    try {
      document.body.innerHTML =
        '<div id="p"><table><thead><tr><th>A</th></tr></thead>' +
        '<tbody><tr><td>1</td></tr></tbody></table></div>';
      const panel = document.getElementById('p');
      expect(() => R.initPanelTables(panel)).not.toThrow();
      // Plain table still intact: no filter row injected, no throw.
      expect(panel.querySelectorAll('tr').length).toBe(2);
    } finally {
      if (savedJquery !== undefined) window.jQuery = savedJquery;
      if (saved$ !== undefined) window.$ = saved$;
    }
  });

  test('does nothing when jQuery exists but has no dataTable plugin', () => {
    const savedJquery = window.jQuery;
    window.jQuery = function fakeJq() { return { fn: {} }; };
    window.jQuery.fn = {};
    try {
      document.body.innerHTML =
        '<div id="p"><table><thead><tr><th>A</th></tr></thead>' +
        '<tbody><tr><td>1</td></tr></tbody></table></div>';
      const panel = document.getElementById('p');
      expect(() => R.initPanelTables(panel)).not.toThrow();
    } finally {
      if (savedJquery !== undefined) window.jQuery = savedJquery; else delete window.jQuery;
    }
  });

  test('handles a null panel element without throwing', () => {
    expect(() => R.initPanelTables(null)).not.toThrow();
  });
});

describe('initPanelTables — with a fake jQuery/DataTables', () => {
  // A minimal fake of the jQuery + DataTables surface initPanelTables
  // actually touches: $(el).DataTable({...}) returning an instance with
  // columns().every(...) and search()/draw(). This is enough to prove
  // wiring without pulling in the real DataTables library, which SIGC's
  // own page supplies at runtime and this project deliberately never
  // vendors (network gate: no third-party libraries in extension/).
  function installFakeDataTables() {
    const registry = new WeakMap();

    function makeInstance(tbl) {
      const nCols = tbl.querySelectorAll('thead tr:first-child th').length;
      const searches = new Array(nCols).fill('');
      const instance = {
        page: { len: () => instance },
        draw: () => instance,
        columns() {
          return {
            every(fn) {
              for (let i = 0; i < nCols; i += 1) {
                const ctx = {
                  index: () => i,
                  search(term) {
                    if (term === undefined) return searches[i];
                    searches[i] = term;
                    return ctx;
                  },
                  draw: () => ctx,
                };
                fn.call(ctx);
              }
              return this;
            },
          };
        },
      };
      return instance;
    }

    function jq(elOrSelector) {
      const tbl = typeof elOrSelector === 'string'
        ? document.querySelector(elOrSelector) : elOrSelector;
      return {
        DataTable(opts) {
          if (opts !== undefined) {
            const instance = makeInstance(tbl);
            registry.set(tbl, instance);
            return instance;
          }
          return registry.get(tbl);
        },
      };
    }
    jq.fn = {
      dataTable: {
        isDataTable: (tbl) => registry.has(tbl),
      },
    };
    window.jQuery = jq;
    window.$ = jq;
    return registry;
  }

  afterEach(() => {
    delete window.jQuery;
    delete window.$;
  });

  test('adds a per-column filter row to the thead', () => {
    installFakeDataTables();
    document.body.innerHTML =
      '<div id="p"><table><thead><tr><th>Grupo</th><th>Situação</th></tr></thead>' +
      '<tbody><tr><td>A</td><td>Não Iniciado</td></tr></tbody></table></div>';
    const panel = document.getElementById('p');
    R.initPanelTables(panel);
    const filtroRow = panel.querySelector('thead tr:last-child');
    const inputs = filtroRow.querySelectorAll('input');
    expect(inputs.length).toBe(2);
  });

  // Portuguese wording, matching sigc-pro's own filter-row labels.
  test('filter inputs carry Portuguese aria-label and title', () => {
    installFakeDataTables();
    document.body.innerHTML =
      '<div id="p"><table><thead><tr><th>Grupo</th></tr></thead>' +
      '<tbody><tr><td>A</td></tr></tbody></table></div>';
    const panel = document.getElementById('p');
    R.initPanelTables(panel);
    const input = panel.querySelector('thead tr:last-child input');
    expect(input.getAttribute('aria-label')).toBe('Filtrar Grupo');
    expect(input.title).toBe('Filtrar por Grupo');
  });

  // Idempotency: Relatório can be clicked again, rebuilding the panel and
  // calling initPanelTables a second time on tables DataTables already
  // claimed. A second filter row stacked over the first is the known
  // sigc-pro failure mode this must not repeat.
  test('calling initPanelTables twice does not stack a second filter row', () => {
    installFakeDataTables();
    document.body.innerHTML =
      '<div id="p"><table><thead><tr><th>Grupo</th></tr></thead>' +
      '<tbody><tr><td>A</td></tr></tbody></table></div>';
    const panel = document.getElementById('p');
    R.initPanelTables(panel);
    R.initPanelTables(panel);
    const filtroRows = panel.querySelectorAll(`.${R.FILTRO_ROW_CLASS}`);
    expect(filtroRows.length).toBe(1);
  });

  test('typing in a filter input calls column().search() and draw()', () => {
    installFakeDataTables();
    document.body.innerHTML =
      '<div id="p"><table><thead><tr><th>Grupo</th></tr></thead>' +
      '<tbody><tr><td>A</td></tr></tbody></table></div>';
    const panel = document.getElementById('p');
    R.initPanelTables(panel);
    const input = panel.querySelector('thead tr:last-child input');
    input.value = 'zona';
    input.dispatchEvent(new Event('input'));
    const tbl = panel.querySelector('table');
    const dt = window.jQuery(tbl).DataTable();
    expect(dt.columns().every).toBeTruthy();
  });

  // A table not meant to be interactive (this panel has none today, but
  // the guard mirrors sigc-pro's own "skip tables that fail the column
  // check") must not be handed to DataTable() at all.
  test('a column-mismatched table is skipped, not handed to DataTable()', () => {
    installFakeDataTables();
    document.body.innerHTML =
      '<div id="p"><table id="bad"><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>1</td></tr></tbody></table></div>';
    const panel = document.getElementById('p');
    expect(() => R.initPanelTables(panel)).not.toThrow();
    expect(panel.querySelector(`.${R.FILTRO_ROW_CLASS}`)).toBeNull();
  });
});

describe('Relatório end-to-end with jQuery absent', () => {
  const realStore = window.__municProSituacaoStore;

  afterEach(() => {
    window.__municProSituacaoStore = realStore;
    delete window.jQuery;
    delete window.$;
  });

  // Full click-through with no DataTables in the page at all — the
  // extension's own baseline environment until SIGC's page has loaded
  // it, and the contract for any page that never loads it.
  test('the panel renders with plain, working tables when jQuery is absent', async () => {
    delete window.jQuery;
    delete window.$;
    window.__municProSituacaoStore = {
      getAll: async () => [
        { municipio_codigo: '1', municipio_nome: 'Alagoinhas',
          agencia_nome: 'ALAGOINHAS', questionario: 'Básico',
          situacao: 'Concluído',
          from_ts: '2026-09-07T09:00:00', until_ts: null },
      ],
      getRuns: async () => [{ run_ts: '2026-09-07T09:00:00', warnings: [] }],
    };

    const root = document.createElement('div');
    const grandparent = document.createElement('div');
    const parent = document.createElement('div');
    root.appendChild(grandparent);
    grandparent.appendChild(parent);
    const bar = window.__municProSituacaoReport.buildActions();
    parent.appendChild(bar);

    const relatorioButton = [...bar.querySelectorAll('a')]
      .find((a) => a.textContent === 'Relatório');
    expect(() => relatorioButton.click()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = root.querySelector('.munic-pro-panel');
    expect(panel).toBeTruthy();
    // Every table still has its rows, still readable, just no filter row.
    expect(panel.querySelectorAll('table').length).toBeGreaterThan(0);
    expect(panel.textContent).toContain('ALAGOINHAS');
    expect(panel.querySelector('.sigc-pro-filtro-row, [class*="filtro-row"]')).toBeNull();
  });
});
