import { escapeCell, toCsv } from './csv';

describe('CSV export', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralizes spreadsheet formula injection', () => {
    expect(escapeCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(escapeCell('+1')).toBe("'+1");
    expect(escapeCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('keeps numbers intact, including negatives', () => {
    expect(escapeCell(-5)).toBe('-5');
    expect(escapeCell(null)).toBe('');
  });

  it('renders header and rows with a BOM and CRLF', () => {
    const csv = toCsv([{ header: 'Nombre', value: (r: { n: string }) => r.n }], [{ n: 'Ángel' }]);
    expect(csv).toBe('\uFEFFNombre\r\nÁngel\r\n');
  });
});
