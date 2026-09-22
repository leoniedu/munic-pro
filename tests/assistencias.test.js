import { describe, test, expect } from 'bun:test';

await import('../extension/common/assistencias.js');

const A = window.__municProAssistencias;

describe('assistenciaDe', () => {
  test('maps a known código to its assistência', () => {
    expect(A.assistenciaDe('290570100', 'SALVADOR')).toBe('Salvador');
  });

  // An unknown código must not vanish from the grouping or collapse into
  // a blank row — it shows up under a visibly-labelled fallback group
  // instead.
  test('falls back visibly for an unknown código', () => {
    expect(A.assistenciaDe('999999999', 'NOVA AGENCIA'))
      .toBe('(sem assistência) NOVA AGENCIA');
  });

  test('falls back to the código itself when no name is given', () => {
    expect(A.assistenciaDe('999999999')).toBe('(sem assistência) 999999999');
  });
});
