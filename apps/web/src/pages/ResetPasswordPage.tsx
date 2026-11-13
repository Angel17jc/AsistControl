import { isStrongPassword, type PasswordLinkInfo } from '@asistcontrol/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AuthFrame } from '../components/AuthFrame';
import { Button, Field, PasswordInput, Spinner } from '../components/ui';
import { PASSWORD_HINT } from '../components/users/AccountForm';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../stores/auth';

const ASK_AGAIN = (
  <Link to="/olvide-contrasena" className="font-medium text-accent hover:underline">
    Pedir un enlace nuevo
  </Link>
);
const BACK = (
  <Link to="/login" className="font-medium text-accent hover:underline">
    Volver a iniciar sesión
  </Link>
);

/** The token travels after `#` so it never reaches a server log; read it once and hide it. */
function takeToken(): string {
  const token = window.location.hash.slice(1);
  if (token) window.history.replaceState(window.history.state, '', window.location.pathname);
  return token;
}

/**
 * Where an emailed link lands (ADR 0016): "olvidé mi contraseña" or an invitation. Says whose
 * password it sets, asks for it twice, and sends the person to sign in with it.
 */
export function ResetPasswordPage() {
  const [token] = useState(takeToken);
  const link = useQuery({
    queryKey: ['password-link', token],
    queryFn: () =>
      api<PasswordLinkInfo>('/auth/password-link', { method: 'POST', body: { token } }),
    enabled: token !== '',
    retry: false,
    staleTime: Infinity,
  });

  if (!token) {
    return (
      <AuthFrame
        heading="Enlace incompleto"
        below={
          <>
            {ASK_AGAIN}
            {BACK}
          </>
        }
      >
        <p className="text-sm text-ink-1">
          Al enlace le falta una parte. Ábralo de nuevo desde el botón del correo, o pida uno nuevo.
        </p>
      </AuthFrame>
    );
  }
  if (link.isPending) return <Spinner />;
  if (link.error) {
    // An expired invitation is renewed by an administrator, not from "olvidé mi contraseña".
    const params = link.error instanceof ApiError ? link.error.body?.params : undefined;
    const expiredInvite =
      link.error instanceof ApiError &&
      link.error.body?.code === 'PASSWORD_LINK_EXPIRED' &&
      (params as { purpose?: string } | undefined)?.purpose === 'INVITE';
    return (
      <AuthFrame
        heading="Este enlace ya no sirve"
        below={
          expiredInvite ? (
            BACK
          ) : (
            <>
              {ASK_AGAIN}
              {BACK}
            </>
          )
        }
      >
        <p role="alert" className="text-sm text-ink-1">
          {link.error.message}
        </p>
      </AuthFrame>
    );
  }
  return <ChoosePassword token={token} info={link.data} />;
}

function ChoosePassword({ token, info }: { token: string; info: PasswordLinkInfo }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [tried, setTried] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () =>
      api('/auth/reset-password', { method: 'POST', body: { token, newPassword: password } }),
    // Every session of the account just ended, this browser's included.
    onSuccess: () => useAuth.getState().clear(),
  });
  useEffect(() => passwordRef.current?.focus(), []);

  const invite = info.purpose === 'INVITE';
  if (save.isSuccess) {
    return (
      <AuthFrame heading="Contraseña guardada">
        <div role="status" className="grid gap-3 text-sm text-ink-1">
          <CheckCircle2 className="size-8 text-good" aria-hidden />
          <p>
            {invite
              ? 'Su cuenta está lista. Ya puede entrar con su correo y la contraseña que eligió.'
              : 'Ya puede entrar con su nueva contraseña. Las sesiones abiertas con la anterior se cerraron.'}
          </p>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => navigate('/login', { state: { email: info.email } })}
          >
            Iniciar sesión
          </Button>
        </div>
      </AuthFrame>
    );
  }

  const weak = tried && !isStrongPassword(password) ? PASSWORD_HINT + '.' : null;
  const mismatch =
    tried && !weak && repeat !== password ? 'Las dos contraseñas no coinciden.' : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!isStrongPassword(password)) return passwordRef.current?.focus();
    if (repeat !== password) return repeatRef.current?.focus();
    save.mutate();
  }

  return (
    <AuthFrame
      heading={invite ? 'Elija su contraseña' : 'Elija una contraseña nueva'}
      intro={
        <>
          Para la cuenta <strong className="text-ink-1">{info.email}</strong>
        </>
      }
      below={BACK}
    >
      <form onSubmit={submit} aria-label="Elegir contraseña" className="space-y-4" noValidate>
        {/* Lets a password manager know which account the password belongs to. */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <Field label="Contraseña nueva" hint={weak ? undefined : PASSWORD_HINT} error={weak}>
          <PasswordInput
            ref={passwordRef}
            autoComplete="new-password"
            required
            maxLength={128}
            value={password}
            onChange={(e) => (setPassword(e.target.value), save.reset())}
          />
        </Field>
        <Field label="Repita la contraseña" error={mismatch}>
          <PasswordInput
            ref={repeatRef}
            autoComplete="new-password"
            required
            maxLength={128}
            value={repeat}
            onChange={(e) => (setRepeat(e.target.value), save.reset())}
          />
        </Field>
        {save.error && (
          <p role="alert" className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-ink-1">
            {save.error.message}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={save.isPending}>
          Guardar contraseña
        </Button>
      </form>
    </AuthFrame>
  );
}
