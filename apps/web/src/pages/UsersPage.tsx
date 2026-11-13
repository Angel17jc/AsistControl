import { isStrongPassword, type PaginatedResponse, ROLES, type Role } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Mail, Pencil, Plus, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AccountForm, PASSWORD_HINT } from '../components/users/AccountForm';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageHelp,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  Td,
} from '../components/ui';
import { ROLE_LABEL, canManageAccount, generatePassword } from '../lib/accounts';
import { api } from '../lib/api';
import { useAuthOptions } from '../lib/auth-options';
import { formatDateTime, relativeTime } from '../lib/format';
import type { UserRow } from '../lib/types';
import { useAuth } from '../stores/auth';

/**
 * Platform accounts: who can sign in, with which role, and as which employee. Administrators
 * manage them; administrator accounts are a super admin's. Every rule here mirrors the API's,
 * which enforces them anyway.
 */
export function UsersPage() {
  const me = useAuth((s) => s.user);
  const canWrite = useAuth((s) => s.can('users:write'));
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ['users', search, role, page],
    queryFn: () =>
      api<PaginatedResponse<UserRow>>('/users', {
        query: { search, role, page, pageSize: 20 },
      }),
  });
  if (!me) return null;

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Cuentas para entrar a AsistControl, con su rol y el empleado al que pertenecen"
        actions={
          canWrite && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => (setResetting(null), setNotice(null), setEditing('new'))}
            >
              Nueva cuenta
            </Button>
          )
        }
      />
      <PageHelp>
        <p>
          Una <strong className="text-ink-1">cuenta</strong> es para entrar al sistema; un{' '}
          <strong className="text-ink-1">empleado</strong> es quien marca. Supervisores y empleados
          necesitan su ficha de empleado vinculada: así el sistema sabe cuál es su equipo o su
          asistencia.
        </p>
        <p>
          Para el primer acceso, la persona recibe una{' '}
          <strong className="text-ink-1">invitación por correo</strong> y elige su contraseña con el
          enlace (si el servidor tiene el correo configurado), o usted le da una contraseña temporal
          que cambiará al entrar.
        </p>
        <p>
          Una invitación vale 72 horas: si venció o no le llegó, use «Reenviar invitación».
          Restablecer una contraseña cierra las sesiones abiertas de esa cuenta.
        </p>
      </PageHelp>
      {notice && (
        <p role="status" className="mb-6 rounded-lg bg-good/10 px-4 py-3 text-sm text-ink-1">
          {notice}
        </p>
      )}
      {editing && (
        <Card className="mb-6">
          <AccountForm
            key={editing === 'new' ? 'new' : editing.id}
            account={editing === 'new' ? undefined : editing}
            actorRole={me.role}
            isSelf={editing !== 'new' && editing.id === me.id}
            onDone={(message) => (setEditing(null), setNotice(message ?? null))}
          />
        </Card>
      )}
      {resetting && (
        <Card className="mb-6">
          <ResetPasswordForm
            key={resetting.id}
            account={resetting}
            onDone={() => setResetting(null)}
          />
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-3"
              aria-hidden
            />
            <Input
              aria-label="Buscar cuenta por correo"
              placeholder="Buscar por correo"
              className="w-full pl-9"
              value={search}
              onChange={(e) => (setSearch(e.target.value), setPage(1))}
            />
          </div>
          <Select
            aria-label="Filtrar por rol"
            value={role}
            onChange={(e) => (setRole(e.target.value as Role | ''), setPage(1))}
          >
            <option value="">Todos los roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        {users.isLoading && <Spinner />}
        {users.error && <ErrorState error={users.error} />}
        {users.data && (
          <>
            <Table
              head={['Cuenta', 'Rol', 'Empleado', 'Estado', 'Último acceso', '']}
              empty={users.data.data.length === 0}
            >
              {users.data.data.map((u) => (
                <AccountRow
                  key={u.id}
                  account={u}
                  isSelf={u.id === me.id}
                  manage={canWrite && canManageAccount(me.role, u.role)}
                  onEdit={() => (setResetting(null), setEditing(u))}
                  onReset={() => (setEditing(null), setResetting(u))}
                />
              ))}
            </Table>
            <Pagination
              page={users.data.meta.page}
              totalPages={users.data.meta.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}

function AccountRow({
  account,
  isSelf,
  manage,
  onEdit,
  onReset,
}: {
  account: UserRow;
  isSelf: boolean;
  manage: boolean;
  onEdit: () => void;
  onReset: () => void;
}) {
  const queryClient = useQueryClient();
  const canInvite = useAuthOptions()?.passwordLinks === true;
  const [confirming, setConfirming] = useState(false);
  const toggle = useMutation({
    mutationFn: (isActive: boolean) =>
      api(`/users/${account.id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const resend = useMutation({
    mutationFn: () => api(`/users/${account.id}/invitation`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
  // Never signed in: an invitation is how they get in (a new one replaces the old link).
  const invitable = account.isActive && account.lastLoginAt === null;
  // The server says whether it expired: the browser's clock may be off.
  const invitation = account.invitation ?? null;
  const expired = invitation?.expired === true;

  return (
    <tr>
      <Td>
        <p className="font-medium">
          {account.email}
          {isSelf && <span className="ml-2 text-xs font-normal text-ink-3">(usted)</span>}
        </p>
      </Td>
      <Td className="text-ink-2">{ROLE_LABEL[account.role]}</Td>
      <Td className="text-ink-2">
        {account.employee
          ? `${account.employee.firstName} ${account.employee.lastName} · ${account.employee.employeeCode}`
          : '—'}
      </Td>
      <Td>
        <StatusBadge tone={account.isActive ? 'good' : 'neutral'}>
          {account.isActive ? 'Activa' : 'Desactivada'}
        </StatusBadge>
        {account.mustChangePassword && (
          <p className="mt-1 text-xs text-ink-3">Contraseña temporal: la cambiará al entrar</p>
        )}
        {invitation && (
          <p className={`mt-1 text-xs ${expired ? 'font-medium text-critical' : 'text-ink-3'}`}>
            {expired
              ? 'Invitación vencida: reenvíela'
              : `Invitación enviada · vence el ${formatDateTime(invitation.expiresAt)}`}
          </p>
        )}
        {resend.isSuccess && (
          <p role="status" className="mt-1 text-xs text-ink-1">
            Invitación reenviada.
          </p>
        )}
        {resend.error && (
          <p role="alert" className="mt-1 text-xs text-critical">
            {resend.error.message}
          </p>
        )}
      </Td>
      <Td className="text-ink-2">{relativeTime(account.lastLoginAt)}</Td>
      <Td>
        {manage && (
          <div className="flex flex-wrap justify-end gap-1">
            {confirming ? (
              <>
                <span className="self-center text-xs text-ink-2">Cierra sus sesiones.</span>
                <Button
                  variant="danger"
                  className="px-2 py-1 text-xs"
                  loading={toggle.isPending}
                  onClick={() => toggle.mutate(false)}
                >
                  Sí, desactivar
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => setConfirming(false)}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  icon={<Pencil className="size-3.5" />}
                  aria-label={`Editar ${account.email}`}
                  onClick={onEdit}
                >
                  Editar
                </Button>
                {invitable && canInvite && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    icon={<Mail className="size-3.5" />}
                    aria-label={`Reenviar invitación a ${account.email}`}
                    loading={resend.isPending}
                    onClick={() => resend.mutate()}
                  >
                    {invitation ? 'Reenviar invitación' : 'Enviar invitación'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  icon={<KeyRound className="size-3.5" />}
                  aria-label={`Restablecer contraseña de ${account.email}`}
                  onClick={onReset}
                >
                  Contraseña
                </Button>
                {/* Nobody deactivates themselves: the API refuses it. */}
                {!isSelf &&
                  (account.isActive ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      aria-label={`Desactivar ${account.email}`}
                      onClick={() => setConfirming(true)}
                    >
                      Desactivar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      aria-label={`Activar ${account.email}`}
                      loading={toggle.isPending}
                      onClick={() => toggle.mutate(true)}
                    >
                      Activar
                    </Button>
                  ))}
              </>
            )}
          </div>
        )}
        {toggle.error && (
          <p role="alert" className="text-right text-xs text-critical">
            {toggle.error.message}
          </p>
        )}
      </Td>
    </tr>
  );
}

function ResetPasswordForm({ account, onDone }: { account: UserRow; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () =>
      api(`/users/${account.id}/reset-password`, { method: 'POST', body: { password } }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    reset.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label={`Restablecer contraseña de ${account.email}`}
      className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-end"
    >
      <Field
        label={`Nueva contraseña para ${account.email}`}
        hint={`${PASSWORD_HINT}. Se cierran sus sesiones abiertas y deberá cambiarla al entrar.`}
      >
        <div className="flex gap-2">
          <Input
            type="text"
            required
            autoComplete="new-password"
            className="flex-1 font-mono"
            value={password}
            onChange={(e) => (setPassword(e.target.value), reset.reset())}
          />
          <Button type="button" onClick={() => (setPassword(generatePassword()), reset.reset())}>
            Generar
          </Button>
        </div>
      </Field>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          loading={reset.isPending}
          disabled={!isStrongPassword(password) || reset.isSuccess}
        >
          Restablecer
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {reset.isSuccess ? 'Cerrar' : 'Cancelar'}
        </Button>
      </div>
      {reset.isSuccess && (
        <p role="status" className="text-sm text-ink-1 sm:col-span-2">
          Contraseña restablecida. Compártala por un canal seguro: la persona elegirá una propia al
          entrar.
        </p>
      )}
      {reset.error && (
        <p role="alert" className="text-sm text-critical sm:col-span-2">
          {reset.error.message}
        </p>
      )}
    </form>
  );
}
