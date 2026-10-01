import { isStrongPassword, type Role } from '@asistcontrol/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ROLE_LABEL, generatePassword, grantableRoles, needsEmployee } from '../../lib/accounts';
import { api } from '../../lib/api';
import type { UserRow } from '../../lib/types';
import { Button, Field, Input, Select } from '../ui';
import { EmployeePicker, type PickedEmployee } from './EmployeePicker';

export const PASSWORD_HINT = 'Al menos 10 caracteres, con letras y números';

/**
 * Creates an account, or changes the role and the employee of an existing one. Only offers
 * the roles the signed-in user may grant, and asks for an employee whenever the role needs one.
 */
export function AccountForm({
  account,
  actorRole,
  isSelf,
  onDone,
}: {
  account?: UserRow;
  actorRole: Role;
  /** People cannot change their own role (the API refuses it). */
  isSelf: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const roles = grantableRoles(actorRole);
  const [email, setEmail] = useState(account?.email ?? '');
  const [role, setRole] = useState<Role>(account?.role ?? 'EMPLOYEE');
  const [password, setPassword] = useState('');
  const [employee, setEmployee] = useState<PickedEmployee | null>(
    account?.employee
      ? {
          id: account.employee.id,
          name: `${account.employee.firstName} ${account.employee.lastName}`,
        }
      : null,
  );
  const employeeMissing = needsEmployee(role) && employee === null;
  const passwordInvalid = !account && !isStrongPassword(password);

  const save = useMutation({
    mutationFn: () =>
      account
        ? api(`/users/${account.id}`, {
            method: 'PATCH',
            body: {
              ...(isSelf ? {} : { role }),
              employeeId: employee?.id ?? null,
            },
          })
        : api('/users', {
            method: 'POST',
            body: { email, password, role, ...(employee && { employeeId: employee.id }) },
          }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
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
      aria-label={account ? `Editar cuenta ${account.email}` : 'Nueva cuenta'}
      className="grid gap-4 border-b border-line p-5 lg:grid-cols-2"
    >
      {!account && (
        <Field label="Correo">
          <Input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      )}
      <Field label="Rol" hint={isSelf ? 'No puede cambiar su propio rol' : undefined}>
        <Select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <EmployeePicker
        value={employee}
        onChange={setEmployee}
        accountId={account?.id}
        required={needsEmployee(role)}
      />
      {!account && (
        <Field
          label="Contraseña inicial"
          hint={`${PASSWORD_HINT}. Compártala por un canal seguro.`}
        >
          <div className="flex gap-2">
            <Input
              type="text"
              required
              autoComplete="new-password"
              className="flex-1 font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="button" onClick={() => setPassword(generatePassword())}>
              Generar
            </Button>
          </div>
        </Field>
      )}
      {employeeMissing && (
        <p className="text-sm text-ink-2 lg:col-span-2">
          Una cuenta de {ROLE_LABEL[role].toLowerCase()} ve sus datos a través de su empleado: elija
          uno.
        </p>
      )}
      <div className="flex items-center gap-2 lg:col-span-2">
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          disabled={employeeMissing || passwordInvalid}
        >
          {account ? 'Guardar cambios' : 'Crear cuenta'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-critical lg:col-span-2">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
