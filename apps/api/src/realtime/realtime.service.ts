import { Injectable } from '@nestjs/common';
import {
  type AttendanceEventCreatedPayload,
  type AttendanceRecordUpdatedPayload,
  type DeviceStatusChangedPayload,
  type DeviceSyncFinishedPayload,
  REALTIME_EVENTS,
} from '@asistcontrol/shared';
import { ROOMS, RealtimeGateway } from './realtime.gateway';

/** Audience of an attendance notification: the employee and their supervisor. */
export interface AttendanceAudience {
  employeeId: string | null;
  supervisorId: string | null;
}

/**
 * Facade the domain uses to push notifications. Keeps Socket.IO details (rooms, event names)
 * out of business services, and is a no-op before the gateway is initialized (e.g. in tests).
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  attendanceEventCreated(
    payload: AttendanceEventCreatedPayload,
    audience: AttendanceAudience,
  ): void {
    this.emitAttendance(REALTIME_EVENTS.ATTENDANCE_EVENT_CREATED, payload, audience);
  }

  attendanceRecordUpdated(
    payload: AttendanceRecordUpdatedPayload,
    audience: AttendanceAudience,
  ): void {
    this.emitAttendance(REALTIME_EVENTS.ATTENDANCE_RECORD_UPDATED, payload, audience);
  }

  deviceStatusChanged(payload: DeviceStatusChangedPayload): void {
    this.gateway.server?.to(ROOMS.DEVICES).emit(REALTIME_EVENTS.DEVICE_STATUS_CHANGED, payload);
  }

  deviceSyncFinished(payload: DeviceSyncFinishedPayload): void {
    this.gateway.server?.to(ROOMS.DEVICES).emit(REALTIME_EVENTS.DEVICE_SYNC_FINISHED, payload);
  }

  private emitAttendance(event: string, payload: unknown, audience: AttendanceAudience): void {
    const server = this.gateway.server;
    if (!server) return;
    const rooms: string[] = [ROOMS.ALL_ATTENDANCE];
    if (audience.employeeId) rooms.push(ROOMS.employee(audience.employeeId));
    if (audience.supervisorId) rooms.push(ROOMS.supervisor(audience.supervisorId));
    server.to(rooms).emit(event, payload);
  }
}
