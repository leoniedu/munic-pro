// Turns stored SCD type-2 history into the three tabs' data.
//
// Pure functions over plain arrays: no DOM, no IndexedDB. The rendering
// in situacao-report.js does no arithmetic of its own, so all of the
// report's logic is covered by tests that need neither a browser nor a
// portal session.
(function () {
  'use strict';

  if (window.__municProSituacaoAggregate) return;

  // Display order for the buckets. Unknown values are appended at the
  // end by the caller rather than folded into one of these.
  const SITUACAO_ORDER = [
    'Não Iniciado',
    'Digitação/Validação',
    'Supervisão/Análise',
    'Concluído',
  ];

  // Ports the 2025 report's recode (R/report.R:22-25) from raw SIGC
  // situações into the Excel's four buckets.
  //
  // Deliberately WITHOUT the R code's `.default = "Supervisão/Análise"`:
  // that silently absorbed any unrecognised status into a bucket it was
  // never observed to belong to. Here an unmapped situação passes
  // through unchanged — raw and (per situacaoClass) uncoloured — so a
  // new SIGC status is visible as itself instead of being mislabelled.
  //
  // "Supervisão/Análise" remains a bucket the colour table knows about;
  // nothing currently maps into it.
  const SITUACAO_BUCKET = {
    'Não Iniciado': 'Não Iniciado',
    'Dig. Informante': 'Digitação/Validação',
    'Dig. Ibge': 'Digitação/Validação',
    'Em Validação': 'Digitação/Validação',
    'Concluído': 'Concluído',
  };

  function situacaoRec(situacao) {
    if (situacao === null || situacao === undefined) return situacao;
    return SITUACAO_BUCKET[situacao] || situacao;
  }

  // One column per run THAT PRODUCED A CHANGE (n_changed > 0). A run
  // where nothing moved adds no column — it is still recorded in the
  // `runs` table (so "we ran and nothing moved" stays distinguishable
  // from "nobody ran it"), it just does not earn a place in the report's
  // grid.
  //
  // Replaces the earlier one-column-per-ISO-week scheme: with runs of
  // uncertain cadence, a week is an arbitrary unit, and a week with no
  // run added a column whose only content was "nothing to show" — noise
  // once every run (change or not) is already visible in the export and
  // the run count. Per the given direction: "keep all runs when there
  // was a difference... if this gets too unwieldy we can prune later" —
  // no pruning is implemented here.
  function runColumns(runs) {
    return runs
      .filter((r) => (r.n_changed || 0) > 0)
      .map((r) => ({ run_ts: r.run_ts }));
  }

  // The rows open at an instant. from_ts is inclusive and until_ts
  // exclusive, so at the exact moment of a change only the new row
  // matches — otherwise a município would appear twice in that column.
  function situacaoAsOf(allRows, ts) {
    const t = String(ts);
    return allRows.filter((r) =>
      String(r.from_ts) <= t && (r.until_ts === null || String(r.until_ts) > t));
  }

  function gridKey(r) {
    return `${r.municipio_codigo}|${r.questionario}`;
  }

  // The three rows the Excel emits per município per questionário, in
  // display order. situacao_rec holds the BUCKETED status (change #2);
  // the críticas rows hold raw counts.
  const MUNICIPIO_GRID_NAMES = [
    'criticas_informativas',
    'criticas_comparativas',
    'situacao_rec',
  ];

  function cellForName(hit, name) {
    if (!hit) return null;
    if (name === 'situacao_rec') return situacaoRec(hit.situacao);
    // Missing on a row (e.g. fixtures / not yet fetched) reads as null.
    return hit[name] ?? null;
  }

  // Three lines per município per questionário — one per
  // MUNICIPIO_GRID_NAMES entry — with one cell per column. Replaces the
  // old single-row-per-questionário shape, which dropped the críticas
  // history entirely; that history is what this restores.
  function municipioGrid(allRows, columns) {
    // Display names come from the row with the latest from_ts for each
    // key, not whichever row is encountered first — getAll() returns
    // rows in insertion order, so "first" would otherwise mean the
    // earliest (possibly closed, possibly misspelled) row.
    const latestByKey = new Map();
    for (const r of allRows) {
      const key = gridKey(r);
      const prev = latestByKey.get(key);
      if (!prev || String(r.from_ts) > String(prev.from_ts)) {
        latestByKey.set(key, r);
      }
    }

    const asOfCache = columns.map((c) => situacaoAsOf(allRows, c.run_ts));

    const out = [];
    for (const [key, r] of latestByKey) {
      for (const name of MUNICIPIO_GRID_NAMES) {
        out.push({
          key: `${key}|${name}`,
          municipio_codigo: r.municipio_codigo,
          municipio_nome: r.municipio_nome,
          agencia_nome: r.agencia_nome,
          // Carried so the renderer can derive assistência, which is not a
          // stored field — it comes from the agência code via the vendored
          // lookup. Without the code here the Município tab could only show
          // the agência, which is what it did before.
          agencia_codigo: r.agencia_codigo,
          questionario: r.questionario,
          name,
          cells: asOfCache.map((rows) => {
            const hit = rows.find((row) => gridKey(row) === key);
            return cellForName(hit, name);
          }),
        });
      }
    }

    // Sort by município/questionário first, keeping the três rows for a
    // given (município, questionário) adjacent, in MUNICIPIO_GRID_NAMES
    // order.
    return out.sort((a, b) =>
      a.municipio_nome.localeCompare(b.municipio_nome, 'pt-BR') ||
      a.questionario.localeCompare(b.questionario, 'pt-BR') ||
      MUNICIPIO_GRID_NAMES.indexOf(a.name) - MUNICIPIO_GRID_NAMES.indexOf(b.name));
  }

  // Counts and within-group percentages. Percentages are of the group's
  // own total, matching the 2025 report's *_pct sheets (R/report.R:196-200).
  //
  // situações are bucketed via situacaoRec() before counting (change #2),
  // so e.g. 'Dig. Ibge' and 'Dig. Informante' land in the same
  // 'Digitação/Validação' row instead of two separate ones.
  function groupCounts(rows, groupFields) {
    const totals = new Map();
    const counts = new Map();

    for (const r of rows) {
      const group = groupFields.map((f) => r[f] ?? '').join(' | ');
      totals.set(group, (totals.get(group) || 0) + 1);
      const situacao = situacaoRec(r.situacao);
      const k = `${group}\u0000${situacao}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }

    const out = [];
    for (const [k, n] of counts) {
      const [group, situacao] = k.split('\u0000');
      out.push({ group, situacao, n, pct: n / totals.get(group) });
    }

    return out.sort((a, b) =>
      a.group.localeCompare(b.group, 'pt-BR') ||
      SITUACAO_ORDER.indexOf(a.situacao) - SITUACAO_ORDER.indexOf(b.situacao));
  }

  // Per (group, situação-bucket) pair, one cell per column — the group
  // tabs' Excel-matching shape (change #3): the Excel's
  // situacao_assistencia / _pct sheets have one column per date, not a
  // single current-snapshot column.
  //
  // pctCells are within-group-within-column percentages, mirroring
  // groupCounts's own pct but recomputed per column since a group's
  // total can itself change week to week (a município's row can be
  // absent before its first observed run).
  function groupCountsByColumn(allRows, groupFields, columns) {
    const asOfCache = columns.map((c) => situacaoAsOf(allRows, c.run_ts));

    const seen = new Map(); // group\u0000situacao -> {group, situacao}
    const perColumnCounts = asOfCache.map((rows) => {
      const totals = new Map();
      const counts = new Map();
      for (const r of rows) {
        const group = groupFields.map((f) => r[f] ?? '').join(' | ');
        totals.set(group, (totals.get(group) || 0) + 1);
        const situacao = situacaoRec(r.situacao);
        const k = `${group}\u0000${situacao}`;
        counts.set(k, (counts.get(k) || 0) + 1);
        if (!seen.has(k)) seen.set(k, { group, situacao });
      }
      return { totals, counts };
    });

    const out = [];
    for (const [k, { group, situacao }] of seen) {
      const cells = [];
      const pctCells = [];
      for (const col of perColumnCounts) {
        const n = col.counts.get(k) || 0;
        cells.push(n);
        const total = col.totals.get(group);
        pctCells.push(total ? n / total : null);
      }
      out.push({ group, situacao, cells, pctCells });
    }

    return out.sort((a, b) =>
      a.group.localeCompare(b.group, 'pt-BR') ||
      SITUACAO_ORDER.indexOf(a.situacao) - SITUACAO_ORDER.indexOf(b.situacao));
  }

  window.__municProSituacaoAggregate = {
    runColumns,
    situacaoAsOf,
    municipioGrid,
    groupCounts,
    groupCountsByColumn,
    situacaoRec,
    SITUACAO_BUCKET,
    SITUACAO_ORDER,
  };
})();
