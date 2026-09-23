import type { AppNotification, PaginatedResponse } from '@asistcontrol/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { describeNotification } from '../lib/notifications';
import { Spinner, ToneIcon } from './ui';

const PAGE_SIZE = 20;

/**
 * The bell: unread count on the icon and the latest notifications in a panel. New ones
 * arrive over the WebSocket (see realtime.ts), which invalidates these queries.
 */
export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
  });
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () =>
      api<PaginatedResponse<AppNotification>>('/notifications', {
        query: { pageSize: PAGE_SIZE },
      }),
    enabled: open,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: refresh,
  });

  // Close on Escape or a click outside, the way a menu behaves.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const count = unread.data?.count ?? 0;

  function follow(notification: AppNotification) {
    if (!notification.readAt) markRead.mutate(notification.id);
    setOpen(false);
    void navigate(describeNotification(notification).href);
  }

  return (
    <div ref={root} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={count > 0 ? `Notificaciones, ${count} sin leer` : 'Notificaciones'}
        className="relative rounded-lg p-1.5 hover:bg-white/10"
      >
        <Bell className="size-5" aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notificaciones"
          // On phones the bell sits at the right edge; in the sidebar, at the left.
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface-1 text-ink-1 shadow-lg lg:left-0 lg:right-auto"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notificaciones</h2>
            {count > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs font-medium text-accent hover:underline"
              >
                Marcar todas como leídas
              </button>
            )}
          </header>
          {list.isLoading && <Spinner />}
          {list.data?.data.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-ink-3">No tiene notificaciones.</p>
          )}
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {list.data?.data.map((notification) => {
              const view = describeNotification(notification);
              const isUnread = !notification.readAt;
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => follow(notification)}
                    className={clsx(
                      'flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2',
                      isUnread && 'bg-accent/5',
                    )}
                  >
                    <ToneIcon tone={view.tone} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={clsx('text-sm', isUnread && 'font-semibold')}>
                          {view.title}
                        </span>
                        <span className="shrink-0 text-xs text-ink-3">
                          {relativeTime(notification.createdAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block break-words text-xs text-ink-2">
                        {view.body}
                      </span>
                    </span>
                    {isUnread && <span className="sr-only">(sin leer)</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
