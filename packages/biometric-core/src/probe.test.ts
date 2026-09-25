import { afterEach, describe, expect, it } from 'vitest';
import type { BiometricDeviceAdapter } from './adapter';
import { DeviceTimeoutError } from './errors';
import { FakeHikvisionDevice } from './hikvision/fake-device';
import { HikvisionAdapter } from './hikvision/hikvision.adapter';
import { ACS_MINOR } from './hikvision/isapi';
import { formatProbeReport, probeDevice } from './probe';
import { FakeZkDevice } from './zkteco/fake-device';
import { ZKTecoAdapter } from './zkteco/zkteco.adapter';

const TZ = 'America/Guayaquil';
const DEVICE_NOW = '2026-09-21T18:00:00-05:00';
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function hikvision(
  options: ConstructorParameters<typeof FakeHikvisionDevice>[0] = {},
  password = 'Hik12345!',
) {
  const device = new FakeHikvisionDevice({
    deviceTime: DEVICE_NOW,
    users: [{ employeeNo: '1001', name: 'Ana' }],
    events: [
      { serialNo: 1, employeeNo: '1001', time: '2026-09-21T08:02:00-05:00' },
      {
        serialNo: 2,
        employeeNo: '1001',
        time: '2026-09-21T17:05:00-05:00',
        minor: ACS_MINOR.FINGERPRINT_PASSED,
        attendanceStatus: 'checkOut',
      },
    ],
    ...options,
  });
  const port = await device.listen();
  closers.push(() => device.close());
  const adapter = new HikvisionAdapter({
    host: '127.0.0.1',
    port,
    timeoutMs: 1_000,
    credentials: { username: 'admin', password },
    options: { timezone: TZ },
  });
  return { device, adapter };
}

const at = (iso: string) => () => new Date(iso);
const statuses = (report: Awaited<ReturnType<typeof probeDevice>>) =>
  Object.fromEntries(report.steps.map((s) => [s.id, s.status]));

describe('probeDevice', () => {
  it('walks a healthy terminal through every step', async () => {
    const { adapter } = await hikvision();
    const report = await probeDevice(adapter, { now: at('2026-09-21T18:00:30-05:00') });

    expect(report.outcome).toBe('ok');
    expect(statuses(report)).toEqual({
      connect: 'ok',
      identity: 'ok',
      clock: 'ok',
      users: 'ok',
      download: 'ok',
      incremental: 'ok',
    });
    expect(report.steps.find((s) => s.id === 'identity')!.detail).toContain('DS-K1T671M');
    expect(report.punches).toMatchObject({
      total: 2,
      byPunchType: { CHECK_IN: 1, CHECK_OUT: 1 },
      byVerifyMode: { FACE: 1, FINGERPRINT: 1 },
      first: '2026-09-21T13:02:00.000Z',
      last: '2026-09-21T22:05:00.000Z',
    });
    expect(adapter.isConnected()).toBe(false);
  });

  it('warns about a clock that drifted', async () => {
    const { adapter } = await hikvision();
    const report = await probeDevice(adapter, { now: at('2026-09-21T18:03:12-05:00') });
    const clock = report.steps.find((s) => s.id === 'clock')!;
    expect(clock).toMatchObject({
      status: 'warn',
      detail: 'El equipo va 3 min 12 s atrasado respecto del servidor',
    });
    expect(report.outcome).toBe('warn');
  });

  it('flags punches in the future: a wrong clock or time zone', async () => {
    // The server thinks it is 16:00: the 17:05 punch is an hour ahead of it.
    const { adapter } = await hikvision();
    const report = await probeDevice(adapter, { now: at('2026-09-21T16:00:00-05:00') });
    expect(report.steps.find((s) => s.id === 'download')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('1 con hora futura'),
    });
  });

  it('tries wrong credentials once and stops there', async () => {
    const { device, adapter } = await hikvision({}, 'wrong');
    const report = await probeDevice(adapter, { now: at(DEVICE_NOW) });

    expect(report.outcome).toBe('fail');
    expect(report.steps[0]).toMatchObject({
      id: 'connect',
      status: 'fail',
      detail: expect.stringContaining('AUTHENTICATION_FAILED'),
    });
    expect(report.steps.slice(1).every((s) => s.status === 'skipped')).toBe(true);
    // One challenge and one rejected answer: no retry that could lock the account.
    expect(device.requests.filter((r) => r.authorized === false).length).toBeLessThanOrEqual(2);
  });

  it('reports an unreachable terminal without throwing', async () => {
    const adapter = new ZKTecoAdapter({ host: '127.0.0.1', port: 1, timeoutMs: 500 });
    const report = await probeDevice(adapter);
    expect(report.steps[0]).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('CONNECTION_FAILED'),
    });
  });

  it('checks a ZKTeco terminal too, warning about punches it cannot classify', async () => {
    const device = new FakeZkDevice({
      users: [{ uid: 1, userId: '1001', name: 'Ana' }],
      records: [
        {
          userId: '1001',
          punch: 0,
          time: { year: 2026, month: 9, day: 21, hour: 8, minute: 2, second: 0 },
        },
        {
          userId: '1001',
          punch: 9,
          time: { year: 2026, month: 9, day: 21, hour: 17, minute: 5, second: 0 },
        },
      ],
    });
    const port = await device.listen();
    closers.push(() => device.close());
    const adapter = new ZKTecoAdapter({
      host: '127.0.0.1',
      port,
      timeoutMs: 1_000,
      options: { timezone: TZ },
    });

    const report = await probeDevice(adapter, {
      now: at('2026-09-21T18:00:00-05:00'),
      maxDriftSeconds: 1e12,
    });
    expect(statuses(report)).toMatchObject({
      connect: 'ok',
      users: 'ok',
      download: 'warn',
      incremental: 'ok',
    });
    expect(report.steps.find((s) => s.id === 'download')!.detail).toContain(
      '1 sin tipo de marcación reconocido',
    );
  });

  it('keeps going when one step fails, and closes the session', async () => {
    let disconnected = false;
    const flaky: BiometricDeviceAdapter = {
      driver: 'FLAKY',
      capabilities: { realtime: false, users: false },
      connect: async () => undefined,
      disconnect: async () => {
        disconnected = true;
      },
      isConnected: () => true,
      testConnection: async () => true,
      getDeviceInfo: async () => {
        throw new DeviceTimeoutError();
      },
      getUsers: async () => [],
      getAttendanceLogs: async () => [],
      sync: async () => ({ logs: [], fetchedAt: new Date(), cursor: null }),
    };
    const report = await probeDevice(flaky);
    expect(statuses(report)).toEqual({
      connect: 'ok',
      identity: 'fail',
      clock: 'skipped',
      users: 'skipped',
      download: 'warn',
      incremental: 'ok',
    });
    expect(disconnected).toBe(true);
  });
});

describe('formatProbeReport', () => {
  it('prints one line per step and the verdict', async () => {
    const { adapter } = await hikvision();
    const report = await probeDevice(adapter, { now: at('2026-09-21T18:00:30-05:00') });
    const text = formatProbeReport(report, '127.0.0.1:80');

    expect(text.split('\n')[0]).toBe('Diagnóstico HIKVISION 127.0.0.1:80');
    expect(text).toMatch(/^\[OK\] {4}Conexión {14}Conectado y autenticado \(\d+ ms\)$/m);
    expect(text).toContain('Marcaciones por tipo:   CHECK_IN 1, CHECK_OUT 1');
    expect(text.trimEnd().split('\n').at(-1)).toBe('Resultado: todo correcto');
  });
});
