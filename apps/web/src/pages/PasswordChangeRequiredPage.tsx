import { KeyRound } from 'lucide-react';
import { ChangePasswordForm } from '../components/account/ChangePasswordForm';
import { logout, refreshSession } from '../lib/api';
import { useAuth } from '../stores/auth';

/**
 * Shown instead of the whole app while the password is one an administrator chose: the API
 * refuses everything else until it is replaced. Once it is, a refreshed session (without the
 * mark) lets the app open as usual.
 */
export function PasswordChangeRequiredPage() {
  const user = useAuth((s) => s.user);
  if (!user) return null;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 rounded-2xl bg-accent p-3 text-accent-ink">
            <KeyRound className="size-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Elija su contraseña</h1>
          <p className="mt-2 text-sm text-ink-2">
            Un administrador le asignó la contraseña con la que entró. Antes de continuar,
            reemplácela por una que solo usted conozca.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface-1 shadow-sm">
          <ChangePasswordForm email={user.email} onChanged={refreshSession} />
        </div>
        <p className="mt-4 text-center text-sm text-ink-3">
          {user.email} ·{' '}
          <button type="button" onClick={() => void logout()} className="underline">
            Cerrar sesión
          </button>
        </p>
      </div>
    </div>
  );
}
