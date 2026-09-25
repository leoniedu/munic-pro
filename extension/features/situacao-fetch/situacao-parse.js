// Parses the RelSituacaoMunicipioDados response into tidy rows.
//
// Pure: takes HTML text, returns data. No network, no storage — which is
// what makes it testable against the live sample in tests/fixtures/.
//
// 2026 returns one row per município PER QUESTIONÁRIO (Básico and
// Suplementar), each with its own situação and críticas. The 2025 R
// package assumed one row per município and would double every count.
(function () {
  'use strict';

  if (window.__municProSituacaoParse) return;

  const { normalizeLabel } = window.__municPro;

  // Expected header labels, left to right. Compared after
  // normalizeLabel, so spacing and case don't matter — but a renamed or
  // reordered column fails the run rather than silently shifting data
  // into the wrong field. Borrowed from sigc-pro's column-assertion
  // approach, which exists because SIGC does change layouts.
  const EXPECTED_COLUMNS = [
    'uf',
    'agência',
    'município',
    'questionário',
    'críticas informativas',
    'críticas comparativas',
    'situação',
  ];

  // The 2025 vocabulary (R/report.R:22-25), treated as a prior rather
  // than a guarantee: at the time of writing only "Não Iniciado" had
  // been seen in 2026, because collection had not started. An unknown
  // value passes through raw and is reported — never mapped into a
  // bucket it was not observed to belong to, which is exactly what the
  // R code's `.default` did silently.
  const KNOWN_SITUACOES = new Set([
    'Não Iniciado',
    'Dig. Informante',
    'Dig. Ibge',
    'Em Validação',
    // First seen live in September 2026.
    'Em Supervisão',
    'Em Análise',
    'Concluído',
  ]);

  // SIGC writes "-" for an absent count.
  function parseCritica(text) {
    const t = String(text ?? '').trim();
    if (t === '' || t === '-' || t === '—') return 0;
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  // "290070200 - ALAGOINHAS" -> ['290070200', 'ALAGOINHAS'].
  // Splits on the FIRST " - " only: a município name may itself contain
  // a hyphen, and splitting on every occurrence would truncate it.
  function splitCodigoNome(text) {
    const t = String(text ?? '').trim();
    const i = t.indexOf(' - ');
    if (i === -1) return [t, ''];
    return [t.slice(0, i).trim(), t.slice(i + 3).trim()];
  }

  function parseSituacao(html) {
    // DOMParser is inert: nothing in the fetched markup can load a
    // resource or run a handler. Same guarantee sigc-pro's parsers rely
    // on.
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.getElementById('tblMunicipios');
    if (!table) {
      throw new Error(
        'Resposta do SIGC sem a tabela #tblMunicipios — ' +
        'a sessão pode ter expirado, ou o relatório mudou.',
      );
    }

    const headers = [...table.querySelectorAll('thead th')]
      .map((th) => normalizeLabel(th.textContent));
    const expected = EXPECTED_COLUMNS.map(normalizeLabel);
    if (headers.length !== expected.length ||
        headers.some((h, i) => h !== expected[i])) {
      throw new Error(
        `Colunas inesperadas no relatório.\n` +
        `Esperado: ${expected.join(' | ')}\n` +
        `Recebido: ${headers.join(' | ')}`,
      );
    }

    const trs = [...table.querySelectorAll('tbody tr')];
    if (trs.length === 0) {
      throw new Error('Tabela de situação vazia — nada foi gravado.');
    }

    const warnings = [];
    const unknown = new Set();
    const seen = new Set();
    const rows = trs.map((tr) => {
      const td = [...tr.querySelectorAll('td')].map((c) => c.textContent.trim());
      const [agencia_codigo, agencia_nome] = splitCodigoNome(td[1]);
      const [municipio_codigo, municipio_nome] = splitCodigoNome(td[2]);
      const situacao = td[6];

      if (situacao && !KNOWN_SITUACOES.has(situacao)) unknown.add(situacao);

      const key = `${municipio_codigo}|${td[3]}`;
      if (seen.has(key)) {
        throw new Error(
          `Linha duplicada para ${municipio_codigo} / ${td[3]} — ` +
          'o relatório não tem o formato esperado.',
        );
      }
      seen.add(key);

      return {
        uf_sigla: td[0],
        agencia_codigo,
        agencia_nome,
        municipio_codigo,
        municipio_nome,
        questionario: td[3],
        criticas_informativas: parseCritica(td[4]),
        criticas_comparativas: parseCritica(td[5]),
        situacao,
      };
    });

    if (unknown.size) {
      warnings.push(
        `Situação desconhecida (mantida como veio, sem cor): ` +
        [...unknown].join(', '),
      );
    }

    return { rows, warnings };
  }

  window.__municProSituacaoParse = { parseSituacao };
})();
