import { type APIRequestContext, type Locator, type Page, expect } from '@playwright/test';

/** Demo accounts created by the seed (apps/api/prisma/seed.ts). */
export const USERS = {
  admin: { email: 'admin@asistcontrol.local', role: 'Super administrador' },
  hr: { email: 'rrhh@asistcontrol.local', role: 'Talento humano' },
  supervisor: { email: 'supervisor@asistcontrol.local', role: 'Supervisor' },
  employee: { email: 'angel@asistcontrol.local', role: 'Empleado' },
} as const;

export const PASSWORD = 'AsistControl2026';

/** Signs in through the form, like a person would, and waits for the app shell to be up. */
export async function signIn(page: Page, user: { email: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(user.email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
}

/**
 * Cards render as a <section> titled by their heading. Scoping to one of them keeps the
 * assertions unambiguous on pages that show the same controls for several devices.
 */
export function card(page: Page, title: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title }) });
}

/**
 * Talks to the API through the same origin the browser uses. It only arranges state that is
 * not what a test asserts (registering a terminal, generating punches); assertions always
 * go through the interface.
 */
export class ApiClient {
  private token = '';

  private constructor(private readonly request: APIRequestContext) {}

  static async signIn(request: APIRequestContext, email: string): Promise<ApiClient> {
    const client = new ApiClient(request);
    const session = await client.send<{ accessToken: string }>('post', '/auth/login', {
      email,
      password: PASSWORD,
    });
    client.token = session.accessToken;
    return client;
  }

  private async send<T>(method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
    const res = await this.request[method](`/api${path}`, {
      ...(this.token ? { headers: { Authorization: `Bearer ${this.token}` } } : {}),
      ...(data === undefined ? {} : { data }),
    });
    if (!res.ok()) {
      throw new Error(`${method.toUpperCase()} /api${path} → ${res.status()}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Registers a MOCK terminal of its own. Punches are deduplicated per device, so a test
   * that owns its terminal always ingests new events, whatever earlier runs left behind.
   */
  async createMockDevice(label: string): Promise<{ id: string; name: string }> {
    const name = `${label} ${Date.now().toString().slice(-6)}`;
    // The simulated terminal is identified by host:port, so each device needs its own host.
    const byte = () => Math.floor(Math.random() * 254) + 1;
    const host = `10.${byte()}.${byte()}.${byte()}`;
    const device = await this.send<{ id: string }>('post', '/devices', {
      name,
      driver: 'MOCK',
      manufacturer: 'AsistControl',
      model: 'AC-SIM-100',
      host,
      port: 4370,
      location: 'Pruebas automatizadas',
      config: { realtime: true },
    });
    return { id: device.id, name };
  }

  autoPunches(deviceId: string, intervalMs: number): Promise<unknown> {
    return this.send('post', `/devices/${deviceId}/simulate/auto`, { intervalMs });
  }

  /** A punch registered by hand, the way an operator corrects a missing one. */
  async manualPunch(): Promise<void> {
    const employees = await this.send<{ data: { id: string }[] }>('get', '/employees?pageSize=1');
    const employeeId = employees.data[0]?.id;
    if (!employeeId) throw new Error('The seed left no employees to punch for');
    await this.send('post', '/attendance/events', {
      employeeId,
      occurredAt: new Date().toISOString(),
      punchType: 'CHECK_IN',
      reason: 'Marcación creada por los tests de navegador',
    });
  }
}
