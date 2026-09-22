import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';

// The manifest is the one place a permission can be added, so its shape is
// asserted rather than reviewed by eye. MUNIC-PRO deliberately requests two
// permissions sigc-pro does not -- storage and downloads -- and must never
// acquire host_permissions: requests go to the SIGC origin the content
// script already runs on.
// The extension declares NO permissions. It ran in the MAIN world with
// `storage` and `downloads` declared and neither ever used — there is no
// `chrome.*` call anywhere in extension/. IndexedDB and Blob downloads are
// page APIs, available without any permission at all.
//
// Declaring an unused permission is not harmless: it is a claim on the
// Web Store form that has to be justified, and the justification would
// have been false.
test('manifest requests no permissions at all', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  expect(manifest.permissions).toBeUndefined();
  expect(manifest.host_permissions).toBeUndefined();
});

test('no chrome.* API is called, which is what makes that possible', () => {
  const { execSync } = require('node:child_process');
  const hits = execSync(
    "grep -rn 'chrome\\.[a-z]' extension/ --include=*.js | grep -v '^\\s*//' || true",
    { encoding: 'utf8' },
  ).split('\n').filter((l) => l && !/\/\/.*chrome\./.test(l));
  expect(hits).toEqual([]);
});

test('manifest targets the MUNIC 2026 hosts', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  for (const cs of manifest.content_scripts) {
    expect(cs.matches).toContain('https://w3sigcmunic2026.ibge.gov.br/*');
    expect(cs.matches).toContain('https://portalweb.ibge.gov.br/*');
  }
});

// Two content_scripts entries now share these matches: an ISOLATED-world
// one (the extension's own origin, owns IndexedDB) and the original
// MAIN-world one (the page's own jQuery/DataTables and session). Each
// file reads its dependencies off window at load time, so a wrong order
// is a TypeError at page load — in the browser, where nobody is
// watching. Pinned here instead.
test('the ISOLATED-world content script loads in dependency order', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const isolated = manifest.content_scripts.find((cs) => cs.world === 'ISOLATED');
  expect(isolated).toBeTruthy();
  expect(isolated.js).toEqual([
    'features/situacao-store/situacao-diff.js',
    'features/situacao-store/situacao-bridge.js',
  ]);
});

test('the MAIN-world content script loads in dependency order', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
  expect(main).toBeTruthy();
  expect(main.js).toEqual([
    'common/munic-common.js',
    'common/assistencias.js',
    'features/situacao-store/situacao-diff.js',
    'features/situacao-store/situacao-store.js',
    'features/situacao-fetch/situacao-parse.js',
    'features/situacao-fetch/situacao-fetch.js',
    'features/situacao-report/situacao-aggregate.js',
    'features/situacao-report/situacao-report.js',
    'features/situacao-export/situacao-export.js',
  ]);
});

// The ISOLATED script must be ready before the MAIN-world report code
// (document_idle) can call it — otherwise an early Relatório-PRO click
// races the bridge's own message listener registration.
test('the ISOLATED-world content script runs at document_start', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const isolated = manifest.content_scripts.find((cs) => cs.world === 'ISOLATED');
  expect(isolated.run_at).toBe('document_start');
});

// Chrome refuses to load an extension whose manifest names a file that is
// not there — with an error about the icon, not about the manifest, which
// sends you looking in the wrong place. The scaffold created icons/ but no
// icons, so the first real load attempt failed. Pinned here so the next
// missing asset fails a test instead.
//
// Includes options_ui.page: the same silent-404 failure mode applies to
// the options page as to a missing icon or content script.
test('every file the manifest references exists on disk', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const referenced = [
    ...Object.values(manifest.icons || {}),
    ...manifest.content_scripts.flatMap((cs) => cs.js || []),
    ...(manifest.options_ui ? [manifest.options_ui.page] : []),
  ];
  for (const rel of referenced) {
    expect(existsSync(`extension/${rel}`)).toBe(true);
  }
});

// The options page is its own tiny manifest of files (declared via
// <script> tags rather than the top-level manifest.json), so it needs its
// own existence check — the top-level check above only follows
// options_ui.page itself, not what that HTML file pulls in.
test('every script the options page references exists on disk', () => {
  const html = readFileSync('extension/options/options.html', 'utf8');
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) {
    const path = new URL(src, 'file:///extension/options/').pathname.replace(/^\//, '');
    expect(existsSync(path)).toBe(true);
  }
});

// options_ui with open_in_tab is the constraint the task itself sets: no
// chrome_url_overrides, and the page must open as its own tab rather than
// as an embedded iframe inside chrome://extensions.
test('options page is declared via options_ui with open_in_tab, not chrome_url_overrides', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  expect(manifest.options_ui).toEqual({
    page: 'options/options.html',
    open_in_tab: true,
  });
  expect(manifest.chrome_url_overrides).toBeUndefined();
});

// The SIGC report opens through the F5 webtop, which puts it in a frame.
// With all_frames unset (the default, false) the two content-script
// entries could land in DIFFERENT documents — MAIN in one, the ISOLATED
// bridge in another — and window.postMessage to location.origin never
// crosses between them. The symptom was "a extensão não respondeu
// (camada de armazenamento indisponível)": MAIN present, bridge silent.
//
// Both entries must inject everywhere. The UI still mounts only once,
// because onSituacaoPage() requires SIGC's own four buttons to be in THIS
// document — so the frame without them builds nothing.
test('both content scripts inject into all frames', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  for (const cs of manifest.content_scripts) {
    expect(cs.all_frames).toBe(true);
  }
});

test('the two entries match the same hosts, so they share a document', () => {
  const [a, b] = JSON.parse(
    readFileSync('extension/manifest.json', 'utf8'),
  ).content_scripts;
  expect(a.matches.sort()).toEqual(b.matches.sort());
});
