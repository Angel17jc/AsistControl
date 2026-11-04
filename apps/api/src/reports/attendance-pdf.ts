import { formatMinutes } from '@asistcontrol/shared';
import PDFDocument from 'pdfkit';
import type { AttendanceMonth, MonthDay, MonthSheet } from './attendance-month';

const MARGIN = 36;
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const SIZE = 8.5;
const ROW_PADDING = 3;
const INK = '#1f2933';
const MUTED = '#7b8794';
const LINE = '#d9dee4';
const BAND = '#eef1f4';
const WARNING = '#b45309';
/** Room left at the bottom of a page for the totals and the signatures. */
const SIGNATURES_HEIGHT = 110;

interface PdfColumn {
  header: string;
  width: number;
  text: (day: MonthDay) => string;
}

const orDash = (value: string | null) => value ?? '—';
const hours = (minutes: number) => (minutes > 0 ? formatMinutes(minutes) : '—');
const dayLabel = (day: MonthDay) => {
  const [, month, date] = day.date.split('-');
  return `${day.weekday} ${date}/${month}`;
};
const lunchOf = (day: MonthDay) =>
  day.lunchOut && day.lunchBack ? `${day.lunchOut}–${day.lunchBack}` : '—';

/**
 * The month as a document to file or sign: one page per person (more if their notes need it),
 * every day, the totals and two signatures. PDF standard fonts cover Spanish, so none ships.
 */
export function attendanceMonthPdf(month: AttendanceMonth): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: `Asistencia de ${month.title}`, Author: 'AsistControl' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const columns = columnsOf(month, doc.page?.width ?? 595.28);
  if (month.employees.length === 0) {
    doc.addPage();
    doc.font(BOLD).fontSize(14).fillColor(INK).text(`Asistencia de ${month.title}`);
    doc.moveDown(0.5).font(FONT).fontSize(10).text('No hay empleados en este período.');
  }
  for (const employee of month.employees) writeEmployee(doc, month, employee, columns);
  writePageNumbers(doc);
  doc.end();
  return done;
}

function columnsOf(month: AttendanceMonth, pageWidth: number): PdfColumn[] {
  const fixed: PdfColumn[] = [
    { header: 'Fecha', width: 52, text: dayLabel },
    { header: 'Entrada', width: 38, text: (d) => orDash(d.entry) },
    { header: 'Almuerzo', width: 62, text: lunchOf },
    { header: 'Salida', width: 38, text: (d) => orDash(d.exit) },
    { header: 'Horas', width: 42, text: (d) => (d.entry ? formatMinutes(d.workedMinutes) : '—') },
    ...(month.hasShortHours
      ? [{ header: 'Faltan', width: 40, text: (d: MonthDay) => hours(d.shortMinutes) }]
      : []),
    ...(month.hasLateness
      ? [{ header: 'Atraso', width: 40, text: (d: MonthDay) => hours(d.lateMinutes) }]
      : []),
    ...(month.hasOvertime
      ? [{ header: 'Extra', width: 40, text: (d: MonthDay) => hours(d.overtimeMinutes) }]
      : []),
  ];
  const used = fixed.reduce((sum, c) => sum + c.width, 0);
  const rest = pageWidth - 2 * MARGIN - used;
  const statusWidth = Math.min(92, rest / 2);
  return [
    ...fixed,
    { header: 'Estado', width: statusWidth, text: (d) => d.status },
    { header: 'Novedades', width: rest - statusWidth, text: (d) => d.notes },
  ];
}

function writeEmployee(
  doc: PDFKit.PDFDocument,
  month: AttendanceMonth,
  employee: MonthSheet,
  columns: PdfColumn[],
) {
  doc.addPage();
  writeHeading(doc, month, employee);
  writeTableHead(doc, columns);
  for (const day of employee.days) {
    const height = rowHeight(doc, day, columns);
    if (doc.y + height > doc.page.height - MARGIN - 14) {
      doc.addPage();
      writeTableHead(doc, columns);
    }
    writeRow(doc, day, columns, height);
  }
  if (doc.y + SIGNATURES_HEIGHT > doc.page.height - MARGIN - 14) doc.addPage();
  writeTotals(doc, month, employee);
  writeSignatures(doc);
}

function writeHeading(doc: PDFKit.PDFDocument, month: AttendanceMonth, employee: MonthSheet) {
  doc.font(BOLD).fontSize(14).fillColor(INK).text(`Asistencia de ${month.title}`, MARGIN, MARGIN);
  doc.moveDown(0.2).font(BOLD).fontSize(10.5).text(employee.name);
  const detail = [employee.code, employee.department].filter(Boolean).join(' · ');
  doc.font(FONT).fontSize(9).fillColor(MUTED).text(detail);
  doc.moveDown(0.8);
}

function writeTableHead(doc: PDFKit.PDFDocument, columns: PdfColumn[]) {
  const y = doc.y;
  const height = SIZE + 2 * ROW_PADDING + 2;
  const width = doc.page.width - 2 * MARGIN;
  doc.rect(MARGIN, y, width, height).fill(BAND);
  doc.font(BOLD).fontSize(SIZE).fillColor(INK);
  let x = MARGIN;
  for (const c of columns) {
    doc.text(c.header, x + 2, y + ROW_PADDING + 1, { width: c.width - 4, lineBreak: false });
    x += c.width;
  }
  doc.x = MARGIN;
  doc.y = y + height;
}

function rowHeight(doc: PDFKit.PDFDocument, day: MonthDay, columns: PdfColumn[]): number {
  doc.font(FONT).fontSize(SIZE);
  const tallest = Math.max(
    ...columns.map((c) => doc.heightOfString(c.text(day) || ' ', { width: c.width - 4 })),
  );
  return tallest + 2 * ROW_PADDING;
}

function writeRow(doc: PDFKit.PDFDocument, day: MonthDay, columns: PdfColumn[], height: number) {
  const y = doc.y;
  const color = day.off ? MUTED : INK;
  doc.font(FONT).fontSize(SIZE);
  let x = MARGIN;
  for (const c of columns) {
    const warn = c.header === 'Faltan' && day.shortMinutes > 0;
    doc
      .fillColor(warn ? WARNING : color)
      .text(c.text(day), x + 2, y + ROW_PADDING, { width: c.width - 4 });
    x += c.width;
  }
  doc
    .moveTo(MARGIN, y + height)
    .lineTo(doc.page.width - MARGIN, y + height)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  doc.x = MARGIN;
  doc.y = y + height;
}

function writeTotals(doc: PDFKit.PDFDocument, month: AttendanceMonth, employee: MonthSheet) {
  const t = employee.totals;
  const parts = [
    `Días trabajados: ${t.daysWorked}`,
    `Horas trabajadas: ${formatMinutes(t.workedMinutes)}`,
    ...(month.hasShortHours ? [`Horas faltantes: ${formatMinutes(t.shortMinutes)}`] : []),
    ...(month.hasLateness ? [`Atraso: ${formatMinutes(t.lateMinutes)}`] : []),
    ...(month.hasOvertime ? [`Horas extra: ${formatMinutes(t.overtimeMinutes)}`] : []),
    `Ausencias: ${t.absences}`,
    `Días con permiso: ${t.leaveDays}`,
    `Días incompletos: ${t.incomplete}`,
  ];
  doc.moveDown(0.8).font(BOLD).fontSize(9).fillColor(INK);
  doc.text(parts.join('   ·   '), MARGIN, doc.y, { width: doc.page.width - 2 * MARGIN });
}

function writeSignatures(doc: PDFKit.PDFDocument) {
  const y = doc.y + 48;
  const gap = 40;
  const width = (doc.page.width - 2 * MARGIN - gap) / 2;
  doc.lineWidth(0.7).strokeColor(MUTED);
  doc.font(FONT).fontSize(8.5).fillColor(MUTED);
  for (const [i, label] of ['Firma del empleado', 'Firma de Talento Humano'].entries()) {
    const x = MARGIN + i * (width + gap);
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .stroke();
    doc.text(label, x, y + 4, { width, align: 'center' });
  }
  doc.x = MARGIN;
}

function writePageNumbers(doc: PDFKit.PDFDocument) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise open a new page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font(FONT)
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(`Página ${i - start + 1} de ${count}`, MARGIN, doc.page.height - 24, {
        width: doc.page.width - 2 * MARGIN,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}
