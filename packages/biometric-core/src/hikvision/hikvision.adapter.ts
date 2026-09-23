import { randomUUID } from 'node:crypto';
import type { BiometricDeviceAdapter } from '../adapter';
import { formatLocalIso, isValidTimeZone } from '../device-time';
import {
  BiometricDeviceError,
  DeviceAuthenticationError,
  DeviceNotConnectedError,
  DeviceProtocolError,
} from '../errors';
import type {
  AdapterCapabilities,
  AttendanceLog,
  DeviceConnectionConfig,
  DeviceInfo,
  DeviceUser,
  SyncOptions,
  SyncResult,
} from '../types';
import { IsapiClient } from './isapi-client';
import {
  ACS_MAJOR_EVENT,
  type AcsEventSearchResponse,
  DEFAULT_EVENT_MINORS,
  type IsapiEvent,
  type SearchStatus,
  type UserInfoSearchResponse,
  eventToLog,
  parseIsapiTime,
  userToDeviceUser,
  xmlText,
} from './isapi';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LOOKBACK_DAYS = 31;
const DEFAULT_OVERLAP_MINUTES = 60;
/** Terminals cap the page size (commonly at 30); asking for more just returns 30. */
const DEFAULT_PAGE_SIZE = 30;
/** Stops a terminal that keeps answering MORE from looping forever. */
const MAX_PAGES = 1_000;
/** Searches end a little after the device clock, so nothing stamped "now" is cut off. */
const SEARCH_END_MARGIN_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

export interface HikvisionOptions {
  /** IANA timezone of the terminal, for firmware that reports times without an offset. */
  timezone?: string;
  /** `https` needs a certificate Node trusts (e.g. through NODE_EXTRA_CA_CERTS). */
  protocol?: 'http' | 'https';
  /** Event minors treated as punches. Defaults to face, fingerprint and card "passed". */
  eventMinors?: number[];
  /** How far back the first sync reads, and any sync whose cursor can no longer be trusted. */
  initialLookbackDays?: number;
  /** Margin re-read before the newest event already downloaded. */
  overlapMinutes?: number;
  pageSize?: number;
}

interface Cursor {
  /** Highest event serial number downloaded so far. */
  serial: number;
  /** Newest event time downloaded so far (epoch ms). */
  time: number;
}

/**
 * Adapter for Hikvision access-control terminals (DS-K1T series…) over ISAPI (HTTP + Digest).
 *
 * **Experimental:** built from the public ISAPI documentation and verified against a fake
 * terminal that speaks it; it still needs validation against physical hardware
 * (see docs/device-integration.md).
 *
 * Sync cursor: the highest event `serialNo` downloaded plus the newest event time. Each sync
 * searches from a little before that time and keeps the events with a higher serial number,
 * so the platform does not re-read the whole memory every few minutes. Two situations make
 * the cursor untrustworthy and are detected:
 * - the device clock went back behind the newest event → the whole lookback window is read;
 * - the event counter restarted (memory cleared) → a new event with a lower serial shows up,
 *   and everything in the window is returned for the ingestion pipeline to deduplicate.
 */
export class HikvisionAdapter implements BiometricDeviceAdapter {
  readonly driver = 'HIKVISION';
  readonly capabilities: AdapterCapabilities = { realtime: false, users: true };

  private readonly client: IsapiClient | null;
  private readonly timezone: string;
  private readonly minors: readonly number[];
  private readonly lookbackMs: number;
  private readonly overlapMs: number;
  private readonly pageSize: number;
  private connected = false;

  constructor(config: DeviceConnectionConfig) {
    const options = (config.options ?? {}) as HikvisionOptions;
    this.timezone =
      options.timezone && isValidTimeZone(options.timezone) ? options.timezone : 'UTC';
    const minors = (options.eventMinors ?? []).filter((m) => Number.isInteger(m) && m > 0);
    this.minors = minors.length ? minors : DEFAULT_EVENT_MINORS;
    this.lookbackMs = positive(options.initialLookbackDays, DEFAULT_LOOKBACK_DAYS) * DAY_MS;
    this.overlapMs = positive(options.overlapMinutes, DEFAULT_OVERLAP_MINUTES) * 60_000;
    this.pageSize = positive(options.pageSize, DEFAULT_PAGE_SIZE);

    const username = config.credentials?.username;
    const password = config.credentials?.password;
    const protocol = options.protocol === 'https' ? 'https' : 'http';
    const port = config.port || (protocol === 'https' ? 443 : 80);
    this.client =
      username && password
        ? new IsapiClient({
            baseUrl: `${protocol}://${config.host}:${port}`,
            username,
            password,
            timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          })
        : null;
  }

  /** HTTP holds nothing open: connecting proves the terminal answers and accepts the user. */
  async connect(): Promise<void> {
    if (this.connected) return;
    await this.run(() => this.isapi().getText('/ISAPI/System/deviceInfo'));
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      await this.getDeviceInfo();
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    this.assertConnected();
    // One request at a time: these terminals serve few concurrent HTTP sessions.
    const xml = await this.run(() => this.isapi().getText('/ISAPI/System/deviceInfo'));
    const deviceTime = await this.deviceNow();
    const userCount = await this.optionalCount(async () => {
      const res = await this.isapi().getJson<{ UserInfoCount?: { userNumber?: number } }>(
        '/ISAPI/AccessControl/UserInfo/Count?format=json',
      );
      return res.UserInfoCount?.userNumber;
    });
    const logCount = await this.optionalCount(async () => {
      const res = await this.isapi().postJson<{ AcsEventTotalNum?: { totalNum?: number } }>(
        '/ISAPI/AccessControl/AcsEventTotalNum?format=json',
        { AcsEventTotalNumCond: { major: ACS_MAJOR_EVENT, minor: 0 } },
      );
      return res.AcsEventTotalNum?.totalNum;
    });

    return {
      serialNumber: xmlText(xml, 'serialNumber') || 'unknown',
      manufacturer: 'Hikvision',
      model: xmlText(xml, 'model') || 'unknown',
      firmwareVersion: xmlText(xml, 'firmwareVersion') || 'unknown',
      userCount,
      logCount,
      deviceTime,
    };
  }

  async getUsers(): Promise<DeviceUser[]> {
    this.assertConnected();
    const searchID = randomUUID();
    const users = await this.paginate(async (position) => {
      const res = await this.isapi().postJson<UserInfoSearchResponse>(
        '/ISAPI/AccessControl/UserInfo/Search?format=json',
        {
          UserInfoSearchCond: {
            searchID,
            searchResultPosition: position,
            maxResults: this.pageSize,
          },
        },
      );
      if (!res.UserInfoSearch) throw new DeviceProtocolError('Unexpected UserInfo search reply');
      return { status: res.UserInfoSearch.responseStatusStrg, items: res.UserInfoSearch.UserInfo };
    });
    return users.map(userToDeviceUser);
  }

  async getAttendanceLogs(from: Date, to: Date): Promise<AttendanceLog[]> {
    this.assertConnected();
    return (await this.searchEvents(from, to)).map((event) => event.log);
  }

  /** Cursor: `hik1:<highest serialNo>:<newest event time in epoch ms>`. */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    this.assertConnected();
    const fetchedAt = new Date();
    const now = (await this.deviceNow()).getTime();
    const cursor = parseCursor(options.cursor);

    const earliest = now - this.lookbackMs;
    const clockWentBack = cursor !== null && now < cursor.time;
    const from =
      cursor && !clockWentBack ? Math.max(earliest, cursor.time - this.overlapMs) : earliest;
    const events = await this.searchEvents(new Date(from), new Date(now + SEARCH_END_MARGIN_MS));

    const { selected, restarted } = cursor
      ? selectNew(events, cursor)
      : { selected: events, restarted: false };
    const next = advance(cursor, selected, restarted);

    return {
      logs: selected.map((event) => event.log),
      fetchedAt,
      cursor: next ? `hik1:${next.serial}:${next.time}` : (options.cursor ?? null),
    };
  }

  private async searchEvents(from: Date, to: Date): Promise<IsapiEvent[]> {
    const startTime = formatLocalIso(from, this.timezone);
    const endTime = formatLocalIso(to, this.timezone);
    const events: IsapiEvent[] = [];

    // The search takes a single minor, so each kind of successful identification is one search.
    for (const minor of this.minors) {
      const searchID = randomUUID();
      const infos = await this.paginate(async (position) => {
        const res = await this.isapi().postJson<AcsEventSearchResponse>(
          '/ISAPI/AccessControl/AcsEvent?format=json',
          {
            AcsEventCond: {
              searchID,
              searchResultPosition: position,
              maxResults: this.pageSize,
              major: ACS_MAJOR_EVENT,
              minor,
              startTime,
              endTime,
            },
          },
        );
        if (!res.AcsEvent) throw new DeviceProtocolError('Unexpected AcsEvent search reply');
        return { status: res.AcsEvent.responseStatusStrg, items: res.AcsEvent.InfoList };
      });
      events.push(...infos.map((info) => eventToLog(info, this.timezone)));
    }

    return events.sort(
      (a, b) =>
        (a.serialNo ?? 0) - (b.serialNo ?? 0) ||
        a.log.timestamp.getTime() - b.log.timestamp.getTime(),
    );
  }

  private async paginate<T>(
    fetchPage: (position: number) => Promise<{ status?: SearchStatus; items?: T[] }>,
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { status, items = [] } = await this.run(() => fetchPage(all.length));
      all.push(...items);
      if (status !== 'MORE' || items.length === 0) return all;
    }
    throw new DeviceProtocolError(`Search did not finish after ${MAX_PAGES} pages`);
  }

  private async deviceNow(): Promise<Date> {
    const xml = await this.run(() => this.isapi().getText('/ISAPI/System/time'));
    const time = parseIsapiTime(xmlText(xml, 'localTime') ?? '', this.timezone);
    if (Number.isNaN(time.getTime())) throw new DeviceProtocolError('Unreadable device time');
    return time;
  }

  /** Counts are informative only; firmware without the endpoint reports 0 instead of failing. */
  private async optionalCount(read: () => Promise<number | undefined>): Promise<number> {
    try {
      return (await this.run(read)) ?? 0;
    } catch (error) {
      if (error instanceof DeviceProtocolError) return 0;
      throw error;
    }
  }

  /** A lost terminal must be re-validated on the next attempt. */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BiometricDeviceError && error.retryable) this.connected = false;
      throw error;
    }
  }

  private isapi(): IsapiClient {
    if (!this.client) {
      throw new DeviceAuthenticationError('Hikvision terminals need a username and password');
    }
    return this.client;
  }

  private assertConnected(): void {
    if (!this.connected) throw new DeviceNotConnectedError();
  }
}

/**
 * Events newer than the cursor. A counter restart shows up as an event with a *lower* serial
 * but a *later* time than anything downloaded; everything in the window is returned then.
 * Firmware without serial numbers leaves the platform's deduplication to do the work.
 */
function selectNew(
  events: IsapiEvent[],
  cursor: Cursor,
): { selected: IsapiEvent[]; restarted: boolean } {
  if (events.some((event) => event.serialNo === null)) {
    return { selected: events, restarted: false };
  }
  const restarted = events.some(
    (event) => event.serialNo! < cursor.serial && event.log.timestamp.getTime() > cursor.time,
  );
  return {
    selected: restarted ? events : events.filter((event) => event.serialNo! > cursor.serial),
    restarted,
  };
}

function advance(cursor: Cursor | null, selected: IsapiEvent[], restarted: boolean): Cursor | null {
  if (selected.length === 0) return cursor;
  const serial = Math.max(...selected.map((event) => event.serialNo ?? 0));
  const times = selected.map((event) => event.log.timestamp.getTime()).filter(Number.isFinite);
  const time = Math.max(cursor?.time ?? 0, ...times);
  return { serial: cursor && !restarted ? Math.max(cursor.serial, serial) : serial, time };
}

function parseCursor(cursor: string | null | undefined): Cursor | null {
  const match = cursor ? /^hik1:(\d+):(\d+)$/.exec(cursor) : null;
  return match ? { serial: Number(match[1]), time: Number(match[2]) } : null;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
