import type { PunchType, VerifyMode } from '@asistcontrol/shared';
import { localTimeToInstant } from '../device-time';
import type { AttendanceLog, DeviceUser } from '../types';

/**
 * Hikvision ISAPI for access-control terminals (DS-K1T…): payload shapes and their
 * translation to the platform model. Pure, so every rule is testable without a device.
 *
 * Search endpoints are paginated: the client sends a `searchID` it made up, the position and
 * a page size (terminals cap it, usually at 30); the reply says `MORE` until the last page.
 */

/** `major` of the access-control events: an authentication result on the terminal. */
export const ACS_MAJOR_EVENT = 5;

/** `minor` codes of a successful identification, i.e. a real punch. */
export const ACS_MINOR = {
  CARD_PASSED: 0x01,
  FINGERPRINT_PASSED: 0x26,
  FACE_PASSED: 0x4b,
} as const;

/**
 * Minors read by default. Failed attempts (unknown card, face mismatch…) are other minors and
 * are deliberately left out: they are not attendance.
 */
export const DEFAULT_EVENT_MINORS: readonly number[] = [
  ACS_MINOR.FACE_PASSED,
  ACS_MINOR.FINGERPRINT_PASSED,
  ACS_MINOR.CARD_PASSED,
];

const VERIFY_BY_MINOR: Record<number, VerifyMode> = {
  [ACS_MINOR.CARD_PASSED]: 'CARD',
  [ACS_MINOR.FINGERPRINT_PASSED]: 'FINGERPRINT',
  [ACS_MINOR.FACE_PASSED]: 'FACE',
};

/**
 * `attendanceStatus` is the attendance key pressed (or the mode scheduled) on the terminal.
 * Overtime keys are plain entries and exits for the platform: overtime is computed from the
 * schedule, never taken from the device. Anything else stays UNKNOWN.
 */
const PUNCH_BY_STATUS: Record<string, PunchType> = {
  checkIn: 'CHECK_IN',
  checkOut: 'CHECK_OUT',
  breakOut: 'BREAK_OUT',
  breakIn: 'BREAK_IN',
  overtimeIn: 'CHECK_IN',
  overtimeOut: 'CHECK_OUT',
};

export type SearchStatus = 'OK' | 'MORE' | 'NO MATCH';

export interface AcsEventInfo {
  major: number;
  minor: number;
  /** ISO 8601; most firmware adds the offset, older firmware sends wall-clock time only. */
  time: string;
  employeeNoString?: string;
  /** Numeric id sent by firmware older than `employeeNoString`. */
  employeeNo?: number;
  /** Increasing event number kept by the terminal. Missing on very old firmware. */
  serialNo?: number;
  attendanceStatus?: string;
  currentVerifyMode?: string;
  doorNo?: number;
  cardReaderNo?: number;
}

export interface AcsEventSearchResponse {
  AcsEvent?: {
    searchID?: string;
    responseStatusStrg?: SearchStatus;
    numOfMatches?: number;
    totalMatches?: number;
    InfoList?: AcsEventInfo[];
  };
}

export interface UserInfo {
  employeeNo: string;
  name?: string;
  userType?: string;
  /** May operate the terminal's local menu: the device-side administrator. */
  localUIRight?: boolean;
}

export interface UserInfoSearchResponse {
  UserInfoSearch?: {
    searchID?: string;
    responseStatusStrg?: SearchStatus;
    numOfMatches?: number;
    totalMatches?: number;
    UserInfo?: UserInfo[];
  };
}

/** Error body of ISAPI (JSON flavour). The XML flavour carries the same fields. */
export interface IsapiResponseStatus {
  statusCode?: number;
  statusString?: string;
  subStatusCode?: string;
  errorMsg?: string;
}

/** An event plus the fields the sync cursor works with. */
export interface IsapiEvent {
  log: AttendanceLog;
  serialNo: number | null;
}

/**
 * Turns an ISAPI timestamp into an instant. With an offset it is unambiguous; without one it
 * is the terminal's wall clock and needs the zone the device is configured with.
 */
export function parseIsapiTime(value: string, timeZone: string): Date {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      value.trim(),
    );
  if (!match) return new Date(Number.NaN);
  const [, year, month, day, hour, minute, second, zone] = match;
  if (zone) {
    // Some firmware writes the offset without a colon (+0500), which Date does not accept.
    const offset = zone === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  }
  return localTimeToInstant(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    },
    timeZone,
  );
}

export function eventToLog(event: AcsEventInfo, timeZone: string): IsapiEvent {
  const deviceUserId =
    event.employeeNoString ?? (event.employeeNo !== undefined ? String(event.employeeNo) : '');
  return {
    serialNo: typeof event.serialNo === 'number' ? event.serialNo : null,
    log: {
      // An event with no person attached is passed on as is: the ingestion pipeline rejects it
      // and counts it in the sync log, instead of it disappearing here.
      deviceUserId,
      timestamp: parseIsapiTime(event.time, timeZone),
      punchType: PUNCH_BY_STATUS[event.attendanceStatus ?? ''] ?? 'UNKNOWN',
      verifyMode: VERIFY_BY_MINOR[event.minor] ?? 'OTHER',
      raw: {
        serialNo: event.serialNo ?? null,
        major: event.major,
        minor: event.minor,
        time: event.time,
        attendanceStatus: event.attendanceStatus ?? null,
        currentVerifyMode: event.currentVerifyMode ?? null,
        doorNo: event.doorNo ?? null,
      },
    },
  };
}

export function userToDeviceUser(user: UserInfo): DeviceUser {
  return {
    deviceUserId: user.employeeNo,
    name: user.name || user.employeeNo,
    privilege: user.localUIRight ? 'ADMIN' : 'USER',
  };
}

/**
 * Reads a flat element of an ISAPI XML document (`deviceInfo`, `time`, `ResponseStatus`).
 * These documents are small and flat, so a full XML parser would be a dependency for nothing.
 */
export function xmlText(xml: string, tag: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([^<]*)</(?:\\w+:)?${tag}>`).exec(xml);
  return match ? decodeXmlEntities(match[1]!.trim()) : null;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(lt|gt|quot|apos|amp);/g, (_, entity: string) => {
    const map: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
    return map[entity]!;
  });
}

/** Human-readable summary of an ISAPI error body (JSON or XML), for the sync log. */
export function describeIsapiError(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const status = JSON.parse(trimmed) as IsapiResponseStatus;
      const parts = [status.statusString, status.subStatusCode, status.errorMsg].filter(Boolean);
      return parts.length ? parts.join(' · ') : null;
    } catch {
      return null;
    }
  }
  const parts = ['statusString', 'subStatusCode'].map((tag) => xmlText(trimmed, tag));
  const found = parts.filter(Boolean);
  return found.length ? found.join(' · ') : null;
}
