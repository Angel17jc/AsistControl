import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { driverPreset } from '../../lib/device-drivers';
import { Button, Card, Field, Input, Select } from '../ui';

type Protocol = 'http' | 'https';

/**
 * Registers a terminal. Choosing a driver fills in its usual manufacturer, model and port
 * and asks for the credentials it needs; those are sent once, stored encrypted by the API
 * and never shown again.
 */
export function DeviceForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const drivers = useQuery({
    queryKey: ['devices', 'drivers'],
    queryFn: () => api<string[]>('/devices/drivers'),
  });
  const initial = driverPreset('MOCK');
  const [form, setForm] = useState({
    name: '',
    driver: 'MOCK',
    manufacturer: initial.manufacturer,
    model: initial.model,
    host: '192.168.1.210',
    port: String(initial.port),
    location: '',
  });
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [protocol, setProtocol] = useState<Protocol>('http');
  const preset = driverPreset(form.driver);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function changeDriver(driver: string) {
    const next = driverPreset(driver);
    setForm((f) => ({
      ...f,
      driver,
      manufacturer: next.manufacturer,
      model: next.model,
      port: String(next.port),
    }));
    // Credentials belong to one driver: never carry a password over to another.
    setCredentials({});
    setProtocol('http');
  }

  function changeProtocol(next: Protocol) {
    setProtocol(next);
    // Follow the standard port unless the user typed a custom one.
    setForm((f) =>
      ['80', '443'].includes(f.port) ? { ...f, port: next === 'https' ? '443' : '80' } : f,
    );
  }

  const create = useMutation({
    mutationFn: () => {
      const filled = Object.fromEntries(
        Object.entries(credentials).filter(([, value]) => value.trim() !== ''),
      );
      return api('/devices', {
        method: 'POST',
        body: {
          ...form,
          port: Number(form.port),
          location: form.location || undefined,
          config: { realtime: true, ...(preset.httpTransport && { protocol }) },
          credentials: Object.keys(filled).length > 0 ? filled : undefined,
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card className="mb-6">
      <form
        onSubmit={submit}
        aria-label="Registrar dispositivo"
        className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Field label="Nombre">
          <Input required value={form.name} onChange={set('name')} placeholder="Entrada planta 2" />
        </Field>
        <Field label="Driver">
          <Select value={form.driver} onChange={(e) => changeDriver(e.target.value)}>
            {(drivers.data ?? ['MOCK']).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fabricante">
          <Input required value={form.manufacturer} onChange={set('manufacturer')} />
        </Field>
        <Field label="Modelo">
          <Input required value={form.model} onChange={set('model')} />
        </Field>
        <Field label="IP / host">
          <Input required value={form.host} onChange={set('host')} />
        </Field>
        <Field label="Puerto">
          <Input
            required
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={set('port')}
          />
        </Field>
        {preset.httpTransport && (
          <Field label="Protocolo" hint="HTTPS exige un certificado de confianza para la API">
            <Select value={protocol} onChange={(e) => changeProtocol(e.target.value as Protocol)}>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </Select>
          </Field>
        )}
        <Field label="Ubicación">
          <Input value={form.location} onChange={set('location')} />
        </Field>
        {preset.credentials.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <Input
              type={field.secret ? 'password' : 'text'}
              required={field.required}
              // Credentials of a terminal, not of the person using the browser.
              autoComplete={field.secret ? 'new-password' : 'off'}
              value={credentials[field.key] ?? ''}
              onChange={(e) => setCredentials((c) => ({ ...c, [field.key]: e.target.value }))}
            />
          </Field>
        ))}
        <div className="flex items-end gap-2">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Registrar
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
        {preset.credentials.length > 0 && (
          <p className="text-xs text-ink-3 sm:col-span-2 lg:col-span-4">
            Las credenciales se guardan cifradas y no se vuelven a mostrar.
          </p>
        )}
        {create.error && (
          <p role="alert" className="text-sm text-critical sm:col-span-2 lg:col-span-4">
            {create.error.message}
          </p>
        )}
      </form>
    </Card>
  );
}
