import { afterEach, describe, expect, it } from 'vitest';
import {
  DeviceAuthenticationError,
  DeviceConnectionError,
  DeviceNotConnectedError,
  DeviceProtocolError,
  DeviceTimeoutError,
} from '../errors';
import { FakeZkDevice, type FakeDeviceOptions } from './fake-device';
import { ZK_COMMAND } from './protocol';
import { ZKTecoAdapter } from './zkteco.adapter';

const TZ = 'America/Guayaquil';

const RECORDS = [
  {
    uid: 1,
    userId: '1001',
    status: 1,
    punch: 0,
    time: { year: 2026, month: 9, day: 21, hour: 8, minute: 2, second: 0 },
  },
  {
    uid: 1,
    userId: '1001',
    status: 15,
    punch: 1,
    time: { year: 2026, month: 9, day: 21, hour: 17, minute: 5, second: 0 },
  },
  {
    uid: 2,
    userId: '1002',
    status: 2,
    punch: 9,
    time: { year: 2026, month: 9, day: 21, hour: 8, minute: 30, second: 0 },
  },
];

let device: FakeZkDevice;
let adapter: ZKTecoAdapter;

async function start(options: FakeDeviceOptions = {}, credentials?: Record<string, string>) {
  device = new FakeZkDevice({ records: RECORDS, ...options });
  const port = await device.listen();
  adapter = new ZKTecoAdapter({
    host: '127.0.0.1',
    port,
    timeoutMs: 1_000,
    credentials,
    options: { timezone: TZ },
  });
  return adapter;
}

afterEach(async () => {
  await adapter?.disconnect().catch(() => undefined);
  await device?.close();
});

describe('ZKTecoAdapter', () => {
  it('connects and reads device information', async () => {
    await (await start()).connect();
    const info = await adapter.getDeviceInfo();
    expect(info).toMatchObject({
      manufacturer: 'ZKTeco',
      serialNumber: '6040154200001',
      model: 'K40',
      logCount: 3,
    });
    // 10:30 on the device (UTC-5) is 15:30 UTC.
    expect(info.deviceTime.toISOString()).toBe('2026-09-21T15:30:00.000Z');
  });

  it('refuses to read before connecting', async () => {
    await start();
    await expect(adapter.getUsers()).rejects.toBeInstanceOf(DeviceNotConnectedError);
  });

  it('fails with a connection error when nothing listens', async () => {
    const orphan = new ZKTecoAdapter({ host: '127.0.0.1', port: 1, timeoutMs: 500 });
    await expect(orphan.connect()).rejects.toBeInstanceOf(DeviceConnectionError);
    expect(await orphan.testConnection()).toBe(false);
  });

  it('authenticates with the communication key', async () => {
    await start({ commKey: 123456 }, { commKey: '123456' });
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it('reports an authentication error when the device demands a key and none is configured', async () => {
    await start({ commKey: 123456 });
    await expect(adapter.connect()).rejects.toBeInstanceOf(DeviceAuthenticationError);
    expect(adapter.isConnected()).toBe(false);
  });

  it('converts punches to platform types in the device timezone', async () => {
    await (await start()).connect();
    const logs = await adapter.getAttendanceLogs(
      new Date('2026-09-21T00:00:00Z'),
      new Date('2026-09-22T00:00:00Z'),
    );
    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatchObject({
      deviceUserId: '1001',
      punchType: 'CHECK_IN',
      verifyMode: 'FINGERPRINT',
    });
    expect(logs[0]!.timestamp.toISOString()).toBe('2026-09-21T13:02:00.000Z');
    expect(logs[1]).toMatchObject({ punchType: 'CHECK_OUT', verifyMode: 'FACE' });
    // Unknown key on the terminal must not be guessed.
    expect(logs[2]).toMatchObject({ punchType: 'UNKNOWN', verifyMode: 'CARD' });
  });

  it('filters by the requested range', async () => {
    await (await start()).connect();
    const logs = await adapter.getAttendanceLogs(
      new Date('2026-09-21T14:00:00Z'),
      new Date('2026-09-21T23:00:00Z'),
    );
    expect(logs.map((l) => l.deviceUserId)).toEqual(['1001']);
  });

  it('reassembles bulk reads split across TCP chunks', async () => {
    await (await start({ chunkSize: 17 })).connect();
    expect(await adapter.getAttendanceLogs(new Date(0), new Date('2030-01-01'))).toHaveLength(3);
  });

  it('reads enrolled users', async () => {
    await (
      await start({ users: [{ uid: 1, userId: '1001', name: 'ANGEL CONFORME', privilege: 14 }] })
    ).connect();
    expect(await adapter.getUsers()).toEqual([
      { deviceUserId: '1001', name: 'ANGEL CONFORME', cardNumber: undefined, privilege: 'ADMIN' },
    ]);
  });

  describe('sync cursor', () => {
    it('returns everything on the first run and only new records afterwards', async () => {
      await (await start()).connect();
      const first = await adapter.sync();
      expect(first.logs).toHaveLength(3);

      device.options.records = [
        ...RECORDS,
        {
          uid: 3,
          userId: '1003',
          punch: 0,
          time: { year: 2026, month: 9, day: 22, hour: 8, minute: 0, second: 0 },
        },
      ];
      const second = await adapter.sync({ cursor: first.cursor });
      expect(second.logs.map((l) => l.deviceUserId)).toEqual(['1003']);
      expect((await adapter.sync({ cursor: second.cursor })).logs).toHaveLength(0);
    });

    it('re-reads everything when the device memory was cleared', async () => {
      await (await start()).connect();
      const first = await adapter.sync();
      device.options.records = [{ uid: 9, userId: '1009', punch: 0 }];
      const second = await adapter.sync({ cursor: first.cursor });
      expect(second.logs).toHaveLength(1);
      expect(second.cursor).not.toBe(first.cursor);
    });

    it('re-reads everything when the cursor does not match the stored records', async () => {
      await (await start()).connect();
      const result = await adapter.sync({ cursor: '2:deadbeefdead' });
      expect(result.logs).toHaveLength(3);
    });

    it('ignores a malformed cursor instead of failing the sync', async () => {
      await (await start()).connect();
      expect((await adapter.sync({ cursor: 'garbage' })).logs).toHaveLength(3);
    });
  });

  describe('failures', () => {
    it('times out when the device stops answering', async () => {
      await (await start({ silentCommands: [ZK_COMMAND.ATTLOG_RRQ] })).connect();
      await expect(adapter.sync()).rejects.toBeInstanceOf(DeviceTimeoutError);
    });

    it('reports a protocol error on a corrupted reply', async () => {
      await (await start()).connect();
      device.options.corruptNextReply = true;
      await expect(adapter.getUsers()).rejects.toBeInstanceOf(DeviceProtocolError);
    });

    it('detects the connection dropping mid-session', async () => {
      await (await start()).connect();
      await device.close();
      await expect(adapter.sync()).rejects.toBeInstanceOf(DeviceConnectionError);
    });

    it('declares itself disconnected after disconnect()', async () => {
      await (await start()).connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });
});
