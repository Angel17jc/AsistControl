import { type FormEvent, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';
import { Button, Field, Input, PasswordInput } from '../components/ui';
import { ApiError, login } from '../lib/api';
import { useAuth } from '../stores/auth';

interface Problems {
  email?: string;
  password?: string;
}

/**
 * A first check before asking the server, so a typo is pointed at its field instead of
 * coming back as a general error. The server validates again (and lowercases the email).
 * No regular expression: a plain scan cannot backtrack on a long input.
 */
function looksLikeEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

function check(email: string, password: string): Problems {
  const problems: Problems = {};
  if (!email) problems.email = 'Escriba su correo.';
  else if (!looksLikeEmail(email))
    problems.email = 'Revise el correo: debe tener la forma nombre@empresa.com.';
  if (!password) problems.password = 'Escriba su contraseña.';
  return problems;
}

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Field problems show after the first try and then follow what is typed.
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const problems = tried ? check(email.trim(), password) : {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    setError(null);
    const found = check(email.trim(), password);
    if (found.email || found.password) {
      (found.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
      // Wrong email or password: the password is what usually needs retyping.
      if (err instanceof ApiError && err.body?.code === 'INVALID_CREDENTIALS') {
        passwordRef.current?.focus();
        passwordRef.current?.select();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-surface-1 px-4 py-12 sm:bg-surface-0">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogo className="mb-5 h-20" />
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-1">
            AsistControl
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Control de asistencia y dispositivos biométricos
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          aria-label="Iniciar sesión"
          className="space-y-4 rounded-xl border border-t-4 border-line border-t-brand-yellow bg-surface-1 p-6 shadow-sm"
          noValidate
        >
          <Field label="Correo electrónico" error={problems.email}>
            <Input
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
              maxLength={254}
              placeholder="nombre@empresa.com"
              value={email}
              onChange={(e) => (setEmail(e.target.value), setError(null))}
            />
          </Field>
          <Field label="Contraseña" error={problems.password}>
            <PasswordInput
              ref={passwordRef}
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => (setPassword(e.target.value), setError(null))}
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-ink-1">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-3">
          ¿Olvidó su contraseña? Pida a un administrador que se la restablezca.
        </p>
        {import.meta.env.DEV && (
          <p className="mt-2 text-center text-xs text-ink-3">
            Demo: admin@asistcontrol.local · AsistControl2026
          </p>
        )}
      </div>
    </div>
  );
}
