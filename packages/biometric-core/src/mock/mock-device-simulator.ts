import { EventEmitter } from 'node:events';
import type { PunchType, VerifyMode } from '@asistcontrol/shared';
import {
  type BiometricDeviceError,
  DeviceConnectionError,
  DeviceProtocolError,
  DeviceTimeoutError,
} from '../errors';
import type { AttendanceLog, DeviceInfo, DeviceUser } from '../types';
import { createRandom, randomInt } from './random';

export type FaultKind = 'TIMEOUT' | 'PROTOCOL' | 'CONNECTION';

export const WORKDAY_SCENARIOS = [
  'ON_TIME',
  'LATE',
  'EARLY_LEAVE',
  'OVERTIME',
  'MISSING_EXIT',
  'NO_LUNCH',
  'DUPLICATE_PUNCH',
  'ABSENT',
] as const;
export type WorkdayScenario = (typeof WORKDAY_SCENARIOS)[number];

export interface WorkdayTemplate {
  /** Local times "HH:mm". Times earlier than `start` fall on the next day (night shifts). */
  start: string;
  end: string;
  /** Optional: shifts without a break produce no lunch punches. */
  breakStart?: string | null;
  breakEnd?: string | null;
}

export interface GenerateWorkdayOptions {
  /** Local calendar date "YYYY-MM-DD". */
  date: string;
  /** Offset of the device's local time from UTC, in minutes (e.g. -300 for UTC-5). */
  utcOffsetMinutes: number;
  scenario: WorkdayScenario;
  template?: WorkdayTemplate;
}

export interface MockDeviceSimulatorOptions {
  serialNumber?: string;
  model?: string;
  seed?: number;
  /** Simulated network latency per operation. */
  latencyMs?: number;
}

const DEFAULT_TEMPLATE: WorkdayTemplate = {
  start: '08:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  end: '17:00',
};

interface SimulatorEvents {
  log: [AttendanceLog];
}

/**
 * In-memory virtual biometric terminal.
 *
 * It owns the device state (enrolled users, punch memory, clock) and lets tests or the UI
 * inject realistic failures: power loss, timeouts, protocol errors, dropped connections,
 * clock drift and duplicated records. Adapters talk to it as if it were a device on the LAN.
 */
export class MockDeviceSimulator {
  readonly serialNumber: string;
  readonly model: string;
  latencyMs: number;
  /** Device clock drift relative to the host clock. */
  clockSkewMs = 0;
  /** When true, reads return every matching log twice (buggy firmware). */
  duplicateOnRead = false;

  private online = true;
  private memoryGeneration = 1;
  private readonly users = new Map<string, DeviceUser>();
  private readonly logs: AttendanceLog[] = [];
  private readonly pendingFaults: FaultKind[] = [];
  private dropAfterOperations: number | null = null;
  private readonly emitter = new EventEmitter<SimulatorEvents>();
  private readonly random: () => number;
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MockDeviceSimulatorOptions = {}) {
    this.serialNumber = options.serialNumber ?? 'MOCK-0001';
    this.model = options.model ?? 'AC-SIM-100';
    this.latencyMs = options.latencyMs ?? 0;
    this.random = createRandom(options.seed ?? 42);
  }

  // ---------------------------------------------------------------- users

  enrollUser(
    user: Omit<DeviceUser, 'privilege'> & Partial<Pick<DeviceUser, 'privilege'>>,
  ): DeviceUser {
    const enrolled: DeviceUser = { privilege: 'USER', ...user };
    this.users.set(enrolled.deviceUserId, enrolled);
    return enrolled;
  }

  removeUser(deviceUserId: string): boolean {
    return this.users.delete(deviceUserId);
  }

  listUsers(): DeviceUser[] {
    return [...this.users.values()];
  }

  // ---------------------------------------------------------------- punches

  /**
   * Records a punch as if a person had placed a finger on the reader.
   * `silent` stores it without a live notification — a backfilled/historical record that
   * only reaches the platform through sync(), like punches taken while the network was down.
   */
  punch(
    deviceUserId: string,
    options: { at?: Date; punchType?: PunchType; verifyMode?: VerifyMode; silent?: boolean } = {},
  ): AttendanceLog {
    const log: AttendanceLog = {
      deviceUserId,
      timestamp: options.at ?? this.now(),
      punchType: options.punchType ?? 'UNKNOWN',
      verifyMode: options.verifyMode ?? 'FINGERPRINT',
      raw: { serial: this.serialNumber, uid: deviceUserId },
    };
    this.logs.push(log);
    if (!options.silent) this.emitter.emit('log', log);
    return log;
  }

  /** Generates the punches of a full working day following a named scenario. */
  generateWorkday(deviceUserId: string, options: GenerateWorkdayOptions): AttendanceLog[] {
    const t = options.template ?? DEFAULT_TEMPLATE;
    const at = (hhmm: string, deltaMinutes: number) => {
      const nextDay = hhmm < t.start ? 24 * 60 : 0;
      return localTimeToDate(options.date, hhmm, options.utcOffsetMinutes, deltaMinutes + nextDay);
    };
    const jitter = () => randomInt(this.random, -3, 3);

    const plan: { at: Date; type: PunchType }[] = [];
    const entry = (delta: number) => plan.push({ at: at(t.start, delta), type: 'CHECK_IN' });
    const breakOut = () => {
      if (t.breakStart) plan.push({ at: at(t.breakStart, jitter()), type: 'BREAK_OUT' });
    };
    const breakIn = () => {
      if (t.breakEnd) plan.push({ at: at(t.breakEnd, jitter()), type: 'BREAK_IN' });
    };
    const exit = (delta: number) => plan.push({ at: at(t.end, delta), type: 'CHECK_OUT' });

    switch (options.scenario) {
      case 'ABSENT':
        break;
      case 'ON_TIME':
        entry(randomInt(this.random, -10, 0));
        breakOut();
        breakIn();
        exit(randomInt(this.random, 0, 8));
        break;
      case 'LATE':
        entry(randomInt(this.random, 12, 45));
        breakOut();
        breakIn();
        exit(randomInt(this.random, 0, 5));
        break;
      case 'EARLY_LEAVE':
        entry(randomInt(this.random, -5, 0));
        breakOut();
        breakIn();
        exit(-randomInt(this.random, 30, 90));
        break;
      case 'OVERTIME':
        entry(randomInt(this.random, -5, 0));
        breakOut();
        breakIn();
        exit(randomInt(this.random, 60, 150));
        break;
      case 'MISSING_EXIT':
        entry(randomInt(this.random, -5, 0));
        breakOut();
        breakIn();
        break;
      case 'NO_LUNCH':
        entry(randomInt(this.random, -5, 0));
        exit(randomInt(this.random, 0, 5));
        break;
      case 'DUPLICATE_PUNCH': {
        entry(randomInt(this.random, -5, 0));
        const first = plan[0]!;
        // Same person presses twice within a few seconds.
        plan.push({ at: new Date(first.at.getTime() + 4_000), type: 'CHECK_IN' });
        breakOut();
        breakIn();
        exit(randomInt(this.random, 0, 5));
        break;
      }
    }

    return plan.map((p) => this.punch(deviceUserId, { at: p.at, punchType: p.type, silent: true }));
  }

  /** Emits random punches for enrolled users at a fixed interval (live demo mode). */
  startAutoGeneration(intervalMs: number): void {
    this.stopAutoGeneration();
    this.autoTimer = setInterval(() => {
      const users = this.listUsers();
      if (!this.online || users.length === 0) return;
      const user = users[randomInt(this.random, 0, users.length - 1)]!;
      this.punch(user.deviceUserId);
    }, intervalMs);
    this.autoTimer.unref?.();
  }

  stopAutoGeneration(): void {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = null;
  }

  get autoGenerating(): boolean {
    return this.autoTimer !== null;
  }

  // ---------------------------------------------------------------- faults

  /** Simulates the device being unplugged / unreachable on the network. */
  setOnline(online: boolean): void {
    this.online = online;
  }

  isOnline(): boolean {
    return this.online;
  }

  /** The next device operation will fail with the given fault. Faults queue up. */
  failNext(kind: FaultKind, times = 1): void {
    for (let i = 0; i < times; i++) this.pendingFaults.push(kind);
  }

  /** Connection drops (device goes offline) after `operations` successful operations. */
  dropConnectionAfter(operations: number): void {
    this.dropAfterOperations = operations;
  }

  clearFaults(): void {
    this.pendingFaults.length = 0;
    this.dropAfterOperations = null;
    this.online = true;
  }

  // ---------------------------------------------------------------- device protocol

  /**
   * Entry point used by the adapter for every request: applies latency and faults.
   * Kept public so custom adapters/tests can reuse the same failure semantics.
   */
  async request<T>(operation: () => T): Promise<T> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (!this.online) throw new DeviceConnectionError(`Device ${this.serialNumber} is unreachable`);

    const fault = this.pendingFaults.shift();
    if (fault) throw faultToError(fault);

    if (this.dropAfterOperations !== null) {
      if (this.dropAfterOperations <= 0) {
        this.online = false;
        this.dropAfterOperations = null;
        throw new DeviceConnectionError('Connection lost during operation');
      }
      this.dropAfterOperations--;
    }
    return operation();
  }

  readInfo(): DeviceInfo {
    return {
      serialNumber: this.serialNumber,
      manufacturer: 'AsistControl',
      model: this.model,
      firmwareVersion: 'sim-1.0.0',
      userCount: this.users.size,
      logCount: this.logs.length,
      deviceTime: this.now(),
    };
  }

  readLogs(from: Date, to: Date): AttendanceLog[] {
    const matching = this.logs
      .filter((l) => l.timestamp >= from && l.timestamp <= to)
      .map((l) => ({ ...l, timestamp: new Date(l.timestamp) }));
    return this.duplicateOnRead ? [...matching, ...matching.map((l) => ({ ...l }))] : matching;
  }

  /**
   * Records stored at position >= index of the given memory generation (the device's record
   * counter). After the memory is wiped the generation changes and everything is re-read.
   */
  readFromIndex(
    generation: number,
    index: number,
  ): { logs: AttendanceLog[]; generation: number; next: number } {
    const start = generation === this.memoryGeneration ? Math.min(index, this.logs.length) : 0;
    const slice = this.logs.slice(start).map((l) => ({ ...l, timestamp: new Date(l.timestamp) }));
    const logs = this.duplicateOnRead ? [...slice, ...slice.map((l) => ({ ...l }))] : slice;
    return { logs, generation: this.memoryGeneration, next: this.logs.length };
  }

  /** Wipes the attendance memory, as admins do on real terminals when it fills up. */
  clearLogs(): void {
    this.logs.length = 0;
    this.memoryGeneration++;
  }

  onLog(listener: (log: AttendanceLog) => void): () => void {
    this.emitter.on('log', listener);
    return () => this.emitter.off('log', listener);
  }

  now(): Date {
    return new Date(Date.now() + this.clockSkewMs);
  }
}

function faultToError(kind: FaultKind): BiometricDeviceError {
  switch (kind) {
    case 'TIMEOUT':
      return new DeviceTimeoutError('Simulated timeout');
    case 'PROTOCOL':
      return new DeviceProtocolError('Simulated corrupted frame');
    case 'CONNECTION':
      return new DeviceConnectionError('Simulated connection reset');
  }
}

/** Converts a local "YYYY-MM-DD" + "HH:mm" at a fixed UTC offset into an absolute instant. */
export function localTimeToDate(
  date: string,
  hhmm: string,
  utcOffsetMinutes: number,
  deltaMinutes = 0,
): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const utcMs = Date.UTC(y, mo - 1, d, h, mi) - utcOffsetMinutes * 60_000;
  return new Date(utcMs + deltaMinutes * 60_000);
}
