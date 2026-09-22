// The report panel: three tabs over the stored history, plus the buttons
// that drive a fetch and the exports.
//
// Renders only — every count, percentage and column choice comes from
// situacao-aggregate.js, so the arithmetic is tested without a DOM.
(function () {
  'use strict';

  if (window.__municProSituacaoReport) return;

  const AGG = window.__municProSituacaoAggregate;

  const TAG = '[munic-pro]';

  // Colours ported verbatim from the 2025 workbook (R/report.R:320-336),
  // so the report reads the same to anyone used to the spreadsheet.
  const SITUACAO_CLASS = {
    'Não Iniciado': 'munic-pro-nao-iniciado',
    'Dig. Informante': 'munic-pro-digitacao',
    'Dig. Ibge': 'munic-pro-digitacao',
    'Em Validação': 'munic-pro-digitacao',
    'Concluído': 'munic-pro-concluido',
  };

  const STYLE = `
    .munic-pro-panel { font-size: 13px; margin: 12px 0; }
    .munic-pro-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .munic-pro-tabs button { padding: 4px 12px; cursor: pointer; }
    .munic-pro-tabs button[aria-selected="true"] { font-weight: bold; }
    .munic-pro-panel table { border-collapse: collapse; width: 100%; }
    .munic-pro-panel th, .munic-pro-panel td {
      border: 1px solid #ccc; padding: 2px 6px; text-align: left;
      white-space: nowrap;
    }
    .munic-pro-panel thead th { position: sticky; top: 0; background: #f5f5f5; }
    .munic-pro-nao-iniciado { color: #9C0006; background: #FFC7CE; }
    .munic-pro-digitacao    { color: #9C5700; background: #FFEB9C; }
    .munic-pro-supervisao   { color: #006100; background: #C6EFCE; }
    .munic-pro-concluido    { color: #0B77A0; background: #CAEEFB; }
    .munic-pro-avisos { background: #FFEB9C; padding: 6px; margin-bottom: 8px; }
    .munic-pro-vazio { color: #999; }
  `;

  // This page's own action buttons, from its live markup. ANCHOR_ID is
  // the last of them, so ours land after SIGC's.
  const PAGE_BUTTON_IDS = [
    'btnAtualizarCriticas', 'btnAbrir', 'btnAbrirPdf', 'btnAbrirExcel',
  ];
  const ANCHOR_ID = 'btnAbrirExcel';

  // Detected by the page's own buttons rather than by its title.
  //
  // An earlier draft matched the header text "situacao municipio" and
  // would have been false on the live page, which is titled "Situação
  // das Prefeituras, com Críticas da UF". Anchoring to the same ids we
  // detect on means detection and anchoring cannot drift apart: if the
  // ids change, we mount nothing rather than mounting somewhere wrong.
  function onSituacaoPage() {
    return PAGE_BUTTON_IDS.every((id) => document.getElementById(id));
  }

  // Mirrors SIGC's own buttons: <a class="btn btn-primary"> with the same
  // inline metrics. No href — SIGC's are javascript: URLs rewritten by
  // the F5 layer, and ours has nothing for it to rewrite.
  function makeButton(text, onClick) {
    const a = document.createElement('a');
    a.className = 'btn btn-primary';
    a.textContent = text;
    a.style.minWidth = '85px';
    a.style.marginLeft = '10px';
    a.style.cursor = 'pointer';
    a.addEventListener('click', onClick);
    return a;
  }

  // '' for anything unrecognised: an unknown situação renders uncoloured
  // and visibly odd, rather than being miscoloured as a bucket it may
  // not belong to.
  function situacaoClass(situacao) {
    return SITUACAO_CLASS[situacao] || '';
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.appendChild(c);
    return node;
  }

  function fmtPct(p) {
    return `${(p * 100).toFixed(1).replace('.', ',')}%`;
  }

  function fmtColumnHeader(col) {
    if (col.run_ts === null) return `${col.week}\n— sem coleta —`;
    const d = new Date(col.run_ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${col.week}\n(${dd}/${mm})`;
  }

  function renderMunicipioTab(grid, columns) {
    const head = el('tr', {}, [
      el('th', { text: 'Agência' }),
      el('th', { text: 'Município' }),
      el('th', { text: 'Questionário' }),
      ...columns.map((c) => el('th', { text: fmtColumnHeader(c) })),
    ]);

    const body = grid.map((line) => el('tr', {}, [
      el('td', { text: line.agencia_nome }),
      el('td', { text: line.municipio_nome }),
      el('td', { text: line.questionario }),
      ...line.cells.map((cell) => el('td', {
        text: cell === null ? '—' : cell,
        class: cell === null ? 'munic-pro-vazio' : situacaoClass(cell),
      })),
    ]));

    return el('table', {}, [
      el('thead', {}, [head]),
      el('tbody', {}, body),
    ]);
  }

  function renderGroupTab(counts) {
    const head = el('tr', {}, [
      el('th', { text: 'Grupo' }),
      el('th', { text: 'Situação' }),
      el('th', { text: 'Municípios' }),
      el('th', { text: '%' }),
    ]);

    const body = counts.map((c) => el('tr', {}, [
      el('td', { text: c.group }),
      el('td', { text: c.situacao, class: situacaoClass(c.situacao) }),
      el('td', { text: String(c.n) }),
      el('td', { text: fmtPct(c.pct) }),
    ]));

    return el('table', {}, [
      el('thead', {}, [head]),
      el('tbody', {}, body),
    ]);
  }

  function buildPanel(data) {
    const panel = el('div', { class: 'munic-pro-panel' });
    panel.appendChild(el('style', { text: STYLE }));

    if (data.warnings && data.warnings.length) {
      panel.appendChild(el('div', {
        class: 'munic-pro-avisos',
        text: data.warnings.join(' | '),
      }));
    }

    const tabNames = ['Município', 'Agência', 'Agência × Município'];
    const panes = [
      renderMunicipioTab(data.grid, data.columns),
      renderGroupTab(data.porAssistencia),
      renderGroupTab(data.porAgencia),
    ];

    const buttons = tabNames.map((name, i) => {
      const b = el('button', { type: 'button', text: name });
      b.setAttribute('data-munic-pro-tab', String(i));
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        buttons.forEach((other, j) => {
          other.setAttribute('aria-selected', i === j ? 'true' : 'false');
          panes[j].style.display = i === j ? '' : 'none';
        });
      });
      return b;
    });

    panes.forEach((p, i) => { p.style.display = i === 0 ? '' : 'none'; });

    panel.appendChild(el('div', { class: 'munic-pro-tabs' }, buttons));
    for (const p of panes) panel.appendChild(p);
    return panel;
  }

  // Builds the button row. Kept thin: every piece of logic it calls is
  // tested on its own.
  function buildActions() {
    const status = el('span', { id: 'munic-pro-status' });
    status.style.marginLeft = '10px';
    const bar = el('span', { id: 'munic-pro-actions' });

    const say = (msg) => { status.textContent = msg; };

    const atualizar = makeButton('Atualizar', async () => {
      const FETCH = window.__municProSituacaoFetch;
      const STORE = window.__municProSituacaoStore;
      const EXPORT = window.__municProSituacaoExport;
      // Only the UF is read from the page. The Agência dropdown is
      // ignored on purpose: this report is UF-wide ("Críticas da UF"),
      // and a snapshot narrowed to one agência would make the SCD diff
      // close every município outside it.
      const uf = window.__municProSituacaoFetchInternals.readUf();
      if (!uf) { say('Selecione a Unidade Estadual.'); return; }

      say('buscando…');
      try {
        const { rows, warnings } = await FETCH.fetchSituacao(uf);
        const runTs = window.__municPro.localTimestamp();
        const { nChanged } = await STORE.saveSnapshot(rows, runTs, warnings);
        // Auto-download so the history survives a cleared profile
        // without anyone having to remember to export it.
        EXPORT.downloadSnapshot(await STORE.getAll(), await STORE.getRuns());
        say(`${rows.length} linhas, ${nChanged} mudança(s).` +
            (warnings.length ? ` ${warnings.join(' | ')}` : ''));
      } catch (err) {
        console.error(TAG, err);
        say(`erro: ${err.message}`);
      }
    });

    const relatorio = makeButton('Relatório', async () => {
      const STORE = window.__municProSituacaoStore;
      const existing = document.querySelector('.munic-pro-panel');
      if (existing) existing.remove();

      const allRows = await STORE.getAll();
      const runs = await STORE.getRuns();
      if (!runs.length) { say('Sem histórico ainda — clique em Atualizar.'); return; }

      const columns = AGG.weekColumns(runs);
      const current = AGG.situacaoAsOf(allRows, runs[runs.length - 1].run_ts);
      const panel = buildPanel({
        grid: AGG.municipioGrid(allRows, columns),
        columns,
        porAssistencia: AGG.groupCounts(current, ['agencia_nome']),
        porAgencia: AGG.groupCounts(current, ['agencia_nome', 'municipio_nome']),
        warnings: runs[runs.length - 1].warnings || [],
        lastRun: runs[runs.length - 1].run_ts,
      });
      // The button row sits in a right-aligned div; the panel belongs
      // below the whole card, full width.
      const card = bar.closest('.card') || bar.parentElement.parentElement;
      card.parentElement.insertBefore(panel, card.nextSibling);
      say('');
    });

    const csvObs = makeButton('CSV observações', async () => {
      const STORE = window.__municProSituacaoStore;
      window.__municProSituacaoExport.downloadDenormalizedCsv(
        await STORE.getAll(), await STORE.getRuns());
    });

    const csvMud = makeButton('CSV mudanças', async () => {
      const STORE = window.__municProSituacaoStore;
      window.__municProSituacaoExport.downloadStateChangeCsv(await STORE.getAll());
    });

    for (const b of [atualizar, relatorio, csvObs, csvMud]) bar.appendChild(b);
    bar.appendChild(status);
    return bar;
  }

  window.__municProSituacaoReport = { buildActions };
  window.__municProSituacaoReportInternals = {
    onSituacaoPage,
    makeButton,
    situacaoClass,
    renderMunicipioTab,
    renderGroupTab,
    buildPanel,
    PAGE_BUTTON_IDS,
    ANCHOR_ID,
  };

  // Inserted after SIGC's last button, and re-inserted whenever the page
  // re-renders and drops it. mountWidget also removes it if the page
  // stops qualifying, so a SPA navigation leaves nothing orphaned.
  if (typeof document !== 'undefined' && document.body) {
    window.__municPro.mountWidget({
      id: 'munic-pro-actions',
      anchor: () => document.getElementById(ANCHOR_ID),
      insert: 'after',
      when: () => onSituacaoPage(),
      build: buildActions,
    });
  }
})();
