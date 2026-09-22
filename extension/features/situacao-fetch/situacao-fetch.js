// Fetches the MUNIC situação report from SIGC.
//
// One POST covers the whole UF: IdAgencia=1 does NOT filter (live
// responses span several agências), IdMunicipio=0 means all, and
// TipoQuestionario=0 returns both Básico and Suplementar. The 2025 R
// package made one request per município for críticas — about 417 of
// them — which this replaces entirely.
//
// This directory is fetch-sanctioned by scripts/check-network.sh, which
// also forbids absolute URLs here: every request goes through
// fetchViaGateway and is therefore relative to location.origin.
(function () {
  'use strict';

  if (window.__municProSituacaoFetch) return;

  const { fetchViaGateway } = window.__municPro;
  const { parseSituacao } = window.__municProSituacaoParse;

  const SITUACAO_PATH = '/Relatorio/RelSituacaoMunicipioDados';

  const REQUEST_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    // ASP.NET MVC partial views commonly gate on IsAjaxRequest(), which
    // reads this header. Both endpoints here are partial views.
    'X-Requested-With': 'XMLHttpRequest',
  };

  function buildBody(uf) {
    const objJson = JSON.stringify({
      IdUf: Number(uf),
      IdAgencia: 1,
      IdMunicipio: 0,
      TipoQuestionario: 0,
    });
    return 'objJson=' + encodeURIComponent(objJson);
  }

  // The filter form's UF <select> is dressed as a select2 combobox: the
  // visible text is a rendered span, but the original <select> stays in
  // the DOM and its .value is still readable.
  function readUf() {
    const s = document.getElementById('IdUf');
    return s ? s.value : '';
  }

  // Both failures below arrive as HTTP 200, so they must be detected by
  // body content. Checked before parsing, so the user is told the
  // session died rather than that a table was missing.
  function assertAuthenticated(html) {
    if (/<title>\s*Working/i.test(html)) {
      throw new Error(
        'A sessão do portalweb expirou. Recarregue a página, ' +
        'faça login novamente e repita.',
      );
    }
    if (/type=["']password["']/i.test(html)) {
      throw new Error(
        'A sessão do SIGC expirou. Recarregue a página, ' +
        'faça login novamente e repita.',
      );
    }
  }

  async function fetchSituacao(uf) {
    const res = await fetchViaGateway(SITUACAO_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: REQUEST_HEADERS,
      body: buildBody(uf),
    });
    const html = await res.text();
    assertAuthenticated(html);
    const { rows, warnings } = parseSituacao(html);
    return { rows, warnings, html };
  }

  window.__municProSituacaoFetch = { fetchSituacao };
  window.__municProSituacaoFetchInternals = {
    buildBody,
    readUf,
    REQUEST_HEADERS,
    SITUACAO_PATH,
  };
})();
