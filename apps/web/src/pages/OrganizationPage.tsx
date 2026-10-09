import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Spinner,
  Table,
  Td,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import type { CatalogRow } from '../lib/types';
import { useAuth } from '../stores/auth';

interface Catalog {
  resource: 'departments' | 'positions';
  title: string;
  subtitle: string;
  /** "Nuevo departamento", "Nuevo cargo". */
  newLabel: string;
  noun: string;
  /** Departments carry a short code (OPS, RRHH) used in reports. */
  hasCode: boolean;
}

const DEPARTMENTS: Catalog = {
  resource: 'departments',
  title: 'Departamentos',
  subtitle: 'Áreas de la empresa; agrupan a los empleados en reportes y filtros',
  newLabel: 'Nuevo departamento',
  noun: 'departamento',
  hasCode: true,
};

const POSITIONS: Catalog = {
  resource: 'positions',
  title: 'Cargos',
  subtitle: 'Puestos de trabajo que ocupa cada empleado',
  newLabel: 'Nuevo cargo',
  noun: 'cargo',
  hasCode: false,
};

/** The lists the employee form offers: departments and positions. */
export function OrganizationPage() {
  return (
    <>
      <PageHeader
        title="Organización"
        description="Departamentos y cargos que se asignan a cada empleado"
      />
      <div className="grid gap-6">
        <CatalogCard catalog={DEPARTMENTS} />
        <CatalogCard catalog={POSITIONS} />
      </div>
    </>
  );
}

function CatalogCard({ catalog }: { catalog: Catalog }) {
  const canWrite = useAuth((s) => s.can('organization:write'));
  const [editing, setEditing] = useState<CatalogRow | 'new' | null>(null);
  const queryClient = useQueryClient();
  // Same key as the employee form's options: one fetch, and edits show up there too.
  const rows = useQuery({
    queryKey: [catalog.resource],
    queryFn: () => api<CatalogRow[]>(`/${catalog.resource}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/${catalog.resource}/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [catalog.resource] }),
  });

  return (
    <Card>
      <CardHeader
        title={catalog.title}
        subtitle={catalog.subtitle}
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => (remove.reset(), setEditing('new'))}
            >
              {catalog.newLabel}
            </Button>
          )
        }
      />
      {editing && (
        <CatalogForm
          key={editing === 'new' ? 'new' : editing.id}
          catalog={catalog}
          row={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
        />
      )}
      {rows.error && <ErrorState error={rows.error} />}
      {remove.error && (
        <ErrorState
          error={
            isConflict(remove.error)
              ? new Error(`Ese ${catalog.noun} tiene empleados: reasígnelos antes de eliminarlo.`)
              : remove.error
          }
        />
      )}
      {rows.isLoading && <Spinner />}
      {rows.data && (
        <Table
          head={[...(catalog.hasCode ? ['Código'] : []), 'Nombre', 'Descripción', 'Empleados', '']}
          empty={rows.data.length === 0}
        >
          {rows.data.map((row) => (
            <tr key={row.id}>
              {catalog.hasCode && <Td className="font-mono text-xs">{row.code}</Td>}
              <Td className="font-medium">{row.name}</Td>
              <Td className="text-ink-2">{row.description || '—'}</Td>
              <Td className="tabular">{row._count.employees}</Td>
              <Td>
                {canWrite && (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      icon={<Pencil className="size-3.5" />}
                      aria-label={`Editar ${row.name}`}
                      onClick={() => (remove.reset(), setEditing(row))}
                    >
                      Editar
                    </Button>
                    {/* Only empty ones can go: the API refuses the rest anyway (409). */}
                    {row._count.employees === 0 && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        icon={<Trash2 className="size-3.5 text-critical" />}
                        aria-label={`Eliminar ${row.name}`}
                        loading={remove.isPending && remove.variables === row.id}
                        onClick={() => remove.mutate(row.id)}
                      >
                        Eliminar
                      </Button>
                    )}
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function CatalogForm({
  catalog,
  row,
  onDone,
}: {
  catalog: Catalog;
  row?: CatalogRow;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: row?.code ?? '',
    name: row?.name ?? '',
    description: row?.description ?? '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(catalog.hasCode ? { code: form.code } : {}),
        name: form.name,
        // An emptied description is cleared, not stored as "".
        description: form.description.trim() || null,
      };
      return row
        ? api(`/${catalog.resource}/${row.id}`, { method: 'PATCH', body })
        : api(`/${catalog.resource}`, { method: 'POST', body });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [catalog.resource] }),
        // Employee rows show the department and position names.
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
      ]);
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label={row ? `Editar ${row.name}` : catalog.newLabel}
      className="grid gap-4 border-b border-line p-5 sm:grid-cols-2 lg:grid-cols-4"
    >
      {catalog.hasCode && (
        <Field label="Código" hint="2 a 20 letras, números, - o _">
          <Input
            required
            pattern="[A-Za-z0-9_\-]{2,20}"
            className="w-full font-mono uppercase"
            value={form.code}
            onChange={set('code')}
          />
        </Field>
      )}
      <Field label="Nombre">
        <Input required minLength={2} maxLength={100} value={form.name} onChange={set('name')} />
      </Field>
      <div className={catalog.hasCode ? 'lg:col-span-2' : 'sm:col-span-2 lg:col-span-3'}>
        <Field label="Descripción (opcional)">
          <Input maxLength={500} value={form.description} onChange={set('description')} />
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {row ? 'Guardar cambios' : 'Crear'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-4">
          {isConflict(save.error)
            ? `Ya existe un ${catalog.noun} con ese ${catalog.hasCode ? 'código o nombre' : 'nombre'}.`
            : save.error.message}
        </p>
      )}
    </form>
  );
}

const isConflict = (error: Error) => error instanceof ApiError && error.status === 409;
