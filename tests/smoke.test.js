import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The manifest is the one place a permission can be added, so its shape is
// asserted rather than reviewed by eye. MUNIC-PRO deliberately requests two
// permissions sigc-pro does not -- storage and downloads -- and must never
// acquire host_permissions: requests go to the SIGC origin the content
// script already runs on.
test('manifest requests only storage and downloads', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  expect(manifest.permissions.sort()).toEqual(['downloads', 'storage']);
  expect(manifest.host_permissions).toBeUndefined();
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
    'features/situacao-store/situacao-diff.js',
    'features/situacao-store/situacao-store.js',
    'features/situacao-fetch/situacao-parse.js',
    'features/situacao-fetch/situacao-fetch.js',
    'features/situacao-report/situacao-aggregate.js',
    'features/situacao-report/situacao-report.js',
    'features/situacao-export/situacao-export.js',
  ]);
});
