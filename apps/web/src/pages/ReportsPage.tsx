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
  Select,
  Spinner,
  Table,
  Td,
} from '../components/ui';
import { api, download } from '../lib/api';
import { todayIso } from '../lib/format';

const REPORTS = [
  ['daily', 'Asistencia diaria', 'Una fila por empleado y día'],
  ['monthly', 'Resumen mensual', 'Totales por empleado para nómina'],
  ['late', 'Atrasos', 'Jornadas con llegada tardía'],
  ['absences', 'Ausencias', 'Días laborables sin asistencia'],
  ['overtime', 'Horas extra', 'Propuestas y aprobadas'],
  ['events', 'Marcaciones', 'Detalle de cada marcación'],
  ['sync', 'Sincronización', 'Historial de descargas por dispositivo'],
] as const;

type Kind = (typeof REPORTS)[number][0];

interface ReportResponse {
  total: number;
  rows: Record<string, string | number | boolean | null>[];
}

export function ReportsPage() {
  const [kind, setKind] = useState<Kind>('daily');
  const [from, setFrom] = useState(todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const query = { from, to: kind === 'monthly' ? undefined : to };

  const report = useQuery({
    queryKey: ['report', kind, from, to],
    queryFn: () => api<ReportResponse>(`/reports/${kind}`, { query }),
  });
  const csv = useMutation({
    mutationFn: () =>
      download(`/reports/${kind}`, { ...query, format: 'csv' }, `asistcontrol-${kind}.csv`),
  });
  const meta = REPORTS.find(([k]) => k === kind)!;
  const columns = report.data?.rows[0] ? Object.keys(report.data.rows[0]) : [];

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Información lista para revisión de Talento Humano y procesos de nómina"
        actions={
          <Button
            variant="primary"
            icon={<Download className="size-4" />}
            loading={csv.isPending}
            onClick={() => csv.mutate()}
            disabled={!report.data?.total}
          >
            Descargar CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Reporte" hint={meta[2]}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-56">
            {REPORTS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={kind === 'monthly' ? 'Mes' : 'Desde'}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        {kind !== 'monthly' && (
          <Field label="Hasta">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        )}
      </div>
      {csv.error && <ErrorState error={csv.error} />}
      <Card>
        {report.isLoading && <Spinner />}
        {report.error && <ErrorState error={report.error} />}
        {report.data && (
          <>
            <p className="border-b border-line px-4 py-3 text-xs text-ink-3">
              {report.data.total} filas
              {report.data.total > 200
                ? ' · vista previa de las primeras 200, descargue el CSV para ver todo'
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
