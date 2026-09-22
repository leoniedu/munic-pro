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
  // keyed on the four Excel buckets — not the raw digitação variants,
  // which situacaoRec() (situacao-aggregate.js) folds into
  // 'Digitação/Validação' before this table is ever consulted.
  // 'Supervisão/Análise' is kept here even though nothing currently
  // produces it: it was a real bucket in the 2025 vocabulary, just one
  // no observed raw situação mapped to.
  const SITUACAO_CLASS = {
    'Não Iniciado': 'munic-pro-nao-iniciado',
    'Digitação/Validação': 'munic-pro-digitacao',
    'Supervisão/Análise': 'munic-pro-supervisao',
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
    /* Per-column filter row (change #5), ported from sigc-pro's own
       ultimo-movimento-map.js styling for the same control. Lighter than
       the heading row above it, so the two read as heading-then-control
       rather than as two header rows. */
    tr.munic-pro-filtro-row th { background: #fafafa; padding: 2px 4px; }
    tr.munic-pro-filtro-row input.munic-pro-filtro-col {
      width: 100%; box-sizing: border-box; min-width: 0;
      font: inherit; font-size: 11px; font-weight: normal;
      padding: 2px 4px; border: 1px solid #ccc; border-radius: 2px;
      background: #fff; color: inherit;
    }
    tr.munic-pro-filtro-row input.munic-pro-filtro-col:focus {
      outline: 2px solid #1a73e8; outline-offset: -1px; border-color: #1a73e8;
    }
  `;

  // This page's own action buttons, from its live markup. ANCHOR_ID is the
  // last of them; actionsAnchor() resolves from it to the row that contains
  // it, so our buttons land on a line of their own below SIGC's.
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

  // Same element and metrics as SIGC's own buttons —
  // <a class="btn btn-primary"> — so ours sit naturally in the page, but in
  // a darker blue so the colleague can tell at a glance which are the
  // extension's and which are the portal's. A screenshot of the live page
  // showed the two indistinguishable.
  //
  // No href: SIGC's are javascript: URLs rewritten by the F5 layer, and
  // ours has nothing for it to rewrite.
  // Same value SIGC-PRO uses, so the two extensions read as a set.
  //
  // Set inline rather than via a class: SIGC's own stylesheet defines
  // .btn-primary, and an inline background beats it without an !important
  // war or a specificity guess.
  const PRO_BLUE = '#00437a';

  function makeButton(text, onClick) {
    const a = document.createElement('a');
    a.className = 'btn btn-primary';
    a.textContent = text;
    a.style.minWidth = '85px';
    // Inline-block, spaced by margin, exactly like SIGC's own buttons —
    // their row lays out correctly, so ours copies its mechanics rather
    // than introducing a flex context the status div would break.
    a.style.display = 'inline-block';
    a.style.marginLeft = '10px';
    a.style.marginBottom = '6px';
    // "Relatório-PRO" is longer than SIGC's own labels and wrapped onto
    // two lines inside the button, which made it twice as tall as the
    // others in the row.
    a.style.whiteSpace = 'nowrap';
    a.style.cursor = 'pointer';
    a.style.background = PRO_BLUE;
    a.style.borderColor = PRO_BLUE;
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
      // String(v), not v: assigning the NUMBER 0 to textContent yielded an
      // empty cell, so a críticas count of zero read as "no data" instead
      // of "no críticas" — the Excel shows 0. Coerced here, where it covers
      // every caller, rather than at each call site.
      else if (k === 'text') node.textContent = v === null || v === undefined
        ? '' : String(v);
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

  // Display labels for the Indicador column. The internal names stay as
  // the data — cellForName and the colour logic both key on
  // 'situacao_rec' — so this maps only at render time. The CSV keeps the
  // machine names, which is what R analysis reads.
  const INDICADOR_LABEL = {
    criticas_informativas: 'Críticas informativas',
    criticas_comparativas: 'Críticas comparativas',
    situacao_rec: 'Situação',
  };

  function indicadorLabel(name) {
    return INDICADOR_LABEL[name] || name;
  }

  // Colours only the situacao_rec row — críticas rows hold plain counts,
  // same as the Excel colour-codes only its situação row.
  function renderMunicipioTab(grid, columns) {
    // Assistência first, matching the 2025 workbook's sheet 1 column order
    // (assistencia_nome | agencia_nome | municipio_nome | name | dates…).
    const head = el('tr', {}, [
      el('th', { text: 'Assistência' }),
      el('th', { text: 'Agência' }),
      el('th', { text: 'Município' }),
      el('th', { text: 'Questionário' }),
      el('th', { text: 'Indicador' }),
      ...columns.map((c) => el('th', { text: fmtColumnHeader(c) })),
    ]);

    // Derived, not stored: the grid line carries agencia_codigo so this can
    // resolve it. Guarded so the tab still renders if the lookup module is
    // ever absent, rather than throwing and blanking the whole panel.
    const assistenciaDe = (window.__municProAssistencias || {}).assistenciaDe
      || ((cod, nome) => nome || '');

    const body = grid.map((line) => el('tr', {}, [
      el('td', { text: assistenciaDe(line.agencia_codigo, line.agencia_nome) }),
      el('td', { text: line.agencia_nome }),
      el('td', { text: line.municipio_nome }),
      el('td', { text: line.questionario }),
      el('td', { text: indicadorLabel(line.name) }),
      ...line.cells.map((cell) => el('td', {
        text: cell === null ? '—' : cell,
        class: cell === null
          ? 'munic-pro-vazio'
          : (line.name === 'situacao_rec' ? situacaoClass(cell) : ''),
      })),
    ]));

    return el('table', {}, [
      el('thead', {}, [head]),
      el('tbody', {}, body),
    ]);
  }

  function fmtCount(n) {
    return String(n);
  }

  // One column per date (change #3), matching the Excel's
  // situacao_assistencia / _pct sheets. `fmt` picks the cell format —
  // fmtCount for the counts tab, fmtPct for the percentage tab — and
  // counts is the groupCountsByColumn() shape ({group, situacao, cells}
  // with `cells` renamed to whichever field `fmt` is meant to read; both
  // tabs pass their own `cells`/`pctCells` array in as `cells` so this
  // stays a single renderer).
  // `field` names which array of cells to render — 'cells' (counts) or
  // 'pctCells' (within-group percentages). Both tabs previously received
  // the SAME object and differed only by `fmt`, so the percentage tabs ran
  // fmtPct over raw counts: 18 municípios rendered as "1800,0%".
  function renderGroupTab(counts, columns, fmt, field) {
    const head = el('tr', {}, [
      el('th', { text: 'Grupo' }),
      el('th', { text: 'Situação' }),
      ...columns.map((c) => el('th', { text: fmtColumnHeader(c) })),
    ]);

    const body = counts.map((c) => el('tr', {}, [
      el('td', { text: c.group }),
      el('td', { text: c.situacao, class: situacaoClass(c.situacao) }),
      ...(c[field || 'cells'] || []).map((cell) => el('td', {
        text: cell === null ? '—' : fmt(cell),
        class: cell === null ? 'munic-pro-vazio' : '',
      })),
    ]));

    return el('table', {}, [
      el('thead', {}, [head]),
      el('tbody', {}, body),
    ]);
  }

  // Ported from sigc-pro's ultimo-movimento-map.js (initPanelTables /
  // buildFiltroRow / wireFiltroRow / colunasBatem), which makes SIGC's
  // own already-loaded jQuery + DataTables interactive over that
  // extension's panel tables. Same pattern here, over this panel's
  // tables. Nothing is vendored and no request is made: SIGC's page
  // already loads /Scripts/DataTables/jquery.dataTables.min.js.

  // Every body row must have as many cells as the header has columns.
  // DataTables reports a mismatch through its own alert() — a modal a
  // try/catch cannot contain — so this is checked BEFORE construction,
  // never relied on to fail safely afterwards. An empty header (no
  // thead) also returns false: there is nothing to initialize against.
  function colunasBatem(tabela) {
    const nCols = tabela.querySelectorAll('thead tr:first-child th').length;
    if (nCols === 0) return false;
    return [...tabela.querySelectorAll('tbody tr')].every(
      (tr) => tr.querySelectorAll('td').length === nCols);
  }

  const FILTRO_ROW_CLASS = 'munic-pro-filtro-row';

  // A text box under each heading, filtering that column alone through
  // the DataTables API — see wireFiltroRow. Built in the thead (not a
  // tfoot) so the boxes sit against the headings they belong to, which is
  // also why wireFiltroRow stops the row's own clicks from re-sorting.
  function buildFiltroRow(tabela) {
    // Idempotent: initPanelTables can run again (Relatório rebuilds the
    // panel), and a second row would stack a dead set of boxes over the
    // live ones.
    if (tabela.querySelector(`.${FILTRO_ROW_CLASS}`)) return null;
    const thead = tabela.querySelector('thead');
    const ths = [...tabela.querySelectorAll('thead tr:first-child th')];
    if (!thead || ths.length === 0) return null;
    const tr = document.createElement('tr');
    tr.className = FILTRO_ROW_CLASS;
    ths.forEach((th) => {
      const cell = document.createElement('th');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'munic-pro-filtro-col';
      // The heading text, so a screen reader hears which column this box
      // belongs to — the visual association is position alone.
      const rotulo = String(th.textContent || '').replace(/\s+/g, ' ').trim();
      input.setAttribute('aria-label', `Filtrar ${rotulo}`);
      input.title = `Filtrar por ${rotulo}`;
      cell.appendChild(input);
      tr.appendChild(cell);
    });
    thead.appendChild(tr);
    return tr;
  }

  // Wired through the DataTables API rather than DOM filtering:
  // column().search() respects the table's own dataset, so filtering
  // works on off-page rows exactly like the global "Filtrar:" box does.
  function wireFiltroRow(dt, tr) {
    if (!tr) return;
    // The boxes are an enhancement: a DataTables without the columns()
    // API leaves the table sorted and paged, just unfiltered per column.
    if (!dt || typeof dt.columns !== 'function') {
      tr.remove();
      return;
    }
    const celulas = [...tr.children];
    // Sorting is bound to the header CELL, so a click to focus a box (or
    // a keystroke inside it) would otherwise re-sort the column under it.
    tr.addEventListener('click', (e) => e.stopPropagation());
    let coluna = 0;
    dt.columns().every(function each() {
      const idx = typeof this.index === 'function' ? this.index() : coluna;
      coluna += 1;
      const celula = celulas[idx];
      const input = celula && celula.querySelector('input');
      if (!input) return;
      input.addEventListener('input', () => {
        if (this.search() === input.value) return;
        this.search(input.value).draw();
      });
    });
  }

  // DataTables ships English chrome; every other string in this panel is
  // Portuguese, so its own controls have to be too. Inlined, never
  // fetched from DataTables' CDN language files — no third-party
  // requests, by the same rule that keeps DataTables itself unvendored.
  const DT_PT_BR = {
    search: 'Filtrar:',
    lengthMenu: '_MENU_ linhas por página',
    info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
    infoEmpty: 'Nenhum registro',
    infoFiltered: '(filtrado de _MAX_ no total)',
    zeroRecords: 'Nenhum registro encontrado',
    emptyTable: 'Sem dados',
    paginate: { first: 'Primeira', last: 'Última', next: 'Próxima', previous: 'Anterior' },
  };

  const PANEL_PAGE_LENGTH = 25;

  // Initializes DataTables (sorting, paging, per-column filtering) on
  // every table in the panel. A no-op — plain tables keep working,
  // unsorted and unpaged — when window.jQuery or $.fn.dataTable is
  // absent: the panel must never depend on DataTables existing.
  function initPanelTables(panelEl) {
    const jq = window.jQuery || window.$;
    if (!jq || !jq.fn || !jq.fn.dataTable || !panelEl) return;
    panelEl.querySelectorAll('table').forEach((tbl) => {
      // The mismatch check guards CONSTRUCTION only: it runs before
      // DataTable() is ever called on this table. Our builders keep
      // header and body cell counts in step by construction (tested
      // directly), so this is a backstop against a future edit, not a
      // known case. Refusing to initialize costs sorting and paging;
      // handing DataTables a mismatched table costs an undismissable
      // alert() the whole page can't recover from.
      try {
        // Idempotent: Relatório can rebuild the panel and call this
        // again. Re-calling DataTable({...}) on an already-claimed table
        // throws, so an existing instance is adjusted in place instead.
        if (jq.fn.dataTable.isDataTable(tbl)) {
          const dtExistente = jq(tbl).DataTable();
          wireFiltroRow(dtExistente, buildFiltroRow(tbl));
          return;
        }
        if (!colunasBatem(tbl)) {
          console.warn(`${TAG} tabela com contagem de colunas inconsistente; ` +
            'não inicializada no DataTables.');
          return;
        }
        // BEFORE the filter row exists, so colunasBatem's header count
        // and DataTables' own column detection both see the original
        // thead, undecorated.
        const dt = jq(tbl).DataTable({
          pageLength: PANEL_PAGE_LENGTH,
          lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'Todos']],
          order: [], // keep the order the panel built
          language: DT_PT_BR,
          // The filter row is ours, not a heading: without this
          // DataTables reads it as part of the header and binds sorting
          // to the boxes themselves.
          orderCellsTop: true,
        });
        wireFiltroRow(dt, buildFiltroRow(tbl));
      } catch (err) {
        // A failed init is not fatal: the plain table still renders
        // every row, just without sorting, paging or filtering.
        console.warn(`${TAG} não foi possível inicializar a tabela:`, err);
      }
    });
  }

  // Shows or hides a tab's table.
  //
  // Must toggle the DataTables WRAPPER when there is one, not the <table>:
  // DataTables moves the table inside a div.dataTables_wrapper that also
  // holds the length selector, the search box and the pagination. Hiding
  // only the table leaves that furniture on screen, so every tab's controls
  // stack up at once — which is exactly what the live page showed, three
  // sets of "linhas por página / Filtrar" with different record counts.
  //
  // Falls back to the table itself before initialisation, or when
  // DataTables is absent entirely.
  function paneRoot(pane) {
    return pane.closest('.dataTables_wrapper') || pane;
  }

  function showPane(pane, visible) {
    // Clear the inline display on BOTH the table and its wrapper, then set
    // it on whichever is the current root.
    //
    // Panes are hidden before DataTables runs, so the first hide lands on
    // the bare <table>. Once DataTables wraps it, showing the pane cleared
    // the wrapper but left display:none on the table inside — controls and
    // "89 registros" visible, no rows. Clearing both makes the two orders
    // equivalent.
    pane.style.display = '';
    const root = paneRoot(pane);
    root.style.display = '';
    if (!visible) root.style.display = 'none';
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

    // "Agência × Município" stays dropped (change #3): with roughly one
    // município per group, every row there read 100%, which is noise.
    // Agência / Agência % (plain, grouped by agência alone) are restored
    // here to match the 2025 workbook's five sheets, in the same order:
    // município grid, then assistência counts + percentages, then
    // agência counts + percentages.
    const tabNames = [
      'Município', 'Assistência', 'Assistência %', 'Agência', 'Agência %',
    ];
    const panes = [
      renderMunicipioTab(data.grid, data.columns),
      renderGroupTab(data.porAssistencia, data.columns, fmtCount),
      renderGroupTab(data.porAssistenciaPct, data.columns, fmtPct, 'pctCells'),
      renderGroupTab(data.porAgencia, data.columns, fmtCount),
      renderGroupTab(data.porAgenciaPct, data.columns, fmtPct, 'pctCells'),
    ];

    const buttons = tabNames.map((name, i) => {
      const b = el('button', { type: 'button', text: name });
      b.setAttribute('data-munic-pro-tab', String(i));
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        buttons.forEach((other, j) => {
          other.setAttribute('aria-selected', i === j ? 'true' : 'false');
          showPane(panes[j], i === j);
        });
      });
      return b;
    });

    panes.forEach((p, i) => { showPane(p, i === 0); });

    panel.appendChild(el('div', { class: 'munic-pro-tabs' }, buttons));
    for (const p of panes) panel.appendChild(p);
    return panel;
  }

  // Builds the button row. Kept thin: every piece of logic it calls is
  // tested on its own.
  function buildActions() {
    // Its own line under the buttons, not trailing after them: the row is
    // right-aligned, so a growing status message ("8 linhas, 3 mudança(s).
    // Situação desconhecida: …") would shove the buttons leftward as it
    // appears and snap them back when it clears.
    const status = el('div', { id: 'munic-pro-status' });
    status.style.marginTop = '6px';
    status.style.minHeight = '1.2em';
    // A block-level row, right-aligned to line up with SIGC's own button
    // row above it. `text-sm-end` is the portal's own alignment class, so
    // ours tracks theirs if the page's breakpoint behaviour changes.
    // No Bootstrap grid classes. `col-12` only behaves inside a `.row`,
    // and when this lands anywhere else it applies grid padding and width
    // rules with nothing to constrain them — the row then runs past the
    // container's right edge and the last buttons sit off-screen until you
    // zoom out. Observed on the live page.
    //
    // Plain flex instead, so the row is correct wherever it is mounted:
    // wraps rather than overflowing, and stays inside its parent's width.
    // A plain block inside SIGC's own col-12, which is already
    // right-aligned (text-sm-end) and already spans the card. Ours adds
    // only the gap above, so it reads as a second line of that row.
    const bar = el('div', { id: 'munic-pro-actions' });
    bar.style.marginTop = '10px';

    // A plain block with text-align:right, NOT a flex row.
    //
    // Flex made the status <div> a flex ITEM: block-level with no flex
    // sizing, it claimed a whole slot and forced a wrap, which then stacked
    // the buttons in the narrow space left over. Verified against the live
    // markup — the parent is div.box-footer with 20px side padding, and a
    // width:100% child inside it fought that padding too.
    //
    // Inline-block buttons flow and wrap like SIGC's own row above, which
    // is plain text-align:right markup and lays out correctly. The status
    // is a block below them, out of the buttons' flow entirely.
    const row = el('div', { id: 'munic-pro-actions-row' });

    const say = (msg) => { status.textContent = msg; };

    // How old the newest run may be before Relatório-PRO refetches.
    // One minute: essentially just a double-click guard. Anything longer
    // risks presenting a stale reading as current, and the fetch is a
    // single request.
    const VALIDADE_MS = 60 * 1000;

    async function atualizarSeVelho() {
      const FETCH = window.__municProSituacaoFetch;
      const STORE = window.__municProSituacaoStore;
      const EXPORT = window.__municProSituacaoExport;
      const FETCH_INTERNALS = window.__municProSituacaoFetchInternals;

      // Without the fetch layer there is nothing to refresh from, but the
      // stored history is still worth showing — so fall through to the
      // panel rather than throwing and leaving the colleague with nothing.
      if (!FETCH || !FETCH_INTERNALS) {
        say('sem a camada de busca; mostrando o histórico guardado.');
        return;
      }

      const runs = await STORE.getRuns();
      const ultimo = runs.length ? runs[runs.length - 1].run_ts : null;
      const idadeMs = ultimo
        ? Date.now() - new Date(ultimo).getTime()
        : Infinity;

      if (idadeMs < VALIDADE_MS) {
        // Say so explicitly: without this the colleague cannot tell a
        // fresh reading from a cached one, which is the whole risk of
        // fetching conditionally.
        const min = Math.max(1, Math.round(idadeMs / 60000));
        say(`dados de ${min} min atrás (não rebuscado).`);
        return;
      }

      // Only the UF is read from the page. The Agência dropdown is
      // ignored on purpose: this report is UF-wide ("Críticas da UF"),
      // and a snapshot narrowed to one agência would make the SCD diff
      // close every município outside it.
      const uf = FETCH_INTERNALS.readUf();
      if (!uf) { say('Selecione a Unidade Estadual.'); return; }

      say('buscando…');
      const { rows, warnings } = await FETCH.fetchSituacao(uf);
      const runTs = window.__municPro.localTimestamp();
      const { nChanged } = await STORE.saveSnapshot(rows, runTs, warnings);
      say(`${rows.length} linhas, ${nChanged} mudança(s).` +
          (warnings.length ? ` ${warnings.join(' | ')}` : ''));
    }

    // One button instead of the old Atualizar + Relatório pair: two steps
    // where the colleague only ever wanted "show me the current picture".
    const relatorio = makeButton('Relatório-PRO', async () => {
      const STORE = window.__municProSituacaoStore;
      try {
        await atualizarSeVelho();
      } catch (err) {
        console.error(TAG, err);
        say(`erro: ${err.message}`);
        return;   // no panel on a failed fetch — stale data unannounced
                  // is worse than none
      }

      const existing = document.querySelector('.munic-pro-panel');
      if (existing) existing.remove();

      const allRows = await STORE.getAll();
      const runs = await STORE.getRuns();
      if (!runs.length) { say('Sem histórico ainda.'); return; }

      const columns = AGG.weekColumns(runs);
      const current = AGG.situacaoAsOf(allRows, runs[runs.length - 1].run_ts);
      // assistencia_nome is not a stored field — it is derived from the
      // agência code through the vendored lookup.
      const { assistenciaDe } = window.__municProAssistencias;
      // Signature is (allRows, groupFields, columns) — argument order
      // matters and a wrong one silently yields empty group labels.
      //
      // assistencia_nome is derived, not stored, so the rows are decorated
      // with it before grouping; agencia_nome is a stored field and needs
      // no decoration.
      const rowsComAssistencia = allRows.map((r) => ({
        ...r,
        assistencia_nome: assistenciaDe(r.agencia_codigo, r.agencia_nome),
      }));
      const porAssistencia = AGG.groupCountsByColumn(
        rowsComAssistencia, ['assistencia_nome'], columns);
      const porAgencia = AGG.groupCountsByColumn(
        allRows, ['agencia_nome'], columns);

      const panel = buildPanel({
        grid: AGG.municipioGrid(allRows, columns),
        columns,
        porAssistencia,
        porAssistenciaPct: porAssistencia,
        porAgencia,
        porAgenciaPct: porAgencia,
        warnings: runs[runs.length - 1].warnings || [],
        lastRun: runs[runs.length - 1].run_ts,
      });

      const card = bar.closest('.card') || bar.parentElement.parentElement;
      card.parentElement.insertBefore(panel, card.nextSibling);
      // After insertion, not before: DataTables reads each table's live
      // layout, and an un-inserted table has none to read.
      initPanelTables(panel);
    });

    // One CSV, not two. The state-change shape (one row per change, with
    // from/until) was dropped: both carried the same history, and having
    // to explain the difference at the button was the tell that it did
    // not belong there. This is the shape that pivots without any
    // interval reasoning — one row per município per run.
    const csv = makeButton('CSV-PRO', async () => {
      const STORE = window.__municProSituacaoStore;
      window.__municProSituacaoExport.downloadDenormalizedCsv(
        await STORE.getAll(), await STORE.getRuns());
    });

    // The JSON snapshot used to download on every fetch. That put a file
    // in Downloads each time the colleague opened the report, which is
    // noise — it is a backup, taken when you want one.
    const backup = makeButton('Backup JSON', async () => {
      const STORE = window.__municProSituacaoStore;
      window.__municProSituacaoExport.downloadSnapshot(
        await STORE.getAll(), await STORE.getRuns());
      say('backup baixado.');
    });

    const actions = [relatorio, csv, backup];
    for (const b of actions) row.appendChild(b);
    bar.appendChild(row);
    bar.appendChild(status);
    return bar;
  }

  window.__municProSituacaoReport = { buildActions };
  window.__municProSituacaoReportInternals = {
    onSituacaoPage,
    buildActions,
    indicadorLabel,
    showPane,
    paneRoot,
    makeButton,
    situacaoClass,
    renderMunicipioTab,
    renderGroupTab,
    buildPanel,
    actionsAnchor,
    PAGE_BUTTON_IDS,
    ANCHOR_ID,
    fmtCount,
    fmtPct,
    colunasBatem,
    buildFiltroRow,
    wireFiltroRow,
    initPanelTables,
    FILTRO_ROW_CLASS,
  };

  // Resolves to the PARENT of the row that holds SIGC's buttons, so our
  // row is APPENDED into that same container — one more full-width row
  // after SIGC's, still inside whatever card wraps them both.
  //
  // An earlier version anchored to the row itself and inserted 'after' it
  // as the row's next SIBLING. On the live page that row is the last
  // child of a flex/row container, so a sibling of it lands outside that
  // container — outside the card's padded area — rather than below SIGC's
  // row inside the card. Appending into the row's own parent keeps the
  // new row a child of the same container SIGC's row is in, so it cannot
  // land outside it.
  //
  // Anchoring to the button itself (rather than the row) put four more
  // items into a right-aligned, single-line group: they overflowed,
  // wrapped mid-group, and left two of ours stranded on a second line
  // with no visual relationship to the other two. A row of our own keeps
  // them together and reads as a separate set of controls, which is what
  // they are.
  //
  // Falls back to the button's own parent if the expected col-12 wrapper
  // is absent, so a markup change degrades to a working placement rather
  // than to nothing.
  // The div.col-12 that already holds SIGC's buttons — we append INTO it,
  // so our buttons are simply a second line of the same row.
  //
  // Earlier versions climbed to that div's PARENT and appended there,
  // which put our block in whatever container happened to wrap the row.
  // When that container was narrow, the buttons stacked into a column
  // beside SIGC's row instead of below it. The col-12 already spans the
  // card and already right-aligns its contents; nothing else is needed.
  function actionsAnchor() {
    const btn = document.getElementById(ANCHOR_ID);
    if (!btn) return null;
    return btn.closest('div.col-12') || btn.parentElement;
  }

  if (typeof document !== 'undefined' && document.body) {
    window.__municPro.mountWidget({
      id: 'munic-pro-actions',
      anchor: actionsAnchor,
      insert: 'append',
      when: () => onSituacaoPage(),
      build: buildActions,
    });
  }
})();
