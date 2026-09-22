// Turns stored SCD type-2 history into the three tabs' data.
//
// Pure functions over plain arrays: no DOM, no IndexedDB. The rendering
// in situacao-report.js does no arithmetic of its own, so all of the
// report's logic is covered by tests that need neither a browser nor a
// portal session.
(function () {
  'use strict';

  if (window.__municProSituacaoAggregate) return;

  const { isoWeek } = window.__municPro;

  // Display order for the buckets. Unknown values are appended at the
  // end by the caller rather than folded into one of these.
  const SITUACAO_ORDER = [
    'Não Iniciado',
    'Dig. Informante',
    'Dig. Ibge',
    'Em Validação',
    'Concluído',
  ];

  // One column per ISO week, holding the LAST run of that week.
  //
  // Deliberately not the 2025 rule (R/report.R:141-163), which picked
  // the run whose weekday was closest to the latest run's weekday. That
  // is sensible for near-daily runs and misleading for irregular ones: a
  // week represented by a Monday run would sit beside a week represented
  // by a Friday run as though they were comparable.
  //
  // Weeks with no run are emitted with run_ts null, so a gap in
  // monitoring is visible instead of being closed up.
  function weekColumns(runs) {
    if (!runs.length) return [];

    const lastByWeek = new Map();
    for (const r of runs) {
      const week = isoWeek(new Date(r.run_ts));
      const prev = lastByWeek.get(week);
      if (!prev || String(r.run_ts) > String(prev)) {
        lastByWeek.set(week, r.run_ts);
      }
    }

    const sortedTs = runs.map((r) => r.run_ts).sort();
    const first = new Date(sortedTs[0]);
    const last = new Date(sortedTs[sortedTs.length - 1]);

    // Walk week by week from the first run to the last so gaps appear.
    // Stepping 7 days from a normalized Monday avoids month-length and
    // year-boundary arithmetic entirely.
    const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    cursor.setDate(cursor.getDate() - ((cursor.getDay() || 7) - 1));

    const out = [];
    const guard = 1000; // a run history longer than ~19 years is a bug
    for (let i = 0; cursor <= last && i < guard; i += 1) {
      const week = isoWeek(cursor);
      out.push({ week, run_ts: lastByWeek.get(week) ?? null });
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
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

  // One line per município per questionário, with one cell per column.
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

    const byKey = new Map();
    for (const [key, r] of latestByKey) {
      byKey.set(key, {
        key,
        municipio_codigo: r.municipio_codigo,
        municipio_nome: r.municipio_nome,
        agencia_nome: r.agencia_nome,
        questionario: r.questionario,
        cells: [],
      });
    }

    const asOfCache = columns.map((c) =>
      (c.run_ts === null ? null : situacaoAsOf(allRows, c.run_ts)));

    for (const [key, line] of byKey) {
      line.cells = asOfCache.map((rows) => {
        if (rows === null) return null;
        const hit = rows.find((r) => gridKey(r) === key);
        return hit ? hit.situacao : null;
      });
    }

    return [...byKey.values()].sort((a, b) =>
      a.municipio_nome.localeCompare(b.municipio_nome, 'pt-BR') ||
      a.questionario.localeCompare(b.questionario, 'pt-BR'));
  }

  // Counts and within-group percentages. Percentages are of the group's
  // own total, matching the 2025 report's *_pct sheets (R/report.R:196-200).
  function groupCounts(rows, groupFields) {
    const totals = new Map();
    const counts = new Map();

    for (const r of rows) {
      const group = groupFields.map((f) => r[f] ?? '').join(' | ');
      totals.set(group, (totals.get(group) || 0) + 1);
      const k = `${group}\u0000${r.situacao}`;
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

  window.__municProSituacaoAggregate = {
    weekColumns,
    situacaoAsOf,
    municipioGrid,
    groupCounts,
    SITUACAO_ORDER,
  };
})();
