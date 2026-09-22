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
    { run_ts: '2026-09-07T09:00:00' },
    { run_ts: '2026-09-21T09:00:00' },
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
    expect(el.textContent).toContain('Críticas informativas');
    expect(el.textContent).toContain('Críticas comparativas');
    expect(el.textContent).toContain('Situação');
  });

  // The header carries the exact run date and time, so a stale column
  // cannot be mistaken for a fresh one and two runs on the same day are
  // still told apart.
  test('column headers carry the run date and time', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const ths = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(ths.some((t) => t.includes('07/09/2026'))).toBe(true);
    expect(ths.some((t) => t.includes('21/09/2026'))).toBe(true);
  });

  // Only situacao_rec rows are coloured. Críticas rows are plain
  // numbers, matching the Excel where only the situação row is
  // colour-coded.
  test('colours only the situacao_rec row', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.querySelector('.munic-pro-nao-iniciado')).toBeTruthy();
    const rows = [...el.querySelectorAll('tbody tr')];
    const criticasRow = rows.find((tr) => tr.textContent.includes('Críticas informativas'));
    expect(criticasRow.querySelector('.munic-pro-nao-iniciado')).toBeNull();
    expect(criticasRow.querySelector('.munic-pro-digitacao')).toBeNull();
  });

  test('críticas cells show plain numbers', () => {
    const el = R.renderMunicipioTab(grid, columns);
    const rows = [...el.querySelectorAll('tbody tr')];
    const criticasRow = rows.find((tr) => tr.textContent.includes('Críticas informativas'));
    expect(criticasRow.textContent).toContain('51');
  });

  // A null cell (município not yet observed at that run) must render as
  // a visible placeholder — its own text and its own class — never as a
  // blank <td> that would be indistinguishable from missing data, in
  // EVERY row type (críticas or situação).
  test('a missing-data cell shows the placeholder, not a blank cell, in all three row types', () => {
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
    { run_ts: '2026-09-07T09:00:00' },
    { run_ts: '2026-09-21T09:00:00' },
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
    expect(ths.some((t) => t.includes('07/09/2026'))).toBe(true);
    expect(ths.some((t) => t.includes('21/09/2026'))).toBe(true);
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
      .find((a) => a.textContent === 'Relatório-PRO');
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
    // Both runs produced a change, so runColumns() yields exactly two
    // columns and the two runs land one per column.
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
        { run_ts: '2026-09-07T09:00:00', warnings: [], n_changed: 1 },
        { run_ts: '2026-09-14T09:00:00', warnings: [], n_changed: 1 },
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
      .find((a) => a.textContent === 'Relatório-PRO');
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
  // Verified against the live markup: the parent is div.box-footer with
  // 20px side padding, and SIGC's own button row above is plain
  // text-align:right with inline-block buttons. Ours copies that.
  //
  // Flex was tried and broke: the status div became a flex ITEM, claimed a
  // whole slot as a block-level child, and forced a wrap that stacked the
  // buttons vertically in the space left over.
  test('the button row is a plain block, not flex', () => {
    const bar = R.buildActions();
    expect(bar.style.display).not.toBe('flex');
    // Alignment is INHERITED from SIGC's div.col-12 (text-sm-end), which
    // we append into — setting our own would be a second source of truth
    // for the same thing.
    expect(bar.style.textAlign).toBe('');
  });

  test('the status is outside the buttons own row', () => {
    const bar = R.buildActions();
    const status = bar.querySelector('#munic-pro-status');
    const row = bar.querySelector('#munic-pro-actions-row');
    expect(row.contains(status)).toBe(false);
    expect(row.querySelectorAll('a').length).toBe(3);
  });

  test('the button row carries no Bootstrap grid class', () => {
    // `col-12` outside a `.row` is what put the buttons off-screen.
    expect(R.buildActions().className).not.toContain('col-');
  });

  // width:100% on a child of a padded container fought that padding.
  // Letting the block size itself is what SIGC's own row does.
  test('the button row sets no explicit width', () => {
    expect(R.buildActions().style.width).toBe('');
  });

  test('the row holds exactly the three action buttons', () => {
    // Two of the four were reported missing on the live page; they were
    // off-screen rather than absent, but the count is worth pinning.
    const labels = [...R.buildActions().querySelectorAll('a')]
      .map((a) => a.textContent);
    expect(labels).toEqual(['Relatório-PRO', 'CSV-PRO', 'Backup JSON']);
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
  test('resolves to the col-12 that holds SIGC own buttons', () => {
    // We append INTO that div, so our buttons are a second line of the
    // same row. Climbing to its parent put them in whatever container
    // wrapped the row, which when narrow stacked them into a column.
    document.body.innerHTML =
      '<div class="box-footer"><div class="col-12 text-sm-end">' +
      '<a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a></div></div>';
    const anchor = R.actionsAnchor();
    expect(anchor.className).toContain('col-12');
    expect(anchor.querySelector('#btnAbrirExcel')).toBeTruthy();
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
    { run_ts: '2026-09-07T09:00:00' },
    { run_ts: '2026-09-21T09:00:00' },
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
      getRuns: async () => [{ run_ts: '2026-09-07T09:00:00', warnings: [], n_changed: 1 }],
    };

    const root = document.createElement('div');
    const grandparent = document.createElement('div');
    const parent = document.createElement('div');
    root.appendChild(grandparent);
    grandparent.appendChild(parent);
    const bar = window.__municProSituacaoReport.buildActions();
    parent.appendChild(bar);

    const relatorioButton = [...bar.querySelectorAll('a')]
      .find((a) => a.textContent === 'Relatório-PRO');
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

describe('tab switching with DataTables wrappers', () => {
  // Reproduces the live failure: DataTables moves each table inside a
  // div.dataTables_wrapper that also holds the length selector, the search
  // box and the pagination. Hiding only the <table> leaves that furniture
  // visible, so every tab's controls stack — the page showed three sets of
  // "linhas por página / Filtrar" at once, with different record counts.
  function wrap(table) {
    const w = document.createElement('div');
    w.className = 'dataTables_wrapper';
    const controls = document.createElement('div');
    controls.className = 'dataTables_length';
    table.parentElement.insertBefore(w, table);
    w.appendChild(controls);
    w.appendChild(table);
    return w;
  }

  test('paneRoot resolves to the wrapper once DataTables has wrapped it', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const t = document.createElement('table');
    document.getElementById('host').appendChild(t);
    expect(R.paneRoot(t)).toBe(t);          // before init
    const w = wrap(t);
    expect(R.paneRoot(t)).toBe(w);          // after init
  });

  test('hiding a pane hides its controls, not just the table', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const t = document.createElement('table');
    document.getElementById('host').appendChild(t);
    const w = wrap(t);

    R.showPane(t, false);
    expect(w.style.display).toBe('none');
    // The bug: the wrapper stayed visible, so its length selector and
    // search box remained on screen while the table beside them vanished.
    expect(w.querySelector('.dataTables_length').closest('.dataTables_wrapper')
      .style.display).toBe('none');

    R.showPane(t, true);
    expect(w.style.display).toBe('');
  });

  test('still works when DataTables never ran', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const t = document.createElement('table');
    document.getElementById('host').appendChild(t);
    R.showPane(t, false);
    expect(t.style.display).toBe('none');
  });
});

describe('showPane across DataTables initialisation', () => {
  // The live failure: panes are hidden BEFORE DataTables runs, so the hide
  // lands on the bare <table>. After wrapping, showing the pane cleared the
  // wrapper's display but left display:none on the table inside — the tab
  // rendered its controls and "89 registros" with no rows beneath.
  test('a pane hidden before wrapping still shows after wrapping', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const t = document.createElement('table');
    document.getElementById('host').appendChild(t);

    R.showPane(t, false);            // hidden while still unwrapped
    expect(t.style.display).toBe('none');

    const w = document.createElement('div');   // DataTables wraps it
    w.className = 'dataTables_wrapper';
    t.parentElement.insertBefore(w, t);
    w.appendChild(t);

    R.showPane(t, true);             // now show it
    expect(w.style.display).toBe('');
    expect(t.style.display).toBe('');  // the table must not stay hidden
  });
});

describe('assistência column on the Município tab', () => {
  const columns = [{ run_ts: '2026-09-21T09:00:00' }];
  const line = {
    key: 'k', municipio_codigo: '2900702', municipio_nome: 'Alagoinhas',
    agencia_codigo: '290070200', agencia_nome: 'ALAGOINHAS',
    questionario: 'Básico', name: 'situacao_rec', cells: ['Concluído'],
  };

  test('shows the assistência derived from the agência code', () => {
    const el = R.renderMunicipioTab([line], columns);
    const first = el.querySelector('tbody tr td');
    // 290070200 maps to Alagoinhas in the vendored lookup.
    expect(first.textContent).toBe('Alagoinhas');
  });

  test('assistência is the first column, as in the 2025 workbook', () => {
    const el = R.renderMunicipioTab([line], columns);
    const heads = [...el.querySelectorAll('thead th')].map((t) => t.textContent);
    expect(heads.slice(0, 5)).toEqual([
      'Assistência', 'Agência', 'Município', 'Questionário', 'Indicador',
    ]);
  });

  // An unknown código must not blank the cell: the lookup labels it
  // visibly so a new agência is obvious rather than silently ungrouped.
  test('an unknown agência code gets a visible label', () => {
    const el = R.renderMunicipioTab(
      [{ ...line, agencia_codigo: '999999999', agencia_nome: 'NOVA' }], columns);
    expect(el.querySelector('tbody tr td').textContent).toContain('NOVA');
  });

  // The DataTables alert() trap: a header/body mismatch raises a modal
  // that try/catch cannot contain.
  test('header and body cell counts still agree', () => {
    const el = R.renderMunicipioTab([line], columns);
    const head = el.querySelectorAll('thead tr:first-child th').length;
    const body = el.querySelectorAll('tbody tr:first-child td').length;
    expect(body).toBe(head);
  });
});

describe('zero-valued cells', () => {
  // A críticas count of 0 rendered as an empty cell, which reads as "no
  // data" rather than "no críticas". The 2025 workbook shows 0.
  test('a críticas count of zero renders as 0, not blank', () => {
    const line = {
      key: 'k', municipio_codigo: '1', municipio_nome: 'M',
      agencia_codigo: '290070200', agencia_nome: 'AG',
      questionario: 'Básico', name: 'criticas_informativas', cells: [0],
    };
    const el = R.renderMunicipioTab(
      [line], [{ run_ts: '2026-09-21T09:00:00' }]);
    const tds = [...el.querySelectorAll('tbody td')];
    expect(tds[tds.length - 1].textContent).toBe('0');
  });

  test('a genuinely absent cell still renders the em-dash', () => {
    const line = {
      key: 'k', municipio_codigo: '1', municipio_nome: 'M',
      agencia_codigo: '290070200', agencia_nome: 'AG',
      questionario: 'Básico', name: 'criticas_informativas', cells: [null],
    };
    const el = R.renderMunicipioTab(
      [line], [{ run_ts: '2026-09-14T09:00:00' }]);
    const tds = [...el.querySelectorAll('tbody td')];
    expect(tds[tds.length - 1].textContent).toBe('—');
  });
});

describe('staleness check before refetching', () => {
  // Relatório-PRO refetches only when the newest run is older than a
  // minute — a double-click guard, not a cache. Anything longer would risk
  // presenting yesterday's reading as today's.
  const AGORA = Date.now();
  // localTimestamp, NOT toISOString: stored run_ts values are zone-less
  // LOCAL time, and the code parses them as such. Using toISOString here
  // would write a UTC instant that reads as hours in the future under
  // BRT — the same trap the whole-branch review found in the code.
  const iso = (ms) => window.__municPro.localTimestamp(new Date(ms));

  // These stubs replace module-level globals, so they must be restored —
  // without this, every later test in the run inherits them. A first
  // version of this block did not, and broke 28 tests downstream.
  const saved = {};
  beforeEach(() => {
    for (const k of ['__municProSituacaoFetchInternals', '__municProSituacaoFetch',
                     '__municProSituacaoExport', '__municProSituacaoStore']) {
      saved[k] = window[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete window[k]; else window[k] = v;
    }
  });

  function stub(lastRunMs, onFetch) {
    window.__municProSituacaoFetchInternals = { readUf: () => '29' };
    window.__municProSituacaoFetch = {
      fetchSituacao: async () => { onFetch(); return { rows: [], warnings: [] }; },
    };
    window.__municProSituacaoExport = { downloadSnapshot: () => {} };
    window.__municProSituacaoStore = {
      getAll: async () => [],
      getRuns: async () => (lastRunMs === null
        ? [] : [{ run_ts: iso(lastRunMs), warnings: [], id_uf: 29 }]),
      saveSnapshot: async () => ({ nChanged: 0, nRows: 0 }),
    };
  }

  test('a run seconds old is not refetched', async () => {
    let fetched = false;
    stub(AGORA - 10 * 1000, () => { fetched = true; });
    const bar = window.__municProSituacaoReport.buildActions();
    document.body.appendChild(bar);
    [...bar.querySelectorAll('a')]
      .find((a) => a.textContent === 'Relatório-PRO').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetched).toBe(false);
  });

  test('a run older than a minute is refetched', async () => {
    let fetched = false;
    stub(AGORA - 5 * 60 * 1000, () => { fetched = true; });
    const bar = window.__municProSituacaoReport.buildActions();
    document.body.appendChild(bar);
    [...bar.querySelectorAll('a')]
      .find((a) => a.textContent === 'Relatório-PRO').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetched).toBe(true);
  });

  test('no history at all is refetched', async () => {
    let fetched = false;
    stub(null, () => { fetched = true; });
    const bar = window.__municProSituacaoReport.buildActions();
    document.body.appendChild(bar);
    [...bar.querySelectorAll('a')]
      .find((a) => a.textContent === 'Relatório-PRO').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetched).toBe(true);
  });
});

describe('group tab argument order', () => {
  // A wrong argument order to groupCountsByColumn produced EMPTY group
  // labels rather than an error — silent, and only visible on screen.
  test('group labels are populated, not blank', () => {
    const rows = [{
      municipio_codigo: '1', municipio_nome: 'M',
      agencia_codigo: '290070200', agencia_nome: 'ALAGOINHAS',
      questionario: 'Básico', situacao: 'Concluído',
      criticas_informativas: 0, criticas_comparativas: 0,
      from_ts: '2026-09-21T09:00:00', until_ts: null,
    }];
    const cols = [{ run_ts: '2026-09-21T09:00:00' }];
    const out = window.__municProSituacaoAggregate.groupCountsByColumn(rows, ['agencia_nome'], cols);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].group).toBe('ALAGOINHAS');
  });
});

describe('button label wrapping', () => {
  // "Relatório-PRO" wrapped inside its button on the live page, making it
  // two lines tall next to the single-line buttons beside it.
  test('labels do not wrap inside the button', () => {
    expect(R.makeButton('Relatório-PRO', () => {}).style.whiteSpace)
      .toBe('nowrap');
  });
});

describe('percentage tabs render percentages, not counts', () => {
  // The live page showed "1800,0%" for an agência with 18 municípios: the
  // percentage tabs received the SAME object as the count tabs and differed
  // only by the formatter, so fmtPct ran over raw counts. groupCountsByColumn
  // had always computed pctCells correctly — nothing ever read them.
  const columns = [{ run_ts: '2026-09-21T09:00:00' }];
  const counts = [{
    group: 'ALAGOINHAS', situacao: 'Não Iniciado',
    cells: [18], pctCells: [0.9],
  }];

  test('the percentage tab reads pctCells', () => {
    const el = R.renderGroupTab(counts, columns, R.fmtPct, 'pctCells');
    const tds = [...el.querySelectorAll('tbody td')];
    expect(tds[tds.length - 1].textContent).toBe('90,0%');
  });

  test('the count tab still reads cells', () => {
    const el = R.renderGroupTab(counts, columns, String, 'cells');
    const tds = [...el.querySelectorAll('tbody td')];
    expect(tds[tds.length - 1].textContent).toBe('18');
  });

  // The exact live symptom: a count of 18 must never render as 1800,0%.
  test('a raw count is never shown as a percentage', () => {
    const el = R.renderGroupTab(counts, columns, R.fmtPct, 'pctCells');
    expect(el.textContent).not.toContain('1800');
  });
});

describe('Indicador column labels', () => {
  // The column showed the R package's internal field names
  // (situacao_rec, criticas_informativas), which read as a database dump.
  // The internal name stays as the DATA — cellForName and the colour
  // logic key on it — so this maps at render time only.
  test('maps internal names to readable Portuguese', () => {
    expect(R.indicadorLabel('situacao_rec')).toBe('Situação');
    expect(R.indicadorLabel('criticas_informativas'))
      .toBe('Críticas informativas');
    expect(R.indicadorLabel('criticas_comparativas'))
      .toBe('Críticas comparativas');
  });

  test('an unknown name passes through unchanged', () => {
    expect(R.indicadorLabel('algo_novo')).toBe('algo_novo');
  });

  test('the rendered cell shows the label, not the field name', () => {
    const line = {
      key: 'k', municipio_codigo: '1', municipio_nome: 'M',
      agencia_codigo: '290070200', agencia_nome: 'AG',
      questionario: 'Básico', name: 'situacao_rec', cells: ['Concluído'],
    };
    const el = R.renderMunicipioTab(
      [line], [{ run_ts: '2026-09-21T09:00:00' }]);
    const tds = [...el.querySelectorAll('tbody td')].map((t) => t.textContent);
    expect(tds).toContain('Situação');
    expect(tds).not.toContain('situacao_rec');
  });

  // Colouring keys on the internal name, not the label — a rename of the
  // label must not silently stop colouring the situação row.
  test('the situação row is still coloured after relabelling', () => {
    const line = {
      key: 'k', municipio_codigo: '1', municipio_nome: 'M',
      agencia_codigo: '290070200', agencia_nome: 'AG',
      questionario: 'Básico', name: 'situacao_rec', cells: ['Concluído'],
    };
    const el = R.renderMunicipioTab(
      [line], [{ run_ts: '2026-09-21T09:00:00' }]);
    expect(el.querySelector('.munic-pro-concluido')).toBeTruthy();
  });
});

describe('column headers show the measurement date', () => {
  // Change #3: one column per run, headed by the exact date AND time —
  // needed because two runs can land on the same day, and the header
  // must still tell them apart.
  test('a run column shows dd/mm/yyyy HH:MM', () => {
    const el = R.renderMunicipioTab(
      [], [{ run_ts: '2026-09-21T09:00:00' }]);
    const th = [...el.querySelectorAll('thead th')].pop();
    expect(th.textContent).toBe('21/09/2026 09:00');
    expect(th.textContent).not.toContain('W39');
  });

  // No gap columns exist any more (runColumns() only emits a column for
  // a run that changed something), so there is nothing left to
  // special-case for "no run this period".

  test('the year is shown, so December and January do not collide', () => {
    const el = R.renderMunicipioTab(
      [], [{ run_ts: '2027-01-04T09:00:00' }]);
    expect([...el.querySelectorAll('thead th')].pop().textContent)
      .toBe('04/01/2027 09:00');
  });
});

describe('pane visibility survives DataTables initialisation', () => {
  // The live symptom: five stacked "linhas por página / Filtrar" blocks and
  // five pagers, with different record counts (2.502 / 12 / 12 / 89 / 89) —
  // every tab's controls on screen at once.
  //
  // Cause: buildPanel hides the non-selected panes BEFORE DataTables runs,
  // so display:none lands on the bare <table>. DataTables then wraps each
  // table in a div.dataTables_wrapper holding the pager, the length
  // selector and the filter box — and that wrapper has no display set.
  function wrapAll(panel) {
    for (const t of panel.querySelectorAll('table')) {
      const wr = document.createElement('div');
      wr.className = 'dataTables_wrapper';
      const pager = document.createElement('div');
      pager.className = 'dataTables_paginate';
      t.parentElement.insertBefore(wr, t);
      wr.appendChild(pager);
      wr.appendChild(t);
    }
  }

  function panelWithTabs() {
    const columns = [{ run_ts: '2026-09-21T09:00:00' }];
    return R.buildPanel({
      grid: [], columns,
      porAssistencia: [], porAssistenciaPct: [],
      porAgencia: [], porAgenciaPct: [],
      warnings: [], lastRun: null,
    });
  }

  test('exactly one tab wrapper is visible after wrapping', () => {
    document.body.innerHTML = '';
    const panel = panelWithTabs();
    document.body.appendChild(panel);
    wrapAll(panel);
    R.reapplyPaneVisibility(panel);

    const shown = [...panel.querySelectorAll('table')]
      .filter((t) => t.closest('.dataTables_wrapper').style.display !== 'none');
    expect(shown.length).toBe(1);
  });

  test('the visible one is the selected tab', () => {
    document.body.innerHTML = '';
    const panel = panelWithTabs();
    document.body.appendChild(panel);
    wrapAll(panel);
    R.reapplyPaneVisibility(panel);

    const tables = [...panel.querySelectorAll('table')];
    expect(tables[0].closest('.dataTables_wrapper').style.display).toBe('');
    expect(tables[1].closest('.dataTables_wrapper').style.display).toBe('none');
  });

  // The three tests above call reapplyPaneVisibility DIRECTLY, so they
  // verify the helper but NOT that anything calls it — removing the call
  // site left them all green. This one drives the real path: a DataTables
  // stub that wraps tables the way the library does, through the same
  // entry point the panel uses.
  test('initPanelTables leaves exactly one wrapper visible', () => {
    document.body.innerHTML = '';
    const panel = panelWithTabs();
    document.body.appendChild(panel);

    const saved = { jQuery: window.jQuery, $: window.$ };
    const dtApi = {
      columns: () => ({ every() {} }),
      page: () => ({ len: () => ({ draw() {} }) }),
    };
    const jq = (sel) => {
      // Wrap on init, exactly as DataTables does.
      if (sel && sel.tagName === 'TABLE' && !sel.closest('.dataTables_wrapper')) {
        const wr = document.createElement('div');
        wr.className = 'dataTables_wrapper';
        const pager = document.createElement('div');
        pager.className = 'dataTables_paginate';
        sel.parentElement.insertBefore(wr, sel);
        wr.appendChild(pager);
        wr.appendChild(sel);
      }
      return { DataTable: () => dtApi, length: 1 };
    };
    jq.fn = { dataTable: { isDataTable: () => false } };
    window.jQuery = jq;
    window.$ = jq;

    try {
      // ONLY initPanelTables — no direct call to reapplyPaneVisibility.
      // That is the point: if the re-apply is not wired into init, this
      // fails. The tests above call the helper directly and would not.
      R.initPanelTables(panel);
      const shown = [...panel.querySelectorAll('table')].filter((t) => {
        const root = t.closest('.dataTables_wrapper') || t;
        return root.style.display !== 'none';
      });
      expect(shown.length).toBe(1);
    } finally {
      window.jQuery = saved.jQuery;
      window.$ = saved.$;
    }
  });

  test('switching tabs after wrapping moves the visible wrapper', () => {
    document.body.innerHTML = '';
    const panel = panelWithTabs();
    document.body.appendChild(panel);
    wrapAll(panel);
    R.reapplyPaneVisibility(panel);

    panel.querySelectorAll('[data-munic-pro-tab]')[2].click();
    const tables = [...panel.querySelectorAll('table')];
    expect(tables[0].closest('.dataTables_wrapper').style.display).toBe('none');
    expect(tables[2].closest('.dataTables_wrapper').style.display).toBe('');
  });
});
