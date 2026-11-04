import { strFromU8, unzipSync } from 'fflate';
import { type AttendanceMonth, buildAttendanceMonth } from './attendance-month';
import { attendanceMonthPdf } from './attendance-pdf';
import { attendanceMonthXlsx, rowsXlsx } from './xlsx';

const TZ = 'America/Guayaquil';

const month = (name = 'Vera Ñáñez, Ana'): AttendanceMonth =>
  buildAttendanceMonth({
    from: '2026-10-01',
    to: '2026-10-31',
    today: '2026-11-04',
    timezone: TZ,
    employees: [
      {
        code: 'EMP-1',
        name,
        department: null,
        hireDate: '2026-01-01',
        terminatedAt: null,
        records: [
          {
            date: '2026-10-05',
            status: 'PRESENT',
            firstIn: new Date('2026-10-05T14:00:00Z'),
            lastOut: new Date('2026-10-05T22:00:00Z'),
            segments: [
              { in: '2026-10-05T14:00:00Z', out: '2026-10-05T18:00:00Z' },
              { in: '2026-10-05T19:00:00Z', out: '2026-10-05T22:00:00Z' },
            ],
            workedMinutes: 420,
            breakMinutes: 60,
            lateMinutes: 0,
            overtimeMinutes: 0,
            shortMinutes: 60,
            anomalies: ['SHORT_HOURS'],
            isFinal: true,
          },
        ],
      },
    ],
  });

/** The sheets of a workbook as XML, by their name. */
function sheetsOf(file: Buffer) {
  const zip = unzipSync(new Uint8Array(file));
  const text = (path: string) => strFromU8(zip[path]!);
  const names = [...text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(
    (m) => m[1]!,
  );
  const shared = zip['xl/sharedStrings.xml'] ? text('xl/sharedStrings.xml') : '';
  return {
    names,
    all: names.map((_, i) => text(`xl/worksheets/sheet${i + 1}.xml`)).join('') + shared,
    first: text('xl/worksheets/sheet1.xml'),
    styles: text('xl/styles.xml'),
  };
}

describe('attendanceMonthXlsx', () => {
  it('writes the days on one sheet and the totals on another, in Spanish', async () => {
    const { names, all } = sheetsOf(await attendanceMonthXlsx(month()));
    expect(names).toEqual(['Asistencia', 'Resumen']);
    for (const text of ['Entrada', 'Salida almuerzo', 'Regreso almuerzo', 'Horas faltantes']) {
      expect(all).toContain(text);
    }
    expect(all).toContain('Vera Ñáñez, Ana');
    expect(all).toContain('Días trabajados');
  });

  it('writes real times and durations, so they can be sorted and added', async () => {
    const { first, styles } = sheetsOf(await attendanceMonthXlsx(month()));
    // 09:00 is 0.375 of a day; 7 h worked are 420 minutes of 1440.
    expect(first).toContain('<v>0.375</v>');
    expect(first).toContain(`<v>${420 / 1440}</v>`);
    expect(styles).toContain('[h]:mm');
    expect(styles).toContain('hh:mm');
  });

  it('has no column for what the month does not have', async () => {
    const { all } = sheetsOf(await attendanceMonthXlsx(month()));
    expect(all).not.toContain('Horas extra');
    expect(all).not.toContain('Atraso');
    expect(all).not.toContain('Departamento');
  });

  it('keeps a name that looks like a formula as text, and escapes what XML reserves', async () => {
    const { first, all } = sheetsOf(await attendanceMonthXlsx(month('=1+1 <Ana> & "Co"')));
    expect(first).not.toContain('<f>');
    expect(all).toContain('=1+1 &lt;Ana&gt; &amp;');
  });
});

describe('rowsXlsx', () => {
  it('words the headers and keeps numbers as numbers', async () => {
    const file = await rowsXlsx('Resumen mensual', [
      { codigo: 'EMP-1', minutos_trabajados: 480, nota: null },
    ]);
    const { names, all, first } = sheetsOf(file);
    expect(names).toEqual(['Resumen mensual']);
    expect(all).toContain('Minutos trabajados');
    expect(first).toContain('<v>480</v>');
  });
});

describe('attendanceMonthPdf', () => {
  const pagesOf = (file: Buffer) => file.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

  it('writes a PDF with a page per person', async () => {
    const one = month();
    const file = await attendanceMonthPdf({
      ...one,
      employees: [one.employees[0]!, { ...one.employees[0]!, name: 'Otra Persona' }],
    });
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pagesOf(file)).toBe(2);
  });

  it('continues on another page when the notes do not fit', async () => {
    const one = month();
    const long = 'Marcación fuera de jornada · '.repeat(8);
    const employee = {
      ...one.employees[0]!,
      days: one.employees[0]!.days.map((d) => ({ ...d, notes: long })),
    };
    const file = await attendanceMonthPdf({ ...one, employees: [employee] });
    expect(pagesOf(file)).toBeGreaterThan(1);
  });

  it('still writes a document for a month without people', async () => {
    const file = await attendanceMonthPdf({ ...month(), employees: [] });
    expect(pagesOf(file)).toBe(1);
  });
});
