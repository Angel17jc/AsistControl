import * as Prisma from '@prisma/client';
import * as Shared from '@asistcontrol/shared';

/**
 * The web client relies on @asistcontrol/shared; the database on Prisma enums.
 * If someone adds a value to one side only, this test fails before it reaches production.
 */
const pairs: [string, Record<string, string>, readonly string[]][] = [
  ['Role', Prisma.Role, Shared.ROLES],
  ['EmployeeStatus', Prisma.EmployeeStatus, Shared.EMPLOYEE_STATUSES],
  ['DeviceStatus', Prisma.DeviceStatus, Shared.DEVICE_STATUSES],
  ['DeviceDriver', Prisma.DeviceDriver, Shared.DEVICE_DRIVERS],
  ['PunchType', Prisma.PunchType, Shared.PUNCH_TYPES],
  ['VerifyMode', Prisma.VerifyMode, Shared.VERIFY_MODES],
  ['EventSource', Prisma.EventSource, Shared.EVENT_SOURCES],
  ['DayType', Prisma.DayType, Shared.DAY_TYPES],
  ['AttendanceStatus', Prisma.AttendanceStatus, Shared.ATTENDANCE_STATUSES],
  ['AttendanceAnomaly', Prisma.AttendanceAnomaly, Shared.ATTENDANCE_ANOMALIES],
  ['SyncStatus', Prisma.SyncStatus, Shared.SYNC_STATUSES],
  ['SyncTrigger', Prisma.SyncTrigger, Shared.SYNC_TRIGGERS],
  ['LeaveType', Prisma.LeaveType, Shared.LEAVE_TYPES],
  ['RequestStatus', Prisma.RequestStatus, Shared.REQUEST_STATUSES],
  ['OvertimeKind', Prisma.OvertimeKind, Shared.OVERTIME_KINDS],
  ['NotificationType', Prisma.NotificationType, Shared.NOTIFICATION_TYPES],
];

describe('shared enums ↔ Prisma enums', () => {
  it.each(pairs)('%s matches', (_name, prismaEnum, sharedValues) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...sharedValues].sort());
  });
});
