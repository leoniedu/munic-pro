import { describe, test, expect, setSystemTime } from 'bun:test';

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

describe('localTimestamp', () => {
  test('matches the wall clock, not toISOString (which converts to UTC)', () => {
    expect(M.localTimestamp(new Date(2026, 8, 20, 21, 30, 0)))
      .toBe('2026-09-20T21:30:00');
  });

  test('zero-pads single-digit month, day, hour, minute and second', () => {
    expect(M.localTimestamp(new Date(2026, 0, 5, 3, 7, 9)))
      .toBe('2026-01-05T03:07:09');
  });

  // The exact case from the CRITICAL finding: a Sunday-evening run in a
  // negative-offset zone. toISOString().slice(0,19) converts to UTC first,
  // so re-parsing the stripped string as local shifts it onto Monday and
  // into the next ISO week. localTimestamp must round-trip to the same week.
  test('round-trips to the same ISO week as the wall-clock date (Sunday evening)', () => {
    const d = new Date(2026, 8, 20, 21, 30); // Sunday 2026-09-20, 21:30 local
    expect(M.isoWeek(new Date(M.localTimestamp(d)))).toBe(M.isoWeek(d));
  });
});

describe('timestampSlug', () => {
  test('data field returns the wall-clock date, not the UTC next day', () => {
    // At 21:30 local on Sunday 2026-09-20, toISOString() returns 2026-09-21T00:30:00Z.
    // timestampSlug().data must be the wall-clock date 2026-09-20, not 2026-09-21.
    const d = new Date(2026, 8, 20, 21, 30, 0);
    expect(M.timestampSlug(d).data).toBe('2026-09-20');
  });

  test('hora field is the wall-clock time with colons removed', () => {
    const d = new Date(2026, 8, 20, 21, 30, 0);
    expect(M.timestampSlug(d).hora).toBe('213000');
  });

  test('data and hora come from the same instant', () => {
    const d = new Date(2026, 8, 20, 21, 30, 45);
    const slug = M.timestampSlug(d);
    // Reconstruct: data is chars 0-10, hora is chars 11-19 of localTimestamp
    const ts = M.localTimestamp(d);
    expect(slug.data).toBe(ts.slice(0, 10));
    expect(slug.hora).toBe(ts.slice(11, 19).replace(/:/g, ''));
  });

  // Shape alone is not enough: a UTC timestamp matches /^\d{4}-\d{2}-\d{2}$/
  // just as well as a local one. The no-argument branch is the path
  // production actually uses (situacao-report.js), and reverting it to
  // toISOString() passed the old shape-only assertion — the fourth
  // instance of this defect class in this project. The clock is pinned to
  // the window where UTC and BRT disagree on the DATE.
  test('defaults to now, in LOCAL time, not UTC', () => {
    // 2026-09-20 23:30 BRT is 2026-09-21 02:30 UTC — different days.
    setSystemTime(new Date('2026-09-21T02:30:00Z'));
    try {
      expect(M.timestampSlug().data).toBe('2026-09-20');
      expect(M.localTimestamp()).toBe('2026-09-20T23:30:00');
    } finally {
      setSystemTime();
    }
  });

  test('the no-argument path still has the expected shape', () => {
    const slug = M.timestampSlug();
    expect(slug.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(slug.hora).toMatch(/^\d{6}$/);
  });
});
