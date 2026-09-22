export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

/**
 * RFC 4180 CSV with protection against CSV/formula injection: cells starting with
 * = + - @ (or tab/CR) are prefixed with a quote so spreadsheets never evaluate them.
 * A UTF-8 BOM makes Excel open accents (Conforme, Ñ…) correctly.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function escapeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
