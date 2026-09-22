import { describe, test, expect, beforeEach } from 'bun:test';

// Both scripts loaded into the SAME window here, exactly as they are in
// the browser: MAIN and ISOLATED are different JS realms that do NOT
// share window.__municPro* globals, but they DO share the page's
// `document` — which is the one thing this test exercises.
// situacao-store.js (the client, "S" below) never touches indexedDB
// directly; every call is a request/reply pair carried on
// document.documentElement's data-munic-pro-req/-reply attributes,
// answered by situacao-bridge.js's real IndexedDB logic via a
// MutationObserver. A test that bypassed the bridge and asserted on
// window.__municProSituacaoBridge directly would prove nothing about the
// DOM-attribute path actually working end to end, so this suite
// deliberately goes through S only.
//
// happy-dom (tests/setup.js) implements both MutationObserver and
// dataset, which is what makes this end-to-end path testable at all
// without a real browser.
await import('../extension/features/situacao-store/situacao-diff.js');
await import('../extension/features/situacao-store/situacao-bridge.js');
await import('../extension/features/situacao-store/situacao-store.js');

const S = window.__municProSituacaoStore;

const TS1 = '2026-09-15T10:00:00';
const TS2 = '2026-09-22T10:00:00';

function row(municipio, questionario, situacao, extra = {}) {
  return {
    uf_sigla: 'BA',
    id_uf: 29,
    agencia_codigo: '290070200',
    agencia_nome: 'ALAGOINHAS',
    municipio_codigo: municipio,
    municipio_nome: 'Alagoinhas',
    questionario,
    criticas_informativas: 0,
    criticas_comparativas: 0,
    situacao,
    ...extra,
  };
}

beforeEach(async () => {
  await S.clearAll();
});

describe('saveSnapshot', () => {
  test('first run stores every row as current', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'Não Iniciado')], TS1, []);
    const current = await S.getCurrent();
    expect(current.length).toBe(1);
    expect(current[0].situacao).toBe('Não Iniciado');
    expect(current[0].from_ts).toBe(TS1);
  });

  test('an unchanged second run adds no history rows', async () => {
    const r = row('2900702', 'Básico', 'Não Iniciado');
    await S.saveSnapshot([r], TS1, []);
    await S.saveSnapshot([r], TS2, []);
    expect((await S.getAll()).length).toBe(1);
    expect((await S.getCurrent()).length).toBe(1);
  });

  test('a change closes the old row and leaves exactly one current', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'Não Iniciado')], TS1, []);
    await S.saveSnapshot([row('2900702', 'Básico', 'Dig. Ibge')], TS2, []);

    const all = await S.getAll();
    expect(all.length).toBe(2);

    const closed = all.find((r) => r.until_ts !== null);
    expect(closed.situacao).toBe('Não Iniciado');
    expect(closed.until_ts).toBe(TS2);

    const current = await S.getCurrent();
    expect(current.length).toBe(1);
    expect(current[0].situacao).toBe('Dig. Ibge');
  });

  test('reports how many rows changed', async () => {
    const first = await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS1, []);
    expect(first.nChanged).toBe(1);
    const second = await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS2, []);
    expect(second.nChanged).toBe(0);
  });

  test('a vanished município is closed, not left current', async () => {
    const a = row('2900702', 'Básico', 'Não Iniciado');
    const b = row('2902054', 'Básico', 'Não Iniciado');
    await S.saveSnapshot([a, b], TS1, []);
    const second = await S.saveSnapshot([b], TS2, []);

    const current = await S.getCurrent();
    expect(current.length).toBe(1);
    expect(current[0].municipio_codigo).toBe('2902054');
    // A vanished município is a close, not a value change, but it is
    // still shown to the user as a "mudança" — nChanged must count it.
    expect(second.nChanged).toBe(1);
    expect(second.nRows).toBe(1);
  });

  // THE regression this whole change exists to prevent: fetching a
  // different UF (the page's #IdUf dropdown changed) must not read as
  // "every município of the previous UF vanished". BA is saved first,
  // then SP is saved — saveSnapshot must scope `current` to SP's own UF
  // before diffing, or every BA row (which has no SP counterpart to
  // match) gets closed as "vanished" the moment SP is fetched.
  test('fetching a different UF does not close the previous UF\'s municípios', async () => {
    const ba1 = row('2900702', 'Básico', 'Não Iniciado', { uf_sigla: 'BA', id_uf: 29 });
    const ba2 = row('2902054', 'Básico', 'Não Iniciado', { uf_sigla: 'BA', id_uf: 29 });
    await S.saveSnapshot([ba1, ba2], TS1, []);

    // A município código that collides with one of BA's — proves the two
    // UFs are kept apart by identity (uf_sigla), not merely by chance of
    // non-overlapping códigos.
    const sp1 = row('2900702', 'Básico', 'Não Iniciado', { uf_sigla: 'SP', id_uf: 35 });
    const spResult = await S.saveSnapshot([sp1], TS2, []);

    const current = await S.getCurrent();
    // The mutation this catches: if saveSnapshot diffed SP's incoming
    // snapshot against ALL open rows (not scoped to SP), BA's two rows
    // would have no matching SP key and both would be closed as
    // "vanished" — leaving only SP's one row current instead of three.
    expect(current.length).toBe(3);
    expect(current.filter((r) => r.uf_sigla === 'BA').length).toBe(2);
    expect(current.filter((r) => r.uf_sigla === 'SP').length).toBe(1);
    // SP's row must be a fresh insert (a "change"), not a no-op that
    // silently merged into BA's collateral '2900702|Básico' key.
    expect(spResult.nChanged).toBe(1);
  });
});

describe('getRuns', () => {
  // Every run is recorded even when nothing changed, so the Município
  // tab can tell "we ran and nothing moved" from "nobody ran it".
  test('records a run even when nothing changed', async () => {
    const r = row('2900702', 'Básico', 'Não Iniciado');
    await S.saveSnapshot([r], TS1, []);
    await S.saveSnapshot([r], TS2, []);

    const runs = await S.getRuns();
    expect(runs.length).toBe(2);
    expect(runs[0].run_ts).toBe(TS1);
    expect(runs[1].run_ts).toBe(TS2);
    expect(runs[1].n_changed).toBe(0);
    expect(runs[1].n_rows).toBe(1);
  });

  test('returns runs in ascending timestamp order', async () => {
    const r = row('2900702', 'Básico', 'X');
    await S.saveSnapshot([r], TS2, []);
    await S.saveSnapshot([r], TS1, []);
    const runs = await S.getRuns();
    expect(runs.map((x) => x.run_ts)).toEqual([TS1, TS2]);
  });

  test('stores warnings alongside the run', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS1, ['situação nova: X']);
    const runs = await S.getRuns();
    expect(runs[0].warnings).toEqual(['situação nova: X']);
  });
});

describe('clearAll', () => {
  test('empties both stores', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS1, []);
    await S.clearAll();
    expect(await S.getAll()).toEqual([]);
    expect(await S.getRuns()).toEqual([]);
  });
});

describe('DOM-attribute transport', () => {
  // THE current bug's shape: the bridge writes a correct reply to
  // data-munic-pro-reply, but if S never actually reads it back (e.g. its
  // MutationObserver isn't wired to the right attribute, or it reads the
  // wrong one), the call hangs and times out even though the answer was
  // sitting right there on documentElement the whole time. This asserts
  // on the attribute directly, independent of S's own promise resolving,
  // so a mutation that broke S's *reading* half (but left the bridge's
  // writing half intact) still fails it.
  test('the bridge writes its reply to the documented reply attribute', async () => {
    await S.clearAll();

    // A second, independent observer on the SAME attribute S itself
    // watches, with oldValue recording turned on: MutationObserver
    // callbacks run in registration order within the same microtask
    // batch, so by the time THIS callback fires, S's own observer has
    // already read and removed the attribute — reading the live
    // attribute here would always see it gone. The mutation record's
    // oldValue is what proves the bridge actually wrote the reply JSON,
    // independent of S's own promise resolving at all, so a mutation
    // that broke S's read side (but left the bridge's write side intact)
    // still fails this.
    const seen = new Promise((resolve) => {
      const obs = new MutationObserver((mutations) => {
        const withValue = mutations.find((m) => m.oldValue);
        if (withValue) { obs.disconnect(); resolve(withValue.oldValue); }
      });
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-munic-pro-reply'],
        attributeOldValue: true,
      });
    });

    const done = S.getRuns();
    const raw = await seen;
    const parsed = JSON.parse(raw);
    expect(parsed.result).toEqual([]);
    await done;
  });

  // Two concurrent calls must each get back their OWN result, matched by
  // id, not whichever reply happens to land in the single reply slot —
  // this is the collision risk called out for a single-attribute
  // transport. saveSnapshot and getRuns return very different shapes, so
  // a mismatch (call A resolving with call B's answer) is unmistakable.
  test('two concurrent calls each resolve with their own result, not a mismatched one', async () => {
    await S.clearAll();
    const [saveResult, current] = await Promise.all([
      S.saveSnapshot([row('2900702', 'Básico', 'Não Iniciado')], TS1, []),
      S.getCurrent(),
    ]);
    expect(saveResult).toEqual({ nChanged: 1, nRows: 1 });
    // getCurrent's own result must be an array (its actual return shape),
    // never saveSnapshot's {nChanged, nRows} object — which is exactly
    // what an id mismatch would produce if the two calls' replies were
    // swapped.
    expect(Array.isArray(current)).toBe(true);
  });

  test('three overlapping calls resolve independently, none stealing another\'s reply', async () => {
    await S.saveSnapshot([row('2900702', 'Básico', 'X')], TS1, []);
    const [all, runs, cur] = await Promise.all([
      S.getAll(),
      S.getRuns(),
      S.getCurrent(),
    ]);
    expect(all.length).toBe(1);
    expect(runs.length).toBe(1);
    expect(cur.length).toBe(1);
  });

  // getAll() can return tens of thousands of rows as one JSON string in
  // a DOM attribute. This proves a realistic-sized payload round-trips
  // intact rather than being silently truncated by some length limit —
  // measured at ~6.8M characters for 20,000 rows in this codebase's row
  // shape, comfortably inside what a DOM attribute value can hold.
  test('a 20,000-row payload round-trips intact through the attribute channel', async () => {
    await S.clearAll();
    const bigSnapshot = Array.from({ length: 20000 }, (_, i) =>
      row(String(2900000 + i), 'Básico', 'Não Iniciado', { municipio_nome: `Município ${i}` }));
    await S.saveSnapshot(bigSnapshot, TS1, []);

    const all = await S.getAll();
    expect(all.length).toBe(20000);
    // Spot-check first, last and a middle row: a truncated JSON string
    // would either fail to parse at all (rejecting the call) or silently
    // drop trailing rows, which a length check alone would not catch if
    // it happened to drop from the middle.
    expect(all[0].municipio_nome).toBe('Município 0');
    expect(all[9999].municipio_nome).toBe('Município 9999');
    expect(all[19999].municipio_nome).toBe('Município 19999');
    expect(all[19999].municipio_codigo).toBe(String(2900000 + 19999));
  }, 15000);
});

describe('cross-origin storage: MAIN never touches indexedDB directly', () => {
  // The whole point of the MAIN/ISOLATED split: situacao-store.js (S, the
  // MAIN-world client) must hold NO reference to indexedDB — every read
  // and write has to cross postMessage to situacao-bridge.js, which is
  // the only code that opens the database. A regression that made S call
  // indexedDB directly again (defeating the fix — MAIN-world IndexedDB
  // opens on the PAGE's origin, not the extension's) would not
  // necessarily change S's return values, so this test does not rely on
  // behaviour alone; it asserts the module's own shape.
  test('the MAIN-world store client never references the indexedDB global', () => {
    expect(String(S.saveSnapshot)).not.toMatch(/indexedDB/);
    expect(String(S.getCurrent)).not.toMatch(/indexedDB/);
    expect(String(S.getAll)).not.toMatch(/indexedDB/);
    expect(String(S.getRuns)).not.toMatch(/indexedDB/);
    expect(String(S.clearAll)).not.toMatch(/indexedDB/);
  });

  // The mutation this is built to catch: if saveSnapshot() (or any of
  // S's other methods) were changed back to call indexedDB.open(...)
  // directly instead of going through the bridge, the source-shape check
  // above would fail immediately. As a second, behavioural line of
  // defence: disabling the bridge's request channel must make every call
  // fail (time out) rather than silently succeed via a local fallback —
  // a silent local fallback is indistinguishable from "it still works"
  // and is exactly the failure mode a source check alone could miss if
  // some OTHER code path grew a direct indexedDB call.
  test('calls fail loudly, not silently, when the bridge is unreachable', async () => {
    // Longer than S's own CALL_TIMEOUT_MS (10s), which this test waits
    // out deliberately: proving that an unanswered call REJECTS (rather
    // than resolving silently, e.g. via a hidden direct-indexedDB
    // fallback) requires actually reaching that timeout.
    const B = window.__municProSituacaoBridge;
    // Wipe any real history and IndexedDB access the bridge might use as
    // a fallback, so a passing call could only mean the DOM channel
    // actually reached a listener — never a coincidental local read.
    await B.clearAll();

    // situacao-bridge.js's own MutationObserver can't be disconnected
    // from outside, so this test simulates its absence by intercepting
    // documentElement.setAttribute and swallowing S's own request writes
    // before the observer ever sees them — the same observable failure
    // as the bridge never having loaded.
    // Shorten the ceiling rather than waiting it out: this one test was
    // 10s of a 10.2s suite. The behaviour under test is that an
    // unanswered call REJECTS — the exact duration is not the point.
    const INT = window.__municProSituacaoStoreInternals;
    INT.setCallTimeoutMs(50);

    const el = document.documentElement;
    const originalSetAttribute = el.setAttribute.bind(el);
    el.setAttribute = (name, value) => {
      if (name === 'data-munic-pro-req') return; // swallowed
      originalSetAttribute(name, value);
    };
    try {
      await expect(S.getAll()).rejects.toThrow();
    } finally {
      INT.setCallTimeoutMs(10000);
      el.setAttribute = originalSetAttribute;
    }
  }, 15000);
});
