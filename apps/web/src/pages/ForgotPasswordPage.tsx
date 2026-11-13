import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AuthFrame } from '../components/AuthFrame';
import { Button, Field, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuthOptions } from '../lib/auth-options';
import { emailProblem } from '../lib/validation';

const BACK = (
  <Link to="/login" className="font-medium text-accent hover:underline">
    Volver a iniciar sesión
  </Link>
);

/**
 * "Olvidé mi contraseña" (ADR 0016). The answer is the same whether the address has an account
 * or not: the page never tells anyone which addresses are registered.
 */
export function ForgotPasswordPage() {
  const options = useAuthOptions();
  const [email, setEmail] = useState('');
  const [tried, setTried] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: (address: string) =>
      api('/auth/forgot-password', { method: 'POST', body: { email: address } }),
  });

  if (!options) return <Spinner />;

  if (!options.passwordLinks) {
    return (
      <AuthFrame heading="¿Olvidó su contraseña?" below={BACK}>
        <p className="text-sm text-ink-1">
          En este sistema la contraseña la restablece un administrador: pídale que le asigne una
          nueva. Al entrar con ella, usted elegirá la suya.
        </p>
      </AuthFrame>
    );
  }

  if (send.isSuccess) {
    return (
      <AuthFrame heading="Revise su correo" below={BACK}>
        <div role="status" className="grid gap-3 text-sm text-ink-1">
          <MailCheck className="size-8 text-accent" aria-hidden />
          <p>
            Si hay una cuenta con <strong>{send.variables}</strong>, le llegará un correo con un
            enlace para elegir una contraseña nueva.
          </p>
          <p className="text-ink-2">
            El enlace vale 30 minutos y sirve una sola vez. Si no lo ve en unos minutos, revise la
            carpeta de correo no deseado.
          </p>
        </div>
      </AuthFrame>
    );
  }

  const problem = tried ? emailProblem(email.trim()) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (emailProblem(email.trim())) {
      emailRef.current?.focus();
      return;
    }
    send.mutate(email.trim());
  }

  return (
    <AuthFrame
      heading="¿Olvidó su contraseña?"
      intro="Escriba el correo de su cuenta y le enviaremos un enlace para elegir una nueva."
      below={BACK}
    >
      <form onSubmit={submit} aria-label="Recuperar contraseña" className="space-y-4" noValidate>
        <Field label="Correo electrónico" error={problem}>
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
            onChange={(e) => (setEmail(e.target.value), send.reset())}
          />
        </Field>
        {send.error && (
          <p role="alert" className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-ink-1">
            {send.error.message}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={send.isPending}>
          Enviar enlace
        </Button>
      </form>
    </AuthFrame>
  );
}
