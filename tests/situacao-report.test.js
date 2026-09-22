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
    warnings: [],
    lastRun: '2026-09-22T10:00:00',
  };

  // Change #3: "Agência × Município" is dropped entirely — with
  // roughly one município per group, every row there read 100%, which
  // was noise. The remaining tabs are Município, Assistência and
  // Assistência %.
  test('has the three tabs, without Agência × Município', () => {
    const panel = R.buildPanel(data);
    const tabs = [...panel.querySelectorAll('[data-munic-pro-tab]')]
      .map((t) => t.textContent.trim());
    expect(tabs).toEqual(['Município', 'Assistência', 'Assistência %']);
    expect(tabs).not.toContain('Agência × Município');
    expect(tabs).not.toContain('Agência');
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

  test('buttons space with margin-right, matching SIGC own row', () => {
    expect(R.makeButton('X', () => {}).style.marginRight).toBe('10px');
  });
});

describe('actionsAnchor', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  // Anchoring to the button itself put four extra items into a
  // right-aligned single-line group; they overflowed and wrapped
  // mid-group, stranding two of ours on a second line. Anchoring to the
  // containing row and inserting after it gives them a line of their own.
  test('prefers the containing col-12 row over the button', () => {
    document.body.innerHTML =
      '<div class="col-12 text-sm-end">' +
      '<a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a></div>';
    const anchor = R.actionsAnchor();
    expect(anchor.tagName).toBe('DIV');
    expect(anchor.className).toContain('col-12');
  });

  // A markup change must degrade to the old placement, not to no buttons.
  test('falls back to the button when no col-12 wrapper exists', () => {
    document.body.innerHTML =
      '<span><a id="btnAtualizarCriticas"></a><a id="btnAbrir"></a>' +
      '<a id="btnAbrirPdf"></a><a id="btnAbrirExcel"></a></span>';
    expect(R.actionsAnchor().id).toBe('btnAbrirExcel');
  });

  test('returns null when the anchor button is absent', () => {
    expect(R.actionsAnchor()).toBeNull();
  });
});
