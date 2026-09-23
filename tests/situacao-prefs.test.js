import { describe, test, expect, beforeEach } from 'bun:test';

await import('../extension/features/situacao-store/situacao-prefs.js');

const P = window.__municProPrefs;

describe('colunas ocultas', () => {
  beforeEach(() => { window.localStorage.clear(); });

  test('nothing saved means nothing hidden', () => {
    expect(P.getColunasOcultas()).toEqual([]);
  });

  test('round-trips the saved list', () => {
    P.setColunasOcultas(['Assistência', 'Questionário']);
    expect(P.getColunasOcultas()).toEqual(['Assistência', 'Questionário']);
  });

  // A corrupt or foreign value must leave every column visible, not
  // throw and take the panel down with it.
  test('a corrupt value reads as nothing hidden', () => {
    window.localStorage.setItem(P.KEY_OCULTAS, '{nope');
    expect(P.getColunasOcultas()).toEqual([]);
    window.localStorage.setItem(P.KEY_OCULTAS, '"Agência"');
    expect(P.getColunasOcultas()).toEqual([]);
  });
});
