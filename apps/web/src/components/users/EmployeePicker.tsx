import type { PaginatedResponse } from '@asistcontrol/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../../lib/api';
import type { EmployeeRow } from '../../lib/types';
import { Button, Input } from '../ui';

export interface PickedEmployee {
  id: string;
  name: string;
}

/**
 * Finds the person an account belongs to. People who already have another account are shown
 * but cannot be picked: the API allows one account per employee.
 */
export function EmployeePicker({
  value,
  onChange,
  accountId,
  required,
}: {
  value: PickedEmployee | null;
  onChange: (employee: PickedEmployee | null) => void;
  /** The account being edited: its own employee is not "taken". */
  accountId?: string;
  required: boolean;
}) {
  const [search, setSearch] = useState('');
  const labelId = useId();
  const results = useQuery({
    queryKey: ['employees', 'picker', search],
    queryFn: () =>
      api<PaginatedResponse<EmployeeRow>>('/employees', {
        query: { search, pageSize: 8, status: 'ACTIVE' },
      }),
    enabled: value === null,
  });

  if (value) {
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink-2">Empleado</span>
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-line px-3 py-2">{value.name}</span>
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            Cambiar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label className="flex flex-col gap-1.5">
        <span id={labelId} className="font-medium text-ink-2">
          Empleado{required ? '' : ' (opcional)'}
        </span>
        <Input
          placeholder="Buscar por nombre o código"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <ul
        aria-labelledby={labelId}
        className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line"
      >
        {results.data?.data.map((employee) => {
          const taken = employee.user !== null && employee.user.id !== accountId;
          const name = `${employee.firstName} ${employee.lastName}`;
          return (
            <li key={employee.id}>
              <button
                type="button"
                disabled={taken}
                onClick={() => onChange({ id: employee.id, name })}
                className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>
                  {name} <span className="text-xs text-ink-3">{employee.employeeCode}</span>
                </span>
                {taken && <span className="text-xs text-ink-3">ya tiene cuenta</span>}
              </button>
            </li>
          );
        })}
        {results.data?.data.length === 0 && (
          <li className="px-3 py-2 text-ink-3">Ningún empleado coincide.</li>
        )}
      </ul>
    </div>
  );
}
