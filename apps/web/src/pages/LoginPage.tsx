import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import { BrandLogo } from '../components/BrandLogo';
import { Button, Field, Input } from '../components/ui';
import { login } from '../lib/api';
import { useAuth } from '../stores/auth';

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
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
          className="space-y-4 rounded-xl border border-t-4 border-line border-t-brand-yellow bg-surface-1 p-6 shadow-sm"
          noValidate
        >
          <Field label="Correo electrónico">
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Contraseña">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-ink-1">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={loading}
            disabled={!email || !password}
          >
            Ingresar
          </Button>
        </form>
        {import.meta.env.DEV && (
          <p className="mt-4 text-center text-xs text-ink-3">
            Demo: admin@asistcontrol.local · AsistControl2026
          </p>
        )}
      </div>
    </div>
  );
}
