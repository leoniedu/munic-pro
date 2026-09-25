import { describe, test, expect } from 'bun:test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await import('../extension/features/situacao-export/situacao-xlsx.js');

const X = window.__municProXlsx;

// Reads the workbook back with an independent implementation — Python's
// zipfile (which verifies every CRC) and XML parser — so the test does
// not grade the writer with its own assumptions.
function lerComPython(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'munic-xlsx-'));
  const f = join(dir, 'w.xlsx');
  writeFileSync(f, bytes);
  const py = `
import json, sys, zipfile, xml.dom.minidom
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
out = {}
for n in z.namelist():
    data = z.read(n)
    xml.dom.minidom.parseString(data)  # must be well-formed
    out[n] = data.decode('utf-8')
print(json.dumps(out))
`;
  return JSON.parse(execFileSync('python3', ['-c', py, f], { encoding: 'utf8' }));
}

const cel = (v, tipo = 'texto', situacao) => ({ v, tipo, situacao });

describe('crc32 and column letters', () => {
  test('crc32 matches the standard check value', () => {
    expect(X.crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });

  test('column letters roll over like Excel', () => {
    expect([0, 25, 26, 51, 701, 702].map(X.colLetra))
      .toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
  });

  test('sheet names lose Excel-forbidden characters and fit 31 chars', () => {
    expect(X.nomeAba('a/b[c]:d*e?f\\g')).toBe('a b c  d e f g');
    expect(X.nomeAba('x'.repeat(40)).length).toBe(31);
  });
});

describe('workbook', () => {
  const sheets = [
    { nome: 'Município', cabecalho: ['Município', 'Indicador', '22/09/2026 10:00'],
      linhas: [
        [cel('Abaíra'), cel('Críticas informativas'), cel(164, 'numero')],
        [cel('Abaíra'), cel('Situação'), cel('Concluído', 'texto', 'Concluído')],
        [cel('A & <B>'), cel('Situação'), cel(null)],
      ] },
    { nome: 'Agência %', cabecalho: ['Grupo', 'Situação', '22/09/2026 10:00'],
      linhas: [[cel('SALVADOR 01'), cel('Não Iniciado', 'texto', 'Não Iniciado'),
        cel(0.125, 'pct')]] },
  ];
  const partes = lerComPython(X.workbook(sheets));

  test('is a valid zip of well-formed XML parts', () => {
    expect(Object.keys(partes).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/workbook.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
  });

  test('one sheet per tab, named after it', () => {
    expect(partes['xl/workbook.xml']).toContain('<sheet name="Município" sheetId="1"');
    expect(partes['xl/workbook.xml']).toContain('<sheet name="Agência %" sheetId="2"');
  });

  test('numbers stay numbers, percentages stay fractions', () => {
    expect(partes['xl/worksheets/sheet1.xml']).toContain('<c r="C2"><v>164</v></c>');
    expect(partes['xl/worksheets/sheet2.xml']).toContain('<c r="C2" s="2"><v>0.125</v></c>');
    expect(partes['xl/styles.xml']).toContain('formatCode="0.0%"');
  });

  test('situação cells carry their bucket colour', () => {
    // Concluído is the 4th bucket: style 3 + 3.
    expect(partes['xl/worksheets/sheet1.xml']).toMatch(/<c r="C3" t="inlineStr" s="6">/);
    expect(partes['xl/styles.xml']).toContain('FFCAEEFB');
  });

  test('text is escaped and an empty cell is left out', () => {
    expect(partes['xl/worksheets/sheet1.xml']).toContain('A &amp; &lt;B&gt;');
    expect(partes['xl/worksheets/sheet1.xml']).not.toContain('r="C4"');
  });

  test('header row is frozen and filterable', () => {
    expect(partes['xl/worksheets/sheet1.xml']).toContain('state="frozen"');
    expect(partes['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="A1:C4"/>');
  });
});
