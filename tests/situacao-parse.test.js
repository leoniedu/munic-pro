import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

await import('../extension/common/munic-common.js');
await import('../extension/features/situacao-fetch/situacao-parse.js');

const { parseSituacao } = window.__municProSituacaoParse;
const SAMPLE = readFileSync('tests/fixtures/situacao-sample.html', 'utf8');

describe('parseSituacao', () => {
  test('returns one row per município per questionário', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows.length).toBe(6);
  });

  test('splits the "codigo - nome" cells', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows[0].agencia_codigo).toBe('290070200');
    expect(rows[0].agencia_nome).toBe('ALAGOINHAS');
    expect(rows[0].municipio_codigo).toBe('2900702');
    expect(rows[0].municipio_nome).toBe('Alagoinhas');
  });

  test('decodes HTML entities', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows[0].situacao).toBe('Não Iniciado');
    expect(rows[0].questionario).toBe('Básico');
    expect(rows[2].municipio_nome).toBe('Araçás');
    expect(rows[4].agencia_nome).toBe('CAMAÇARI');
  });

  test('the same município appears once per questionário', () => {
    const { rows } = parseSituacao(SAMPLE);
    const alagoinhas = rows.filter((r) => r.municipio_codigo === '2900702');
    expect(alagoinhas.map((r) => r.questionario).sort())
      .toEqual(['Básico', 'Suplementar']);
  });

  test('a questionário can differ in situação from its sibling', () => {
    const { rows } = parseSituacao(SAMPLE);
    const itanagra = rows.filter((r) => r.municipio_codigo === '2915908');
    const bySit = Object.fromEntries(itanagra.map((r) => [r.questionario, r.situacao]));
    expect(bySit['Básico']).toBe('Concluído');
    expect(bySit['Suplementar']).toBe('Em Validação');
  });

  test('"-" críticas become 0, digits become numbers', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows[0].criticas_informativas).toBe(0);
    expect(rows[0].criticas_comparativas).toBe(0);
    expect(rows[2].criticas_informativas).toBe(3);
    expect(rows[2].criticas_comparativas).toBe(1);
  });

  // The response carries modal markup containing another <table>. Taking
  // "the first table" would eventually pick up the wrong one; the parser
  // targets #tblMunicipios by id.
  test('ignores tables outside #tblMunicipios', () => {
    const { rows } = parseSituacao(SAMPLE);
    expect(rows.some((r) => r.uf_sigla.includes('mistaken'))).toBe(false);
  });

  test('warns about an unrecognised situação instead of bucketing it', () => {
    const html = SAMPLE.replace('Conclu&#237;do', 'Situa&#231;&#227;o Nova');
    const { rows, warnings } = parseSituacao(html);
    expect(rows.find((r) => r.situacao === 'Situação Nova')).toBeTruthy();
    expect(warnings.join(' ')).toContain('Situação Nova');
  });

  test('no warnings for the known vocabulary', () => {
    expect(parseSituacao(SAMPLE).warnings).toEqual([]);
  });

  test('throws when the table is absent', () => {
    expect(() => parseSituacao('<div>Erro</div>')).toThrow(/tblMunicipios/);
  });

  test('throws when a column is missing or renamed', () => {
    const html = SAMPLE.replace('<th class="text-start">Questionário</th>', '');
    expect(() => parseSituacao(html)).toThrow(/colunas/i);
  });

  test('throws when the table has no data rows', () => {
    const html = SAMPLE.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody></tbody>');
    expect(() => parseSituacao(html)).toThrow(/vazia/i);
  });

  test('throws on a duplicate (município, questionário) key', () => {
    const dup = SAMPLE.replace(
      '<td>2902054 - Ara&#231;&#225;s</td>\n          <td>B&#225;sico</td>',
      '<td>2900702 - Alagoinhas</td>\n          <td>B&#225;sico</td>',
    );
    expect(() => parseSituacao(dup)).toThrow(/duplicad/i);
  });
});
