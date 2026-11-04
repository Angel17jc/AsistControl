import {
  type AttendanceEventCreatedPayload,
  type DashboardSummary,
  REALTIME_EVENTS,
  REALTIME_NAMESPACE,
} from '@asistcontrol/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../stores/auth';
import { refreshSession } from './api';
import { localDate, setDisplayTimezone } from './format';

export type ConnectionState = 'connecting' | 'live' | 'offline';

/**
 * The summary with a punch that just arrived. It lists today's: a punch of another day (the
 * download of a terminal's memory, a correction) is not news, and shows no date to tell it apart.
 */
export function withLatestEvent(
  summary: DashboardSummary,
  event: AttendanceEventCreatedPayload,
): DashboardSummary {
  setDisplayTimezone(summary.timezone);
  if (localDate(event.occurredAt) !== summary.date) return summary;
  return { ...summary, latestEvents: [event, ...summary.latestEvents].slice(0, 15) };
}

/**
 * Keeps the dashboard live. New punches are prepended to the cached summary immediately
 * (no refetch needed to see them); aggregates are refreshed in the background.
 */
export function useRealtime(): ConnectionState {
  const token = useAuth((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!token) return;
    const socket = io(REALTIME_NAMESPACE, { auth: { token }, transports: ['websocket'] });

    socket.on('connect', () => setState('live'));
    socket.on('disconnect', () => setState('offline'));
    socket.on('connect_error', () => setState('offline'));
    // The server disconnects sockets whose token expired: refresh and reconnect.
    socket.on('error', () => void refreshSession());

    socket.on(REALTIME_EVENTS.ATTENDANCE_EVENT_CREATED, (event: AttendanceEventCreatedPayload) => {
      // Keeps its age: one more punch does not make the totals any fresher, and treating them
      // as fresh would stop this screen from asking for them again when it is reopened.
      queryClient.setQueryData<DashboardSummary>(
        ['dashboard'],
        (old) => old && withLatestEvent(old, event),
        { updatedAt: queryClient.getQueryState(['dashboard'])?.dataUpdatedAt },
      );
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    });
    socket.on(REALTIME_EVENTS.ATTENDANCE_RECORD_UPDATED, () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    });
    const refreshDevices = () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };
    socket.on(REALTIME_EVENTS.DEVICE_STATUS_CHANGED, refreshDevices);
    // A notification for this user: refresh the bell (count and, when open, the list).
    socket.on(REALTIME_EVENTS.NOTIFICATION_CREATED, () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    socket.on(REALTIME_EVENTS.DEVICE_SYNC_FINISHED, () => {
      refreshDevices();
      void queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
    });

    return () => {
      socket.disconnect();
    };
  }, [token, queryClient]);

  return token ? state : 'offline';
}
