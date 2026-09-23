import type { Permission } from '@asistcontrol/shared';
import clsx from 'clsx';
import {
  CalendarCheck,
  ClipboardList,
  Cpu,
  FileSpreadsheet,
  Fingerprint,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { logout } from '../lib/api';
import { type ConnectionState, useRealtime } from '../lib/realtime';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '../stores/auth';

const NAV: { to: string; label: string; icon: typeof Users; permission: Permission }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:read' },
  { to: '/asistencia', label: 'Asistencia', icon: CalendarCheck, permission: 'attendance:read' },
  { to: '/empleados', label: 'Empleados', icon: Users, permission: 'employees:read' },
  { to: '/dispositivos', label: 'Dispositivos', icon: Cpu, permission: 'devices:read' },
  { to: '/solicitudes', label: 'Solicitudes', icon: ClipboardList, permission: 'leave:read' },
  { to: '/reportes', label: 'Reportes', icon: FileSpreadsheet, permission: 'reports:read' },
  { to: '/auditoria', label: 'Auditoría', icon: ScrollText, permission: 'audit:read' },
];

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super administrador',
  ADMIN: 'Administrador',
  HR: 'Talento humano',
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Empleado',
};

export function AppShell() {
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const connection = useRealtime();

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col bg-sidebar text-sidebar-ink lg:sticky lg:top-0 lg:h-screen lg:w-60">
        <div className="flex items-center gap-2 px-5 py-5 text-white">
          <Fingerprint className="size-6 text-[#86b6ef]" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">AsistControl</span>
          <NotificationBell className="ml-auto" />
          <button onClick={() => void logout()} className="lg:hidden" aria-label="Cerrar sesión">
            <LogOut className="size-4" aria-hidden />
          </button>
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
                  'flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition',
                  isActive
                    ? 'bg-white/10 font-medium text-white'
                    : 'hover:bg-white/5 hover:text-white',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-white/10 px-5 py-4 text-xs lg:block">
          <ConnectionIndicator state={connection} />
          <p className="mt-3 truncate font-medium text-white">{user?.displayName}</p>
          <p className="text-sidebar-ink/80">{user ? ROLE_LABEL[user.role] : ''}</p>
          <button
            onClick={() => void logout()}
            className="mt-3 inline-flex items-center gap-1.5 hover:text-white"
          >
            <LogOut className="size-3.5" aria-hidden /> Cerrar sesión
          </button>
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
