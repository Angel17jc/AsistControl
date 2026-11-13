import { type FormEvent, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { AuthFrame } from '../components/AuthFrame';
import { Button, Field, Input, PasswordInput } from '../components/ui';
import { ApiError, login } from '../lib/api';
import { useAuthOptions } from '../lib/auth-options';
import { emailProblem } from '../lib/validation';
import { useAuth } from '../stores/auth';

interface Problems {
  email?: string;
  password?: string;
}

function check(email: string, password: string): Problems {
  const problems: Problems = {};
  const emailIssue = emailProblem(email);
  if (emailIssue) problems.email = emailIssue;
  if (!password) problems.password = 'Escriba su contraseña.';
  return problems;
}

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const options = useAuthOptions();
  // Coming back from choosing a password: the address is already known.
  const arrived = (useLocation().state as { email?: string } | null)?.email;
  const [email, setEmail] = useState(arrived ?? '');
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
    <AuthFrame
      heading="AsistControl"
      intro="Control de asistencia y dispositivos biométricos"
      below={
        <>
          {options?.passwordLinks ? (
            <Link to="/olvide-contrasena" className="font-medium text-accent hover:underline">
              ¿Olvidó su contraseña?
            </Link>
          ) : (
            <p>¿Olvidó su contraseña? Pida a un administrador que se la restablezca.</p>
          )}
          {import.meta.env.DEV && <p>Demo: admin@asistcontrol.local · AsistControl2026</p>}
        </>
      }
    >
      <form onSubmit={onSubmit} aria-label="Iniciar sesión" className="space-y-4" noValidate>
        <Field label="Correo electrónico" error={problems.email}>
          <Input
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={!arrived}
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
            autoFocus={!!arrived}
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
    </AuthFrame>
  );
}
