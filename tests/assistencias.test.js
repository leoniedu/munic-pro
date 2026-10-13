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

// SIGC assigns some Bahia municípios to the wrong agência; the panel
// follows RCD 31 instead.
describe('conformeRcd31', () => {
  const row = (municipio_codigo, agencia_codigo, agencia_nome) => ({
    uf_sigla: 'BA', municipio_codigo, agencia_codigo, agencia_nome,
    questionario: 'Básico', situacao: 'Concluído',
  });

  test('replaces SIGC agência with the RCD 31 one', () => {
    const [r] = A.conformeRcd31([row('2907905', '290790500', 'CIPÓ')]);
    expect(r.agencia_codigo).toBe('292660800');
    expect(r.agencia_nome).toBe('RIBEIRA DO POMBAL');
    expect(r.situacao).toBe('Concluído');
  });

  // RCD 31 splits Salvador across SALVADOR 1 and 2, but SIGC has a single
  // row per questionário — there is no single agência to pick.
  test('leaves Salvador as SIGC reports it', () => {
    const [r] = A.conformeRcd31([row('2927408', '292740800', 'SALVADOR')]);
    expect(r.agencia_codigo).toBe('292740800');
    expect(r.agencia_nome).toBe('SALVADOR');
  });

  test('leaves municípios outside RCD 31 untouched', () => {
    const r = { ...row('3550308', '355030800', 'SÃO PAULO'), uf_sigla: 'SP' };
    expect(A.conformeRcd31([r])[0]).toEqual(r);
  });

  test('does not mutate the stored rows', () => {
    const r = row('2907905', '290790500', 'CIPÓ');
    A.conformeRcd31([r]);
    expect(r.agencia_codigo).toBe('290790500');
  });

  test('covers every Bahia município except Salvador', () => {
    expect(Object.keys(A.AGENCIA_RCD31_POR_MUNICIPIO)).toHaveLength(416);
  });
});
