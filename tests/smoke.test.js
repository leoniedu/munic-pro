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
  const matches = manifest.content_scripts[0].matches;
  expect(matches).toContain('https://w3sigcmunic2026.ibge.gov.br/*');
  expect(matches).toContain('https://portalweb.ibge.gov.br/*');
});

// Each file reads its dependencies off window at load time, so a wrong
// order is a TypeError at page load — in the browser, where nobody is
// watching. Pinned here instead.
test('manifest loads scripts in dependency order', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  expect(manifest.content_scripts[0].js).toEqual([
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

// Chrome refuses to load an extension whose manifest names a file that is
// not there — with an error about the icon, not about the manifest, which
// sends you looking in the wrong place. The scaffold created icons/ but no
// icons, so the first real load attempt failed. Pinned here so the next
// missing asset fails a test instead.
test('every file the manifest references exists on disk', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const referenced = [
    ...Object.values(manifest.icons || {}),
    ...manifest.content_scripts.flatMap((cs) => cs.js || []),
  ];
  for (const rel of referenced) {
    expect(existsSync(`extension/${rel}`)).toBe(true);
  }
});
