import { describe, test, expect, beforeEach } from 'bun:test';

await import('../extension/common/munic-common.js');
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
  test('maps each known situação to its bucket class', () => {
    expect(R.situacaoClass('Não Iniciado')).toBe('munic-pro-nao-iniciado');
    expect(R.situacaoClass('Dig. Ibge')).toBe('munic-pro-digitacao');
    expect(R.situacaoClass('Dig. Informante')).toBe('munic-pro-digitacao');
    expect(R.situacaoClass('Em Validação')).toBe('munic-pro-digitacao');
    expect(R.situacaoClass('Concluído')).toBe('munic-pro-concluido');
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
  const grid = [{
    key: '2900702|Básico',
    municipio_codigo: '2900702',
    municipio_nome: 'Alagoinhas',
    agencia_nome: 'ALAGOINHAS',
    questionario: 'Básico',
    cells: ['Não Iniciado', null],
  }];

  test('renders one row per grid line', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  test('shows the questionário as its own column', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.textContent).toContain('Básico');
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

  test('colours cells by situação', () => {
    const el = R.renderMunicipioTab(grid, columns);
    expect(el.querySelector('.munic-pro-nao-iniciado')).toBeTruthy();
  });
});

describe('renderGroupTab', () => {
  const counts = [
    { group: 'A', situacao: 'Não Iniciado', n: 2, pct: 2 / 3 },
    { group: 'A', situacao: 'Concluído', n: 1, pct: 1 / 3 },
  ];

  test('one row per group-situação pair', () => {
    const el = R.renderGroupTab(counts);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });

  test('shows count and percentage together', () => {
    const el = R.renderGroupTab(counts);
    const text = el.textContent;
    expect(text).toContain('2');
    expect(text).toMatch(/66[.,]7\s*%/);
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
    porAgencia: [],
    warnings: [],
    lastRun: '2026-09-22T10:00:00',
  };

  test('has the three tabs', () => {
    const panel = R.buildPanel(data);
    const tabs = [...panel.querySelectorAll('[data-munic-pro-tab]')]
      .map((t) => t.textContent.trim());
    expect(tabs).toEqual(['Município', 'Assistência', 'Agência']);
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
