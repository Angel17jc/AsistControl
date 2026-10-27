import { afterEach, describe, expect, it } from 'vitest';
import {
  DeviceAuthenticationError,
  DeviceConnectionError,
  DeviceProtocolError,
  DeviceTimeoutError,
} from '../errors';
import { FakeHikvisionDevice, type FakeHikEvent, type FakeHikvisionOptions } from './fake-device';
import { HikvisionAdapter, type HikvisionOptions } from './hikvision.adapter';
import { ACS_MINOR } from './isapi';

const TZ = 'America/Guayaquil';
const DEVICE_NOW = '2026-09-21T18:00:00-05:00';

const EVENTS: FakeHikEvent[] = [
  { serialNo: 101, employeeNo: '1001', time: '2026-09-21T08:02:00-05:00' },
  {
    serialNo: 102,
    employeeNo: '1002',
    time: '2026-09-21T08:30:00-05:00',
    minor: ACS_MINOR.FINGERPRINT_PASSED,
  },
  {
    serialNo: 103,
    employeeNo: '1001',
    time: '2026-09-21T17:05:00-05:00',
    minor: ACS_MINOR.CARD_PASSED,
    attendanceStatus: 'checkOut',
  },
];

let device: FakeHikvisionDevice;
let adapter: HikvisionAdapter;

async function start(
  options: FakeHikvisionOptions = {},
  config: {
    credentials?: Record<string, string>;
    options?: HikvisionOptions;
    timeoutMs?: number;
  } = {},
) {
  device = new FakeHikvisionDevice({ events: EVENTS, deviceTime: DEVICE_NOW, ...options });
  const port = await device.listen();
  adapter = new HikvisionAdapter({
    host: '127.0.0.1',
    port,
    timeoutMs: config.timeoutMs ?? 1_000,
    credentials: config.credentials ?? { username: 'admin', password: 'Hik12345!' },
    options: { timezone: TZ, ...config.options },
  });
  return adapter;
}

function addEvent(event: FakeHikEvent) {
  device.options.events = [...device.options.events!, event];
}

afterEach(async () => {
  await adapter?.disconnect();
  await device?.close();
});

describe('HikvisionAdapter', () => {
  describe('connection and authentication', () => {
    it('authenticates with Digest and reads the terminal identity', async () => {
      await (await start()).connect();
      const info = await adapter.getDeviceInfo();

      expect(info).toMatchObject({
        manufacturer: 'Hikvision',
        model: 'DS-K1T671M',
        serialNumber: 'DS-K1T671M20260101V030230ENF00000001',
        firmwareVersion: 'V3.2.30 build 260101',
        logCount: 3,
        userCount: 0,
      });
      expect(info.deviceTime.toISOString()).toBe('2026-09-21T23:00:00.000Z');
      // Only the very first request goes out without credentials.
      expect(device.requests.filter((r) => !r.authorized)).toHaveLength(1);
    });

    it('prefers SHA-256 when the terminal supports it', async () => {
      await (await start({ algorithm: 'SHA-256' })).connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it('fails once on a wrong password instead of locking the account', async () => {
      await start({}, { credentials: { username: 'admin', password: 'wrong' } });
      const error = await adapter.connect().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DeviceAuthenticationError);
      expect((error as DeviceAuthenticationError).retryable).toBe(false);
      // Challenge + a single attempt: terminals lock the user after a few failures.
      expect(device.requests).toHaveLength(2);
      expect(await adapter.testConnection()).toBe(false);
    });

    it('does not start without credentials', async () => {
      await start({}, { credentials: {} });
      await expect(adapter.connect()).rejects.toBeInstanceOf(DeviceAuthenticationError);
      expect(device.requests).toHaveLength(0);
    });

    it('refuses to send the password in clear text to a Basic-only terminal', async () => {
      await start({ basicOnly: true });
      await expect(adapter.connect()).rejects.toThrow(/clear text/);
    });

    it('renews an expired nonce transparently', async () => {
      await (await start()).connect();
      device.expireNonce();
      await expect(adapter.getDeviceInfo()).resolves.toMatchObject({ model: 'DS-K1T671M' });
    });

    it('reports an unreachable terminal as a retryable connection error', async () => {
      await start();
      await device.close();
      const error = await adapter.connect().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DeviceConnectionError);
      expect((error as DeviceConnectionError).retryable).toBe(true);
      expect(await adapter.testConnection()).toBe(false);
    });

    it('times out instead of hanging the sync pipeline', async () => {
      await start({ delayMs: 500 }, { timeoutMs: 150 });
      await expect(adapter.connect()).rejects.toBeInstanceOf(DeviceTimeoutError);
    });

    it('reads counts as 0 on firmware without the count endpoints', async () => {
      await (await start({ supportsCounts: false })).connect();
      expect(await adapter.getDeviceInfo()).toMatchObject({ userCount: 0, logCount: 0 });
    });

    it('surfaces the ISAPI error of a failed request', async () => {
      await (
        await start({
          failures: {
            '/ISAPI/AccessControl/AcsEvent': {
              status: 400,
              body: JSON.stringify({
                statusCode: 6,
                statusString: 'Invalid Content',
                subStatusCode: 'badParameters',
              }),
            },
          },
        })
      ).connect();
      const error = await adapter.sync().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DeviceProtocolError);
      expect((error as Error).message).toMatch(/HTTP 400: Invalid Content · badParameters/);
    });
  });

  describe('reading data', () => {
    it('pages through the enrolled users', async () => {
      const users = Array.from({ length: 5 }, (_, i) => ({
        employeeNo: String(1001 + i),
        name: `Empleado ${i + 1}`,
        admin: i === 0,
      }));
      await (await start({ users, maxResults: 2 })).connect();

      const read = await adapter.getUsers();
      expect(read.map((u) => u.deviceUserId)).toEqual(['1001', '1002', '1003', '1004', '1005']);
      expect(read[0]).toMatchObject({ name: 'Empleado 1', privilege: 'ADMIN' });
      expect(read[1]?.privilege).toBe('USER');
    });

    it('maps punches: instant, attendance key and identification method', async () => {
      await (await start()).connect();
      const { logs } = await adapter.sync();

      expect(
        logs.map((l) => [l.deviceUserId, l.timestamp.toISOString(), l.punchType, l.verifyMode]),
      ).toEqual([
        ['1001', '2026-09-21T13:02:00.000Z', 'CHECK_IN', 'FACE'],
        ['1002', '2026-09-21T13:30:00.000Z', 'CHECK_IN', 'FINGERPRINT'],
        ['1001', '2026-09-21T22:05:00.000Z', 'CHECK_OUT', 'CARD'],
      ]);
      expect(logs[0]?.raw).toMatchObject({ serialNo: 101, minor: ACS_MINOR.FACE_PASSED });
    });

    it('reads wall-clock times in the terminal timezone when the firmware omits the offset', async () => {
      await (
        await start({
          events: [{ serialNo: 1, employeeNo: '1001', time: '2026-09-21T08:02:00' }],
          deviceTime: '2026-09-21T18:00:00',
        })
      ).connect();
      const { logs } = await adapter.sync();
      expect(logs[0]?.timestamp.toISOString()).toBe('2026-09-21T13:02:00.000Z');
    });

    it('pages through long event lists', async () => {
      const many = Array.from({ length: 75 }, (_, i) => ({
        serialNo: i + 1,
        employeeNo: '1001',
        time: `2026-09-21T${String(6 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00-05:00`,
      }));
      await (await start({ events: many, maxResults: 30 })).connect();
      const { logs } = await adapter.sync({ cursor: null });
      expect(logs).toHaveLength(75);
    });

    describe('on a small terminal with strict search limits (DS-K1A-like)', () => {
      const STRICT = { maxSearchIdLength: 20, maxResults: 10 };
      const many = Array.from({ length: 25 }, (_, i) => ({
        serialNo: i + 1,
        employeeNo: '1001',
        time: `2026-09-21T08:${String(i).padStart(2, '0')}:00-05:00`,
      }));
      const searches = () =>
        device.requests
          .filter((r) => r.path.endsWith('/AcsEvent') || r.path.endsWith('/UserInfo/Search'))
          .map(
            (r) =>
              Object.values(r.body as Record<string, { searchID: string; maxResults: number }>)[0]!,
          );

      it('keeps every searchID within 20 characters', async () => {
        await (await start({ strictSearch: STRICT, events: many })).connect();
        await adapter.sync();
        await adapter.getUsers();
        expect(searches().length).toBeGreaterThan(0);
        expect(searches().every((s) => s.searchID.length <= 20)).toBe(true);
      });

      it('steps down to pages of 10 when the terminal rejects 30, and reads everything', async () => {
        await (await start({ strictSearch: STRICT, events: many })).connect();
        const { logs } = await adapter.sync();
        expect(logs).toHaveLength(25);
        // One search per punch kind (face, fingerprint, card); the 25 punches are all faces.
        // Face: 30 rejected, then 10 + 10 + 5. Fingerprint and card: one page of 10 each.
        expect(searches().map((s) => s.maxResults)).toEqual([30, 10, 10, 10, 10, 10]);
        expect(await adapter.getUsers()).toEqual([]);
        expect(searches().at(-1)!.maxResults).toBe(10);
      });

      it('keeps pages of 30 on a terminal that accepts them', async () => {
        await (await start({ events: many })).connect();
        await adapter.sync();
        expect(new Set(searches().map((s) => s.maxResults))).toEqual(new Set([30]));
      });

      it('does not loop on a search the terminal rejects for another reason', async () => {
        const rejected = {
          status: 400,
          body: '{"statusCode":6,"statusString":"Invalid Content","subStatusCode":"badParameters"}',
        };
        await (await start({ failures: { '/ISAPI/AccessControl/AcsEvent': rejected } })).connect();
        await expect(adapter.sync()).rejects.toThrow('badParameters');
        // The first try at 30, one retry at 10, and no more.
        expect(device.requests.filter((r) => r.path.endsWith('/AcsEvent'))).toHaveLength(2);
      });
    });

    it('counts every kind of event the terminal keeps, and which ones are punches', async () => {
      await (
        await start({
          events: [
            ...EVENTS,
            { serialNo: 104, employeeNo: '1003', time: '2026-09-21T09:00:00-05:00', minor: 0x99 },
          ],
        })
      ).connect();
      const kinds = await adapter.describeEventKinds(
        new Date('2026-09-21T00:00:00-05:00'),
        new Date('2026-09-21T23:59:00-05:00'),
      );
      expect(kinds).toEqual([
        { code: '0x4b', description: 'rostro válido', count: 1, counted: true },
        { code: '0x26', description: 'huella válida', count: 1, counted: true },
        { code: '0x99', description: null, count: 1, counted: false },
        { code: '0x01', description: 'tarjeta válida', count: 1, counted: true },
      ]);
    });

    it('only reads the minors configured as punches', async () => {
      await (await start({}, { options: { eventMinors: [ACS_MINOR.CARD_PASSED] } })).connect();
      const { logs } = await adapter.sync();
      expect(logs.map((l) => l.verifyMode)).toEqual(['CARD']);
    });

    it('filters logs by range', async () => {
      await (await start()).connect();
      const logs = await adapter.getAttendanceLogs(
        new Date('2026-09-21T13:00:00Z'),
        new Date('2026-09-21T14:00:00Z'),
      );
      expect(logs.map((l) => l.deviceUserId)).toEqual(['1001', '1002']);
    });
  });

  describe('incremental sync', () => {
    it('downloads only what is new after the first sync', async () => {
      await (await start()).connect();
      const first = await adapter.sync();
      expect(first.logs).toHaveLength(3);
      expect(first.cursor).toBe(`hik1:103:${Date.parse('2026-09-21T22:05:00Z')}`);

      expect((await adapter.sync({ cursor: first.cursor })).logs).toHaveLength(0);

      addEvent({ serialNo: 104, employeeNo: '1002', time: '2026-09-21T17:40:00-05:00' });
      const third = await adapter.sync({ cursor: first.cursor });
      expect(third.logs.map((l) => l.deviceUserId)).toEqual(['1002']);
      expect(third.cursor).toMatch(/^hik1:104:/);
    });

    it('does not re-read the whole memory on every sync', async () => {
      await (await start()).connect();
      const { cursor } = await adapter.sync();
      device.requests.length = 0;
      await adapter.sync({ cursor });

      const searches = device.requests.filter((r) => r.path === '/ISAPI/AccessControl/AcsEvent');
      const start_ = (searches[0]?.body as { AcsEventCond: { startTime: string } }).AcsEventCond
        .startTime;
      // One hour of overlap before the newest event downloaded (17:05).
      expect(start_).toBe('2026-09-21T16:05:00-05:00');
    });

    it('does not lose punches when the memory is cleared and the counter restarts', async () => {
      await (await start()).connect();
      const { cursor } = await adapter.sync();

      device.options.events = [
        { serialNo: 1, employeeNo: '1003', time: '2026-09-21T17:30:00-05:00' },
      ];
      const after = await adapter.sync({ cursor });
      expect(after.logs.map((l) => l.deviceUserId)).toEqual(['1003']);
      expect(after.cursor).toMatch(/^hik1:1:/);
    });

    it('still finds punches when the terminal clock went back', async () => {
      await (await start()).connect();
      const { cursor } = await adapter.sync();

      // Someone sets the clock a day back; the next punches carry yesterday's date.
      device.options.deviceTime = '2026-09-20T18:10:00-05:00';
      addEvent({ serialNo: 104, employeeNo: '1002', time: '2026-09-20T18:05:00-05:00' });
      const after = await adapter.sync({ cursor });
      expect(after.logs.map((l) => l.deviceUserId)).toEqual(['1002']);
    });

    it('lets the platform deduplicate when the firmware does not number events', async () => {
      const unnumbered = EVENTS.map(({ serialNo: _serial, ...event }) => event);
      await (await start({ events: unnumbered })).connect();
      const { cursor } = await adapter.sync();
      // Without serial numbers the overlap window is returned again; ingestion drops repeats.
      expect((await adapter.sync({ cursor })).logs).toHaveLength(1);
    });

    it('starts over when handed a cursor it does not recognise', async () => {
      await (await start()).connect();
      expect((await adapter.sync({ cursor: '12:abcdef' })).logs).toHaveLength(3);
    });
  });
});
