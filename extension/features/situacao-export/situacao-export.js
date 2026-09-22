// Exports: a JSON snapshot (the durability artifact) and two CSV shapes.
//
// The CSVs are for the author's analysis in R and for LibreOffice — NOT
// for the colleague's daily use. The machine running this has Excel
// Online, which cannot pivot a local CSV, which is why the in-browser
// panel carries the report.
//
// No network here: Blob + object URL only, which is why this directory
// is not fetch-sanctioned.
(function () {
  'use strict';

  if (window.__municProSituacaoExport) return;

  const { buildCsv, downloadFile, timestampSlug } = window.__municPro;
  const { situacaoAsOf } = window.__municProSituacaoAggregate;

  const STATE_HEADER = [
    'municipio_codigo', 'municipio_nome',
    'agencia_codigo', 'agencia_nome',
    'questionario', 'situacao',
    'criticas_informativas', 'criticas_comparativas',
    'from_ts', 'until_ts',
  ];

  const DENORM_HEADER = [
    'run_ts',
    'municipio_codigo', 'municipio_nome',
    'agencia_codigo', 'agencia_nome',
    'questionario', 'situacao',
    'criticas_informativas', 'criticas_comparativas',
  ];

  // Full fidelity, for re-import after a cleared profile and for
  // reconciling two machines' histories.
  function snapshotJson(allRows, runs) {
    return JSON.stringify({
      version: 1,
      exported_at: new Date().toISOString(),
      rows: allRows,
      runs,
    }, null, 2);
  }

  // One line per stored state, mirroring the store exactly. Compact, and
  // the right shape for interval analysis in R.
  function stateChangeCsv(allRows) {
    const rows = allRows.map((r) => STATE_HEADER.map((f) => r[f] ?? ''));
    return buildCsv(STATE_HEADER, rows);
  }

  // One line per run per município: every line is an independent
  // timestamped observation, so a pivot table needs no interval logic.
  // Larger than the state-change form, and much easier to consume.
  function denormalizedCsv(allRows, runs) {
    const rows = [];
    for (const run of runs) {
      for (const r of situacaoAsOf(allRows, run.run_ts)) {
        rows.push([
          run.run_ts,
          r.municipio_codigo, r.municipio_nome,
          r.agencia_codigo, r.agencia_nome,
          r.questionario, r.situacao,
          r.criticas_informativas, r.criticas_comparativas,
        ]);
      }
    }
    return buildCsv(DENORM_HEADER, rows);
  }

  function downloadSnapshot(allRows, runs) {
    const { data } = timestampSlug();
    // bom:false — JSON declares its own encoding, and a BOM breaks
    // strict parsers on re-import.
    downloadFile(
      `munic2026_${data}.json`,
      snapshotJson(allRows, runs),
      'application/json;charset=utf-8',
      { bom: false },
    );
  }

  function downloadDenormalizedCsv(allRows, runs) {
    const { data } = timestampSlug();
    downloadFile(`munic2026_observacoes_${data}.csv`,
      denormalizedCsv(allRows, runs));
  }

  function downloadStateChangeCsv(allRows) {
    const { data } = timestampSlug();
    downloadFile(`munic2026_mudancas_${data}.csv`, stateChangeCsv(allRows));
  }

  window.__municProSituacaoExport = {
    snapshotJson,
    denormalizedCsv,
    stateChangeCsv,
    downloadSnapshot,
    downloadDenormalizedCsv,
    downloadStateChangeCsv,
  };
})();
