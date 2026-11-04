import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageHelp,
  Select,
  Spinner,
  Table,
  Td,
} from '../components/ui';
import { api, download } from '../lib/api';
import { useFeatures } from '../lib/features';
import { todayIso } from '../lib/format';

const REPORTS = [
  [
    'attendance',
    'Asistencia del mes',
    'Entrada, almuerzo y salida de cada persona, día por día, con sus totales',
  ],
  ['daily', 'Asistencia diaria', 'Una fila por empleado y día, en el período que elija'],
  ['monthly', 'Resumen mensual', 'Totales por empleado para nómina'],
  ['late', 'Atrasos', 'Jornadas con llegada tardía'],
  ['absences', 'Ausencias', 'Días laborables sin asistencia'],
  ['overtime', 'Horas extra', 'Propuestas y aprobadas'],
  ['events', 'Marcaciones', 'Detalle de cada marcación'],
  ['sync', 'Sincronización', 'Historial de descargas por dispositivo'],
] as const;

type Kind = (typeof REPORTS)[number][0];
type Format = 'xlsx' | 'pdf' | 'csv';

const MONTHS_OFFERED = 13;

interface ReportResponse {
  total: number;
  rows: Record<string, string | number | boolean | null>[];
}

/** The last months, newest first, as the first day of each: what a monthly report asks for. */
function recentMonths(today: string): { value: string; label: string }[] {
  const [year = 0, month = 1] = today.split('-').map(Number);
  return Array.from({ length: MONTHS_OFFERED }, (_, i) => {
    const first = new Date(Date.UTC(year, month - 1 - i, 1));
    const value = first.toISOString().slice(0, 10);
    return {
      value,
      label: first.toLocaleDateString('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
  });
}

export function ReportsPage() {
  const { overtimeEnabled } = useFeatures();
  const [kind, setKind] = useState<Kind>('attendance');
  const [from, setFrom] = useState(todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const monthly = kind === 'attendance' || kind === 'monthly';
  const months = recentMonths(todayIso());
  // A monthly report reads the month of `from`: the first day of it, as the list offers them.
  const month = `${from.slice(0, 8)}01`;
  const query = { from: monthly ? month : from, to: monthly ? undefined : to };

  const report = useQuery({
    queryKey: ['report', kind, from, to],
    queryFn: () => api<ReportResponse>(`/reports/${kind}`, { query }),
  });
  const file = useMutation({
    mutationFn: (format: Format) =>
      download(`/reports/${kind}`, { ...query, format }, `asistcontrol-${kind}.${format}`),
  });
  const empty = !report.data?.total;
  const meta = REPORTS.find(([k]) => k === kind)!;
  const columns = report.data?.rows[0] ? Object.keys(report.data.rows[0]) : [];

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Información lista para revisión de Talento Humano y procesos de nómina"
        actions={
          <>
            <Button
              variant="ghost"
              loading={file.isPending && file.variables === 'csv'}
              onClick={() => file.mutate('csv')}
              disabled={empty}
            >
              CSV
            </Button>
            {kind === 'attendance' && (
              <Button
                icon={<Download className="size-4" />}
                loading={file.isPending && file.variables === 'pdf'}
                onClick={() => file.mutate('pdf')}
                disabled={empty}
              >
                Descargar PDF
              </Button>
            )}
            <Button
              variant="primary"
              icon={<Download className="size-4" />}
              loading={file.isPending && file.variables === 'xlsx'}
              onClick={() => file.mutate('xlsx')}
              disabled={empty}
            >
              Descargar Excel
            </Button>
          </>
        }
      />
      <PageHelp>
        <p>
          Elija un reporte y un período: se muestra aquí y se descarga en Excel. La{' '}
          <strong className="text-ink-1">asistencia del mes</strong> trae la entrada, el almuerzo y
          la salida de cada persona, día por día, con una hoja de totales; en PDF sale una página
          por persona, con sus firmas. El <strong className="text-ink-1">resumen mensual</strong>{' '}
          trae solo los totales. El CSV sirve para cargar los datos en otro sistema.
        </p>
        <p>
          Revise antes los días incompletos (Asistencia → tarjeta de tiempo): al tramo que quedó sin
          salida no se le cuentan horas trabajadas.
        </p>
      </PageHelp>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <Field label="Reporte" hint={meta[2]}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-56">
            {REPORTS.filter(([k]) => overtimeEnabled || k !== 'overtime').map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {monthly ? (
          <Field label="Mes">
            <Select value={month} onChange={(e) => setFrom(e.target.value)} className="w-56">
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Desde">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Hasta">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
      </div>
      {file.error && <ErrorState error={file.error} />}
      <Card>
        {report.isLoading && <Spinner />}
        {report.error && <ErrorState error={report.error} />}
        {report.data && (
          <>
            <p className="border-b border-line px-4 py-3 text-xs text-ink-3">
              {report.data.total} filas
              {report.data.total > 200
                ? ' · vista previa de las primeras 200, descargue el Excel para ver todo'
                : ''}
            </p>
            <Table
              head={columns.map((c) => c.replaceAll('_', ' '))}
              empty={report.data.total === 0}
            >
              {report.data.rows.slice(0, 200).map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <Td key={c} className="tabular whitespace-nowrap text-xs">
                      {row[c] === null ? '—' : String(row[c])}
                    </Td>
                  ))}
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </>
  );
}
