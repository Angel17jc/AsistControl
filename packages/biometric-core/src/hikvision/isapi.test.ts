import { describe, expect, it } from 'vitest';
import { formatLocalIso } from '../device-time';
import {
  ACS_MAJOR_EVENT,
  ACS_MINOR,
  describeIsapiError,
  eventToLog,
  parseIsapiTime,
  userToDeviceUser,
  xmlText,
} from './isapi';

const TZ = 'America/Guayaquil';

describe('ISAPI time', () => {
  it.each([
    ['2026-09-21T08:02:00-05:00', '2026-09-21T13:02:00.000Z'],
    ['2026-09-21T08:02:00-0500', '2026-09-21T13:02:00.000Z'],
    ['2026-09-21T13:02:00Z', '2026-09-21T13:02:00.000Z'],
    ['2026-09-21T08:02:00.750-05:00', '2026-09-21T13:02:00.000Z'],
    // Wall-clock only: read in the terminal's zone.
    ['2026-09-21T08:02:00', '2026-09-21T13:02:00.000Z'],
  ])('parses %s', (value, expected) => {
    expect(parseIsapiTime(value, TZ).toISOString()).toBe(expected);
  });

  it('rejects what is not a timestamp', () => {
    expect(Number.isNaN(parseIsapiTime('ayer', TZ).getTime())).toBe(true);
  });

  it('formats search bounds as local time with the offset in force, DST included', () => {
    expect(formatLocalIso(new Date('2026-09-21T13:02:00.456Z'), TZ)).toBe(
      '2026-09-21T08:02:00-05:00',
    );
    // Madrid: +02:00 in summer, +01:00 in winter.
    expect(formatLocalIso(new Date('2026-07-01T10:00:00Z'), 'Europe/Madrid')).toBe(
      '2026-07-01T12:00:00+02:00',
    );
    expect(formatLocalIso(new Date('2026-01-15T10:00:00Z'), 'Europe/Madrid')).toBe(
      '2026-01-15T11:00:00+01:00',
    );
    expect(formatLocalIso(new Date('2026-03-01T00:00:00Z'), 'Asia/Kolkata')).toBe(
      '2026-03-01T05:30:00+05:30',
    );
  });
});

describe('ISAPI events', () => {
  const base = { major: ACS_MAJOR_EVENT, time: '2026-09-21T08:02:00-05:00', serialNo: 7 };

  it.each([
    ['checkIn', 'CHECK_IN'],
    ['checkOut', 'CHECK_OUT'],
    ['breakOut', 'BREAK_OUT'],
    ['breakIn', 'BREAK_IN'],
    // Overtime is computed from the schedule; the key only says in or out.
    ['overtimeIn', 'CHECK_IN'],
    ['overtimeOut', 'CHECK_OUT'],
    ['undefined', 'UNKNOWN'],
    [undefined, 'UNKNOWN'],
  ])('maps attendance status %s to %s', (attendanceStatus, punchType) => {
    const { log } = eventToLog(
      { ...base, minor: ACS_MINOR.FACE_PASSED, employeeNoString: '1001', attendanceStatus },
      TZ,
    );
    expect(log.punchType).toBe(punchType);
  });

  it('takes the identification method from the minor code', () => {
    const verify = (minor: number) =>
      eventToLog({ ...base, minor, employeeNoString: '1' }, TZ).log.verifyMode;
    expect(verify(ACS_MINOR.FACE_PASSED)).toBe('FACE');
    expect(verify(ACS_MINOR.FINGERPRINT_PASSED)).toBe('FINGERPRINT');
    expect(verify(ACS_MINOR.CARD_PASSED)).toBe('CARD');
    expect(verify(0x99)).toBe('OTHER');
  });

  it('accepts the numeric employee id of older firmware', () => {
    expect(eventToLog({ ...base, minor: 1, employeeNo: 1001 }, TZ).log.deviceUserId).toBe('1001');
  });

  it('passes on an event with no person so the pipeline can count it as rejected', () => {
    const event = eventToLog({ ...base, minor: 1 }, TZ);
    expect(event.log.deviceUserId).toBe('');
    expect(event.serialNo).toBe(7);
  });

  it('marks events without a serial number', () => {
    const { serialNo: _serialNo, ...unnumbered } = base;
    expect(eventToLog({ ...unnumbered, minor: 1, employeeNoString: '1' }, TZ).serialNo).toBeNull();
  });
});

describe('ISAPI documents', () => {
  it('reads flat XML elements, namespaced or not, decoding entities once', () => {
    const xml =
      '<DeviceInfo xmlns="http://www.isapi.org/ver20/XMLSchema">' +
      '<deviceName>Acceso &amp;amp; Salida</deviceName><model> DS-K1T671M </model>' +
      '<hik:serialNumber>ABC</hik:serialNumber></DeviceInfo>';
    expect(xmlText(xml, 'deviceName')).toBe('Acceso &amp; Salida');
    expect(xmlText(xml, 'model')).toBe('DS-K1T671M');
    expect(xmlText(xml, 'serialNumber')).toBe('ABC');
    expect(xmlText(xml, 'firmwareVersion')).toBeNull();
  });

  it('summarises error bodies in both flavours', () => {
    expect(
      describeIsapiError(
        '{"statusCode":4,"statusString":"Invalid Operation","subStatusCode":"notSupport"}',
      ),
    ).toBe('Invalid Operation · notSupport');
    expect(
      describeIsapiError(
        '<ResponseStatus><statusString>Device Busy</statusString>' +
          '<subStatusCode>deviceBusy</subStatusCode></ResponseStatus>',
      ),
    ).toBe('Device Busy · deviceBusy');
    expect(describeIsapiError('<html>502</html>')).toBeNull();
    expect(describeIsapiError('{broken')).toBeNull();
  });

  it('marks the terminal administrator', () => {
    expect(userToDeviceUser({ employeeNo: '9', localUIRight: true })).toEqual({
      deviceUserId: '9',
      name: '9',
      privilege: 'ADMIN',
    });
  });
});
