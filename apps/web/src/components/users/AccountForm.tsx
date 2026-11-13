import { isStrongPassword, type Role } from '@asistcontrol/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ROLE_LABEL, generatePassword, grantableRoles, needsEmployee } from '../../lib/accounts';
import { api } from '../../lib/api';
import { useAuthOptions } from '../../lib/auth-options';
import type { UserRow } from '../../lib/types';
import { Button, Field, Input, Select } from '../ui';
import { EmployeePicker, type PickedEmployee } from './EmployeePicker';

export const PASSWORD_HINT = 'Al menos 10 caracteres, con letras y números';

type Access = 'invite' | 'password';

const ACCESS_OPTIONS: { value: Access; label: string; hint: string }[] = [
  {
    value: 'invite',
    label: 'Enviarle una invitación por correo',
    hint: 'Le llega un enlace para elegir su contraseña. Vale 72 horas.',
  },
  {
    value: 'password',
    label: 'Darle una contraseña temporal',
    hint: 'Usted se la pasa y la persona la cambia al entrar. Para quien no tiene correo propio.',
  },
];

/**
 * Creates an account, or changes the role and the employee of an existing one. Only offers
 * the roles the signed-in user may grant, and asks for an employee whenever the role needs one.
 */
/** What each role can do, under the field that picks it (the matrix lives in shared RBAC). */
const ROLE_HINT: Record<Role, string> = {
  SUPER_ADMIN: 'Todo, incluido dar el rol de administrador',
  ADMIN: 'Todo, salvo dar el rol de administrador',
  HR: 'Empleados, horarios, asistencia, permisos y reportes. Ve dispositivos y configuración sin cambiarlos',
  SUPERVISOR: 'Solo su equipo: ve su asistencia y aprueba sus permisos y horas extra',
  EMPLOYEE: 'Solo lo suyo: su asistencia y sus solicitudes',
};

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
  /** `notice`: what to tell the administrator once it is done (e.g. where the invitation went). */
  onDone: (notice?: string) => void;
}) {
  const queryClient = useQueryClient();
  const options = useAuthOptions();
  const roles = grantableRoles(actorRole);
  const [email, setEmail] = useState(account?.email ?? '');
  const [role, setRole] = useState<Role>(account?.role ?? 'EMPLOYEE');
  const [password, setPassword] = useState('');
  // How the person gets in the first time. An invitation when the server can email it: nobody
  // else ever knows their password.
  const [chosenAccess, setAccess] = useState<Access | null>(null);
  const canInvite = options?.passwordLinks === true;
  const access: Access = chosenAccess ?? (canInvite ? 'invite' : 'password');
  const [employee, setEmployee] = useState<PickedEmployee | null>(
    account?.employee
      ? {
          id: account.employee.id,
          name: `${account.employee.firstName} ${account.employee.lastName}`,
        }
      : null,
  );
  const employeeMissing = needsEmployee(role) && employee === null;
  const passwordInvalid = !account && access === 'password' && !isStrongPassword(password);

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
            body: {
              email,
              role,
              ...(access === 'invite' ? { invite: true } : { password }),
              ...(employee && { employeeId: employee.id }),
            },
          }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
      ]);
      onDone(
        !account && access === 'invite'
          ? `Invitación enviada a ${email.trim().toLowerCase()}. El enlace vale 72 horas.`
          : undefined,
      );
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
        <Field label="Correo" hint="Con él entra al sistema y a él le llegan los avisos">
          <Input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      )}
      <Field label="Rol" hint={isSelf ? 'No puede cambiar su propio rol' : ROLE_HINT[role]}>
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
        <fieldset className="grid gap-2 lg:col-span-2">
          <legend className="mb-1 text-sm font-medium text-ink-2">Primer acceso</legend>
          {canInvite ? (
            ACCESS_OPTIONS.map(({ value, label, hint }) => (
              <label key={value} className="flex items-start gap-2 text-sm text-ink-1">
                <input
                  type="radio"
                  name="access"
                  value={value}
                  checked={access === value}
                  onChange={() => setAccess(value)}
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                />
                <span>
                  {label}
                  <span className="block text-xs text-ink-3">{hint}</span>
                </span>
              </label>
            ))
          ) : (
            <p className="text-xs text-ink-3">
              Para enviar invitaciones por correo hace falta configurar el correo del servidor.
              Mientras tanto, dele una contraseña temporal.
            </p>
          )}
        </fieldset>
      )}
      {!account && access === 'password' && (
        <Field
          label="Contraseña inicial"
          hint={`${PASSWORD_HINT}. Compártala por un canal seguro; la persona elegirá una propia al entrar.`}
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
        <Button type="button" variant="ghost" onClick={() => onDone()}>
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
