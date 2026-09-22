import { describe, test, expect } from 'bun:test';

await import('../extension/common/munic-common.js');

const M = window.__municPro;

const F5_HEX = '68747470733a2f2f7733736967636d756e6963323032362e696267652e676f762e6272';
const F5_PATH = `/f5-w-${F5_HEX}$$/Relatorio/RelSituacaoMunicipio`;
const ORIGIN = 'https://portalweb.ibge.gov.br';

describe('f5Prefix', () => {
  test('extracts prefix and hex from a gateway pathname', () => {
    expect(M.f5Prefix(F5_PATH)).toEqual({ prefix: `/f5-w-${F5_HEX}$$`, hex: F5_HEX });
  });

  test('returns null on the direct host', () => {
    expect(M.f5Prefix('/Relatorio/RelSituacaoMunicipio')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(M.f5Prefix('')).toBeNull();
    expect(M.f5Prefix(null)).toBeNull();
  });
});

describe('gatewayUrl', () => {
  test('direct host: origin + path, both modes', () => {
    const p = '/Relatorio/RelSituacaoMunicipioDados';
    expect(M.gatewayUrl(ORIGIN, '/Relatorio/X', p, true)).toBe(`${ORIGIN}${p}`);
    expect(M.gatewayUrl(ORIGIN, '/Relatorio/X', p, false)).toBe(`${ORIGIN}${p}`);
  });

  test('gateway, simple mode: prefix + path', () => {
    const p = '/Relatorio/RelSituacaoMunicipioDados';
    expect(M.gatewayUrl(ORIGIN, F5_PATH, p, true))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$${p}`);
  });

  // The shape captured from live 2026 traffic: a doubled /Relatorio
  // segment around f5-h-$$, then F5_origin and F5CH.
  //
  // Note "?F5_origin", not ";F5_origin". sigc-pro's equivalent uses ";"
  // because ITS endpoint already carries a query string
  // (/relatorio/filtrar?slug=...), making ";" a separator within it.
  // MUNIC's path has no query string, so the params need "?" — copying
  // sigc-pro verbatim here yields a 404 on the fallback URL.
  test('gateway, fallback mode: f5-h-$$ segment plus F5 params', () => {
    const p = '/Relatorio/RelSituacaoMunicipioDados';
    expect(M.gatewayUrl(ORIGIN, F5_PATH, p, false))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/Relatorio/f5-h-$$${p}?F5_origin=${F5_HEX}&F5CH=I`);
  });

  // Guards the rule rather than the one case: a path that already has a
  // query string must extend it with "&", not start a second one.
  test('a path with an existing query string extends it', () => {
    const p = '/Relatorio/Algo?slug=x';
    expect(M.gatewayUrl(ORIGIN, F5_PATH, p, false))
      .toBe(`${ORIGIN}/f5-w-${F5_HEX}$$/Relatorio/f5-h-$$${p}&F5_origin=${F5_HEX}&F5CH=I`);
  });
});

describe('buildCsv', () => {
  test('semicolon-delimited with CRLF line endings', () => {
    expect(M.buildCsv(['a', 'b'], [['1', '2']])).toBe('a;b\r\n1;2\r\n');
  });

  test('quotes fields containing the delimiter, quotes or newlines', () => {
    expect(M.buildCsv(['a'], [['x;y']])).toBe('a\r\n"x;y"\r\n');
    expect(M.buildCsv(['a'], [['say "hi"']])).toBe('a\r\n"say ""hi"""\r\n');
  });

  test('renders null and undefined as empty', () => {
    expect(M.buildCsv(['a', 'b'], [[null, undefined]])).toBe('a;b\r\n;\r\n');
  });
});

describe('isoWeek', () => {
  // 2026-09-22 is a Tuesday in ISO week 39.
  test('formats as YYYY-Www', () => {
    expect(M.isoWeek(new Date('2026-09-22T10:00:00'))).toBe('2026-W39');
  });

  // The hard cases: ISO weeks belong to the year containing their Thursday.
  test('a January date can belong to the previous ISO year', () => {
    expect(M.isoWeek(new Date('2027-01-01T10:00:00'))).toBe('2026-W53');
  });

  test('a December date can belong to the next ISO year', () => {
    expect(M.isoWeek(new Date('2024-12-30T10:00:00'))).toBe('2025-W01');
  });

  test('pads single-digit weeks', () => {
    expect(M.isoWeek(new Date('2026-01-08T10:00:00'))).toBe('2026-W02');
  });
});
