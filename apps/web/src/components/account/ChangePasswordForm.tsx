import { isStrongPassword } from '@asistcontrol/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { Button, Field, Input } from '../ui';
import { PASSWORD_HINT } from '../users/AccountForm';

/**
 * Replaces the signed-in person's password. `onChanged` runs after the API accepted it, e.g.
 * to refresh the session when the change was required.
 */
export function ChangePasswordForm({
  email,
  onChanged,
}: {
  email: string;
  onChanged?: () => unknown;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const change = useMutation({
    mutationFn: () =>
      api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setRepeat('');
      await onChanged?.();
    },
  });

  // The API checks all of this too; checking first says what is wrong before submitting.
  const problem =
    next && current && next === current
      ? 'La nueva contraseña debe ser distinta de la actual.'
      : repeat && repeat !== next
        ? 'Las contraseñas nuevas no coinciden.'
        : null;
  const ready = current !== '' && isStrongPassword(next) && repeat === next && !problem;
  const type = visible ? 'text' : 'password';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) change.mutate();
  }

  return (
    <form onSubmit={submit} aria-label="Cambiar contraseña" className="grid gap-4 px-5 py-4">
      {/* Lets a password manager know which account the new password belongs to. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <Field label="Contraseña actual">
        <Input
          type={type}
          required
          autoComplete="current-password"
          value={current}
          onChange={(e) => (setCurrent(e.target.value), change.reset())}
        />
      </Field>
      <Field label="Nueva contraseña" hint={PASSWORD_HINT}>
        <Input
          type={type}
          required
          autoComplete="new-password"
          value={next}
          onChange={(e) => (setNext(e.target.value), change.reset())}
        />
      </Field>
      <Field label="Repita la nueva contraseña">
        <Input
          type={type}
          required
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => (setRepeat(e.target.value), change.reset())}
        />
      </Field>
      <label className="inline-flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
        Mostrar contraseñas
      </label>
      {problem && (
        <p role="alert" className="text-sm text-critical">
          {problem}
        </p>
      )}
      {change.error && (
        <p role="alert" className="text-sm text-critical">
          {errorText(change.error)}
        </p>
      )}
      {change.isSuccess && (
        <p role="status" className="text-sm text-ink-1">
          Contraseña cambiada. Se cerraron sus sesiones en otros equipos.
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!ready}>
          Cambiar contraseña
        </Button>
      </div>
    </form>
  );
}

function errorText(error: Error): string {
  if (error instanceof ApiError && error.status === 403) {
    return 'La contraseña actual no es correcta.';
  }
  if (error instanceof ApiError && error.status === 429) {
    return 'Demasiados intentos. Espere un minuto y vuelva a intentarlo.';
  }
  return error.message;
}
