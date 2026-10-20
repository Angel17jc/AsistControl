import { ChangePasswordForm } from '../components/account/ChangePasswordForm';
import { Card, CardHeader, PageHeader } from '../components/ui';
import { ROLE_LABEL } from '../lib/accounts';
import { useAuth } from '../stores/auth';

/** The signed-in person's own account: who they are signed in as, and their password. */
export function AccountPage() {
  const user = useAuth((s) => s.user);
  if (!user) return null;

  return (
    <>
      <PageHeader title="Mi cuenta" description="Sus datos de acceso a AsistControl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Perfil"
            subtitle="Para cambiar su correo o su rol, pídalo a un administrador"
          />
          <dl className="grid gap-4 px-5 py-4 text-sm">
            <div>
              <dt className="text-ink-3">Nombre</dt>
              <dd className="font-medium text-ink-1">{user.displayName}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Correo</dt>
              <dd className="font-medium text-ink-1">{user.email}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Rol</dt>
              <dd className="font-medium text-ink-1">{ROLE_LABEL[user.role]}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Cambiar contraseña"
            subtitle="Se cierran sus sesiones en otros equipos; esta sigue abierta"
          />
          <ChangePasswordForm email={user.email} />
        </Card>
      </div>
    </>
  );
}
