import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-fetch/situacao-parse.js');
await import('../extension/features/situacao-fetch/situacao-fetch.js');

const F = window.__municProSituacaoFetch;
const I = window.__municProSituacaoFetchInternals;
const SAMPLE = readFileSync('tests/fixtures/situacao-sample.html', 'utf8');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('buildBody', () => {
  // Matches the body captured from live 2026 traffic exactly.
  test('URL-encodes the objJson payload', () => {
    expect(I.buildBody(29)).toBe(
      'objJson=' + encodeURIComponent(
        '{"IdUf":29,"IdAgencia":1,"IdMunicipio":0,"TipoQuestionario":0}',
      ),
    );
  });

  test('decodes back to the captured shape', () => {
    const decoded = decodeURIComponent(I.buildBody(29).replace('objJson=', ''));
    expect(JSON.parse(decoded)).toEqual({
      IdUf: 29, IdAgencia: 1, IdMunicipio: 0, TipoQuestionario: 0,
    });
  });

  test('accepts a UF given as a string', () => {
    const decoded = decodeURIComponent(I.buildBody('29').replace('objJson=', ''));
    expect(JSON.parse(decoded).IdUf).toBe(29);
  });
});

describe('REQUEST_HEADERS', () => {
  // Not decorative: these are ASP.NET MVC partial views and commonly
  // gate on IsAjaxRequest(), which keys off X-Requested-With.
  test('declares the AJAX and form-encoding headers', () => {
    expect(I.REQUEST_HEADERS['X-Requested-With']).toBe('XMLHttpRequest');
    expect(I.REQUEST_HEADERS['Content-Type'])
      .toBe('application/x-www-form-urlencoded; charset=UTF-8');
  });
});

describe('readUf', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  // select2 hides the real <select> but leaves it in the DOM, so
  // reading .value still works — same approach sigc-pro uses.
  test('reads the UF from the page select', () => {
    document.body.innerHTML = '<select id="IdUf"><option value="29" selected>29 - BAHIA</option></select>';
    expect(I.readUf()).toBe('29');
  });

  test('returns empty string when the select is absent', () => {
    expect(I.readUf()).toBe('');
  });
});

describe('fetchSituacao', () => {
  test('posts to the situação endpoint and parses the response', async () => {
    let seen = null;
    globalThis.fetch = async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 200, text: async () => SAMPLE };
    };

    const result = await F.fetchSituacao(29);

    expect(seen.options.method).toBe('POST');
    expect(seen.options.credentials).toBe('same-origin');
    expect(seen.url).toContain('/Relatorio/RelSituacaoMunicipioDados');
    expect(result.rows.length).toBe(8);
    expect(result.warnings).toEqual([]);
    expect(result.html).toBe(SAMPLE);
  });

  // An expired session returns HTTP 200 carrying the login page, so a
  // status check alone would treat it as success. assertAuthenticated must
  // run before parseSituacao to detect this and throw the SIGC session error.
  test('reports an expired SIGC session', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<form><input type="password" name="Password"></form>',
    });
    await expect(F.fetchSituacao(29)).rejects.toThrow(/A sessão do SIGC expirou/);
  });

  test('reports the F5 interstitial as a dead portal session', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><title>Working...</title></html>',
    });
    await expect(F.fetchSituacao(29)).rejects.toThrow(/A sessão do portalweb expirou/);
  });

  // Ordering test: if auth check runs after parsing instead of before,
  // a body that is both a login page AND contains valid rows would parse
  // successfully instead of throwing. This test forces correct ordering.
  test('checks authentication before parsing the table', async () => {
    const loginPageWithTable = '<form><input type="password" name="Password"></form>' + SAMPLE;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => loginPageWithTable,
    });
    await expect(F.fetchSituacao(29)).rejects.toThrow(/A sessão do SIGC expirou/);
  });

  test('propagates a transport failure', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    await expect(F.fetchSituacao(29)).rejects.toThrow();
  });
});
