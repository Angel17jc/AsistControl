import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceConnectionError,
  DeviceNotConnectedError,
  DeviceProtocolError,
  DeviceTimeoutError,
  UnsupportedDriverError,
} from '../errors';
import { AdapterRegistry } from '../registry';
import { MockDeviceAdapter } from './mock-device.adapter';
import { MockDeviceNetwork } from './mock-device-network';
import { type MockDeviceSimulator, localTimeToDate } from './mock-device-simulator';

const HOST = '192.168.1.201';
const PORT = 4370;
const DAY = '2026-09-21';
const UTC_MINUS_5 = -300;

describe('MockDeviceAdapter', () => {
  let network: MockDeviceNetwork;
  let device: MockDeviceSimulator;
  let adapter: MockDeviceAdapter;

  beforeEach(() => {
    network = new MockDeviceNetwork();
    device = network.attach(HOST, PORT, { seed: 7 });
    device.enrollUser({ deviceUserId: '1001', name: 'ANGEL CONFORME' });
    adapter = new MockDeviceAdapter({ host: HOST, port: PORT, timeoutMs: 200 }, network);
  });

  afterEach(() => device.stopAutoGeneration());

  it('connects and reports device info', async () => {
    await adapter.connect();
    const info = await adapter.getDeviceInfo();
    expect(adapter.isConnected()).toBe(true);
    expect(info.userCount).toBe(1);
    expect(info.manufacturer).toBe('AsistControl');
  });

  it('requires a connection before reading data', async () => {
    await expect(adapter.getUsers()).rejects.toBeInstanceOf(DeviceNotConnectedError);
  });

  it('fails to connect when nothing answers at the address', async () => {
    const ghost = new MockDeviceAdapter({ host: '10.0.0.99', port: PORT }, network);
    await expect(ghost.connect()).rejects.toBeInstanceOf(DeviceConnectionError);
    expect(await ghost.testConnection()).toBe(false);
  });

  it('testConnection never throws when the device is offline', async () => {
    device.setOnline(false);
    expect(await adapter.testConnection()).toBe(false);
    device.setOnline(true);
    expect(await adapter.testConnection()).toBe(true);
  });

  it('marks itself disconnected when the connection drops mid-session', async () => {
    await adapter.connect();
    device.dropConnectionAfter(1);
    await adapter.getDeviceInfo();
    await expect(adapter.getUsers()).rejects.toBeInstanceOf(DeviceConnectionError);
    expect(adapter.isConnected()).toBe(false);
    expect(device.isOnline()).toBe(false);
  });

  it('surfaces injected protocol errors as non-retryable', async () => {
    await adapter.connect();
    device.failNext('PROTOCOL');
    const error = await adapter.getUsers().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeviceProtocolError);
    expect((error as DeviceProtocolError).retryable).toBe(false);
    await expect(adapter.getUsers()).resolves.toHaveLength(1);
  });

  it('times out slow devices', async () => {
    await adapter.connect();
    device.latencyMs = 500;
    await expect(adapter.getDeviceInfo()).rejects.toBeInstanceOf(DeviceTimeoutError);
  });

  it('syncs incrementally using the returned cursor', async () => {
    await adapter.connect();
    device.generateWorkday('1001', {
      date: DAY,
      utcOffsetMinutes: UTC_MINUS_5,
      scenario: 'ON_TIME',
    });

    const first = await adapter.sync();
    expect(first.logs).toHaveLength(4);

    device.punch('1001');
    const second = await adapter.sync({ cursor: first.cursor });
    expect(second.logs).toHaveLength(1);
    expect((await adapter.sync({ cursor: second.cursor })).logs).toHaveLength(0);
  });

  it('does not miss records whose timestamp is older than the last one read (clock set back)', async () => {
    await adapter.connect();
    device.punch('1001', { at: new Date('2026-09-21T15:00:00Z') });
    const first = await adapter.sync();
    device.punch('1001', { at: new Date('2026-09-21T14:00:00Z') });
    const second = await adapter.sync({ cursor: first.cursor });
    expect(second.logs.map((l) => l.timestamp.toISOString())).toEqual(['2026-09-21T14:00:00.000Z']);
  });

  it('re-reads everything after the device memory is wiped', async () => {
    await adapter.connect();
    device.punch('1001');
    device.punch('1001');
    const first = await adapter.sync();
    device.clearLogs();
    device.punch('1001');
    device.punch('1001');
    device.punch('1001');
    expect((await adapter.sync({ cursor: first.cursor })).logs).toHaveLength(3);
  });

  it('rejects a malformed cursor', async () => {
    await adapter.connect();
    await expect(adapter.sync({ cursor: 'garbage' })).rejects.toBeInstanceOf(DeviceProtocolError);
  });

  it('can return duplicated records like faulty firmware does', async () => {
    await adapter.connect();
    device.punch('1001');
    device.duplicateOnRead = true;
    const { logs } = await adapter.sync();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toEqual(logs[1]);
  });

  it('pushes realtime punches only while connected', async () => {
    const listener = vi.fn();
    adapter.onAttendanceLog(listener);
    device.punch('1001');
    expect(listener).not.toHaveBeenCalled();

    await adapter.connect();
    device.punch('1001');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not push generated historical days in realtime', async () => {
    const listener = vi.fn();
    adapter.onAttendanceLog(listener);
    await adapter.connect();
    device.generateWorkday('1001', {
      date: DAY,
      utcOffsetMinutes: UTC_MINUS_5,
      scenario: 'ON_TIME',
    });
    expect(listener).not.toHaveBeenCalled();
    expect((await adapter.sync()).logs).toHaveLength(4);
  });

  it('keeps punches taken while offline and delivers them on the next sync', async () => {
    const listener = vi.fn();
    adapter.onAttendanceLog(listener);
    await adapter.connect();
    device.setOnline(false);
    device.punch('1001');
    expect(listener).not.toHaveBeenCalled();
    device.setOnline(true);
    expect((await adapter.sync()).logs).toHaveLength(1);
  });

  it('auto-generates punches for enrolled users', () => {
    vi.useFakeTimers();
    try {
      const listener = vi.fn();
      device.onLog(listener);
      device.startAutoGeneration(1_000);
      vi.advanceTimersByTime(3_500);
      expect(listener).toHaveBeenCalledTimes(3);
      device.stopAutoGeneration();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MockDeviceSimulator.generateWorkday', () => {
  const network = new MockDeviceNetwork();
  const device = network.attach('sim', 1, { seed: 1 });
  const opts = { date: DAY, utcOffsetMinutes: UTC_MINUS_5 } as const;
  const start = localTimeToDate(DAY, '08:00', UTC_MINUS_5);
  const end = localTimeToDate(DAY, '17:00', UTC_MINUS_5);

  it('produces entry, lunch and exit for an on-time day', () => {
    const logs = device.generateWorkday('1', { ...opts, scenario: 'ON_TIME' });
    expect(logs.map((l) => l.punchType)).toEqual([
      'CHECK_IN',
      'BREAK_OUT',
      'BREAK_IN',
      'CHECK_OUT',
    ]);
    expect(logs[0]!.timestamp.getTime()).toBeLessThanOrEqual(start.getTime());
  });

  it('produces a late entry', () => {
    const [entry] = device.generateWorkday('2', { ...opts, scenario: 'LATE' });
    expect(entry!.timestamp.getTime() - start.getTime()).toBeGreaterThanOrEqual(12 * 60_000);
  });

  it('produces an exit after the shift for overtime', () => {
    const logs = device.generateWorkday('3', { ...opts, scenario: 'OVERTIME' });
    expect(logs.at(-1)!.timestamp.getTime() - end.getTime()).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it('omits the exit when the employee forgets to punch out', () => {
    const logs = device.generateWorkday('4', { ...opts, scenario: 'MISSING_EXIT' });
    expect(logs.map((l) => l.punchType)).not.toContain('CHECK_OUT');
  });

  it('adds a near-duplicate punch seconds apart', () => {
    const [a, b] = device.generateWorkday('5', { ...opts, scenario: 'DUPLICATE_PUNCH' });
    expect(b!.timestamp.getTime() - a!.timestamp.getTime()).toBe(4_000);
  });

  it('follows a night-shift template that crosses midnight', () => {
    const logs = device.generateWorkday('7', {
      ...opts,
      scenario: 'ON_TIME',
      template: { start: '22:00', end: '06:00', breakStart: null, breakEnd: null },
    });
    expect(logs).toHaveLength(2);
    const exit = logs[1]!.timestamp.getTime();
    expect(exit).toBeGreaterThanOrEqual(
      localTimeToDate('2026-09-22', '06:00', UTC_MINUS_5).getTime(),
    );
  });

  it('produces nothing for an absence', () => {
    expect(device.generateWorkday('6', { ...opts, scenario: 'ABSENT' })).toEqual([]);
  });
});

describe('localTimeToDate', () => {
  it('converts local time at a fixed offset to UTC', () => {
    expect(localTimeToDate('2026-09-21', '08:02', -300).toISOString()).toBe(
      '2026-09-21T13:02:00.000Z',
    );
  });
});

describe('AdapterRegistry', () => {
  it('creates adapters by driver key', () => {
    const network = new MockDeviceNetwork();
    const registry = new AdapterRegistry().register(
      'MOCK',
      (c) => new MockDeviceAdapter(c, network),
    );
    expect(registry.create('MOCK', { host: 'x', port: 1 }).driver).toBe('MOCK');
    expect(registry.drivers()).toEqual(['MOCK']);
  });

  it('rejects unknown drivers and double registration', () => {
    const registry = new AdapterRegistry();
    expect(() => registry.create('ZKTECO', { host: 'x', port: 1 })).toThrow(UnsupportedDriverError);
    registry.register('MOCK', () => ({}) as never);
    expect(() => registry.register('MOCK', () => ({}) as never)).toThrow(/already registered/);
  });
});
