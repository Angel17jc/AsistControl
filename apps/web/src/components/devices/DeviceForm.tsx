import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api';
import { driverPreset } from '../../lib/device-drivers';
import type { DeviceRow } from '../../lib/types';
import { Button, Field, Input, Select } from '../ui';

type Protocol = 'http' | 'https';

/**
 * Registers a terminal, or edits one when `device` is given. Choosing a driver fills in its
 * usual manufacturer, model and port and asks for the credentials it needs; credentials are
 * sent only when typed, stored encrypted by the API and never shown again.
 */
export function DeviceForm({ device, onDone }: { device?: DeviceRow; onDone: () => void }) {
  const editing = device !== undefined;
  const queryClient = useQueryClient();
  const drivers = useQuery({
    queryKey: ['devices', 'drivers'],
    queryFn: () => api<string[]>('/devices/drivers'),
  });
  const initial = driverPreset(device?.driver ?? 'MOCK');
  const [form, setForm] = useState({
    name: device?.name ?? '',
    driver: (device?.driver ?? 'MOCK') as string,
    manufacturer: device?.manufacturer ?? initial.manufacturer,
    model: device?.model ?? initial.model,
    host: device?.host ?? '192.168.1.210',
    port: String(device?.port ?? initial.port),
    location: device?.location ?? '',
  });
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [removeCredentials, setRemoveCredentials] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>(
    device?.config?.protocol === 'https' ? 'https' : 'http',
  );
  const [enabled, setEnabled] = useState(device?.status !== 'DISABLED');
  const preset = driverPreset(form.driver);

  const sameDriver = editing && form.driver === device.driver;
  /** Stored credentials still apply while the driver stays the same. */
  const keepsStored = sameDriver && device.hasCredentials && !removeCredentials;
  // The API replaces credentials as a whole: typing one means typing all the driver needs,
  // or a new password alone would silently drop the stored user.
  const replacing = Object.values(credentials).some((value) => value.trim() !== '');
  const otherTerminal =
    editing &&
    (form.driver !== device.driver ||
      form.host !== device.host ||
      Number(form.port) !== device.port);

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
    setRemoveCredentials(false);
    setProtocol('http');
  }

  function changeProtocol(next: Protocol) {
    setProtocol(next);
    // Follow the standard port unless the user typed a custom one.
    setForm((f) =>
      ['80', '443'].includes(f.port) ? { ...f, port: next === 'https' ? '443' : '80' } : f,
    );
  }

  const save = useMutation({
    mutationFn: () => {
      const filled = Object.fromEntries(
        Object.entries(credentials).filter(([, value]) => value.trim() !== ''),
      );
      const typed = Object.keys(filled).length > 0 ? filled : undefined;
      const body = {
        ...form,
        port: Number(form.port),
        ...(preset.httpTransport && { config: { protocol } }),
      };
      if (!editing) {
        return api('/devices', {
          method: 'POST',
          body: {
            ...body,
            location: form.location || undefined,
            config: { realtime: true, ...body.config },
            credentials: typed,
          },
        });
      }
      return api(`/devices/${device.id}`, {
        method: 'PATCH',
        body: {
          ...body,
          location: form.location || null,
          enabled,
          // Omitted = keep the stored ones; null = remove them.
          credentials: removeCredentials ? null : typed,
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
    save.mutate();
  }

  const wide = !editing;
  const fullRow = wide ? 'sm:col-span-2 lg:col-span-4' : 'sm:col-span-2';

  return (
    <form
      onSubmit={submit}
      aria-label={editing ? `Editar ${device.name}` : 'Registrar dispositivo'}
      className={clsx('grid gap-4 p-5 sm:grid-cols-2', wide && 'lg:grid-cols-4')}
    >
      <Field label="Nombre">
        <Input required value={form.name} onChange={set('name')} placeholder="Entrada planta 2" />
      </Field>
      <Field label="Driver">
        <Select value={form.driver} onChange={(e) => changeDriver(e.target.value)}>
          {(drivers.data ?? [form.driver]).map((d) => (
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
        <Field
          key={field.key}
          label={field.label}
          hint={keepsStored && !replacing ? 'Guardada. Déjela vacía para conservarla' : field.hint}
        >
          <Input
            type={field.secret ? 'password' : 'text'}
            required={field.required && (!keepsStored || replacing) && !removeCredentials}
            disabled={removeCredentials}
            // Credentials of a terminal, not of the person using the browser.
            autoComplete={field.secret ? 'new-password' : 'off'}
            value={credentials[field.key] ?? ''}
            onChange={(e) => setCredentials((c) => ({ ...c, [field.key]: e.target.value }))}
          />
        </Field>
      ))}

      {editing && (
        <div className={clsx('space-y-2 text-sm', fullRow)}>
          <Checkbox checked={enabled} onChange={setEnabled}>
            Activo: se sincroniza y recibe marcaciones
          </Checkbox>
          {sameDriver &&
            device.hasCredentials &&
            !preset.credentials.some((field) => field.required) && (
              <Checkbox checked={removeCredentials} onChange={setRemoveCredentials}>
                Quitar las credenciales guardadas
              </Checkbox>
            )}
          {otherTerminal && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-ink-1">
              Cambia el equipo al que se conecta: la próxima sincronización leerá su memoria
              completa (sin duplicar marcaciones)
              {form.driver !== device.driver && ' y se descartarán las credenciales anteriores'}.
            </p>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {editing ? 'Guardar cambios' : 'Registrar'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      {preset.credentials.length > 0 && (
        <p className={clsx('text-xs text-ink-3', fullRow)}>
          Las credenciales se guardan cifradas y no se vuelven a mostrar.
        </p>
      )}
      {save.error && (
        <p role="alert" className={clsx('text-sm text-critical', fullRow)}>
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: string;
}) {
  return (
    <label className="flex items-center gap-2 text-ink-2">
      <input
        type="checkbox"
        className="size-4 accent-[var(--accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
