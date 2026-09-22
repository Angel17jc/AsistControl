import type { PaginatedResponse } from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Spinner,
  Table,
  Td,
} from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AuditRow } from '../lib/types';

export function AuditPage() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', entity, action, page],
    queryFn: () =>
      api<PaginatedResponse<AuditRow>>('/audit-logs', {
        query: { entity, action, page, pageSize: 30 },
      }),
  });

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Registro inmutable de operaciones: quién hizo qué, cuándo y desde dónde"
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="Entidad">
          <Input
            placeholder="Employee, Device…"
            value={entity}
            onChange={(e) => (setEntity(e.target.value), setPage(1))}
          />
        </Field>
        <Field label="Acción">
          <Input
            placeholder="auth.login, update…"
            value={action}
            onChange={(e) => (setAction(e.target.value), setPage(1))}
          />
        </Field>
      </div>
      <Card>
        {isLoading && <Spinner />}
        {error && <ErrorState error={error} />}
        {data && (
          <>
            <Table
              head={['Fecha', 'Usuario', 'Acción', 'Entidad', 'IP', 'Detalle']}
              empty={data.data.length === 0}
            >
              {data.data.map((a) => (
                <tr key={a.id}>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
                  <Td>{a.actor?.email ?? <span className="text-ink-3">sistema</span>}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-ink-2">
                    {a.entity}
                    {a.entityId && (
                      <span className="block font-mono text-[11px] text-ink-3">
                        {a.entityId.slice(0, 8)}
                      </span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs text-ink-2">{a.ip ?? '—'}</Td>
                  <Td
                    className="max-w-sm truncate font-mono text-[11px] text-ink-3"
                    title={a.metadata ? JSON.stringify(a.metadata) : ''}
                  >
                    {a.metadata ? JSON.stringify(a.metadata) : '—'}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
