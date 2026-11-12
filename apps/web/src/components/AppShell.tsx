import type { Permission } from '@asistcontrol/shared';
import clsx from 'clsx';
import {
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Cpu,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  UserCheck,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { ROLE_LABEL } from '../lib/accounts';
import { logout } from '../lib/api';
import { type ConnectionState, useRealtime } from '../lib/realtime';
import { BrandLogo } from './BrandLogo';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '../stores/auth';

const NAV: { to: string; label: string; icon: typeof Users; permission: Permission }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:read' },
  { to: '/presencia', label: 'Presencia', icon: UserCheck, permission: 'dashboard:read' },
  { to: '/asistencia', label: 'Asistencia', icon: CalendarCheck, permission: 'attendance:read' },
  { to: '/empleados', label: 'Empleados', icon: Users, permission: 'employees:read' },
  { to: '/horarios', label: 'Horarios', icon: CalendarClock, permission: 'schedules:read' },
  { to: '/dispositivos', label: 'Dispositivos', icon: Cpu, permission: 'devices:read' },
  { to: '/solicitudes', label: 'Solicitudes', icon: ClipboardList, permission: 'leave:read' },
  { to: '/reportes', label: 'Reportes', icon: FileSpreadsheet, permission: 'reports:read' },
  { to: '/usuarios', label: 'Usuarios', icon: UserCog, permission: 'users:read' },
  { to: '/auditoria', label: 'Auditoría', icon: ScrollText, permission: 'audit:read' },
  { to: '/configuracion', label: 'Configuración', icon: Settings, permission: 'settings:read' },
];

export function AppShell() {
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const connection = useRealtime();

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-sidebar text-sidebar-ink lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-b-0 lg:border-r print:hidden">
        <div className="flex items-center gap-3 px-5 pb-3 pt-4 lg:pb-5 lg:pt-6">
          <Link
            to="/"
            className="flex flex-col gap-1"
            aria-label="AsistControl de Kairosig, inicio"
          >
            <BrandLogo className="h-9 lg:h-12" />
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3 lg:block">
              AsistControl
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1 text-ink-2">
            <NotificationBell />
            <Link
              to="/mi-cuenta"
              className="rounded-lg p-1.5 hover:bg-surface-2 hover:text-ink-1 lg:hidden"
              aria-label="Mi cuenta"
            >
              <UserRound className="size-5" aria-hidden />
            </Link>
            <button
              onClick={() => void logout()}
              className="rounded-lg p-1.5 hover:bg-surface-2 hover:text-ink-1 lg:hidden"
              aria-label="Cerrar sesión"
            >
              <LogOut className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        <nav
          aria-label="Principal"
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible"
        >
          {NAV.filter((n) => can(n.permission)).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'relative flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition',
                  isActive
                    ? // The helmet's yellow marks where you are: under the tab on a phone,
                      // at its left edge in the sidebar.
                      'bg-sidebar-active font-semibold text-sidebar-active-ink before:absolute before:inset-x-3 before:bottom-0 before:h-[3px] before:rounded-full before:bg-brand-yellow lg:before:inset-x-auto lg:before:inset-y-2 lg:before:left-0 lg:before:h-auto lg:before:w-[3px]'
                    : 'hover:bg-surface-2 hover:text-ink-1',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('size-4', isActive && 'text-accent')} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-line px-5 py-4 text-xs lg:block">
          <ConnectionIndicator state={connection} />
          <p className="mt-3 truncate font-medium text-ink-1">{user?.displayName}</p>
          <p className="text-ink-3">{user ? ROLE_LABEL[user.role] : ''}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link to="/mi-cuenta" className="inline-flex items-center gap-1.5 hover:text-accent">
              <UserRound className="size-3.5" aria-hidden /> Mi cuenta
            </Link>
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 hover:text-accent"
            >
              <LogOut className="size-3.5" aria-hidden /> Cerrar sesión
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function ConnectionIndicator({ state }: { state: ConnectionState }) {
  const { label, dot } = {
    live: { label: 'Tiempo real activo', dot: 'bg-good' },
    connecting: { label: 'Conectando…', dot: 'bg-warning' },
    offline: { label: 'Sin tiempo real', dot: 'bg-critical' },
  }[state];
  return (
    <span className="inline-flex items-center gap-2" aria-live="polite">
      <span className={clsx('size-2 rounded-full', dot)} />
      {label}
    </span>
  );
}
