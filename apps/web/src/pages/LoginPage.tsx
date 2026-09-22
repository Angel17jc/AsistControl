import { Fingerprint } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
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
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 rounded-2xl bg-accent p-3 text-accent-ink">
            <Fingerprint className="size-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">AsistControl</h1>
          <p className="mt-1 text-sm text-ink-2">
            Control de asistencia y dispositivos biométricos
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-line bg-surface-1 p-6 shadow-sm"
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
