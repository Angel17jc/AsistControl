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

export type ConnectionState = 'connecting' | 'live' | 'offline';

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
      queryClient.setQueryData<DashboardSummary>(['dashboard'], (old) =>
        old ? { ...old, latestEvents: [event, ...old.latestEvents].slice(0, 15) } : old,
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
