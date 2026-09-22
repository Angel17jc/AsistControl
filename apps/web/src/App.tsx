import type { Permission } from '@asistcontrol/shared';
import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { refreshSession } from './lib/api';
import { AttendancePage } from './pages/AttendancePage';
import { AuditPage } from './pages/AuditPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LoginPage } from './pages/LoginPage';
import { ReportsPage } from './pages/ReportsPage';
import { RequestsPage } from './pages/RequestsPage';
import { useAuth } from './stores/auth';

/** Route guard. The API enforces permissions; this only avoids rendering pages that would 403. */
function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const can = useAuth((s) => s.can);
  return can(permission) ? children : <Navigate to="/" replace />;
}

function Home() {
  const can = useAuth((s) => s.can);
  return can('dashboard:read') ? <DashboardPage /> : <Navigate to="/asistencia" replace />;
}

export function App() {
  const status = useAuth((s) => s.status);

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    if (useAuth.getState().status === 'unknown') void refreshSession();
  }, []);

  if (status === 'unknown') return <Spinner label="Iniciando…" />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={status === 'authenticated' ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route index element={<Home />} />
        <Route
          path="asistencia"
          element={
            <Guard permission="attendance:read">
              <AttendancePage />
            </Guard>
          }
        />
        <Route
          path="empleados"
          element={
            <Guard permission="employees:read">
              <EmployeesPage />
            </Guard>
          }
        />
        <Route
          path="dispositivos"
          element={
            <Guard permission="devices:read">
              <DevicesPage />
            </Guard>
          }
        />
        <Route
          path="solicitudes"
          element={
            <Guard permission="leave:read">
              <RequestsPage />
            </Guard>
          }
        />
        <Route
          path="reportes"
          element={
            <Guard permission="reports:read">
              <ReportsPage />
            </Guard>
          }
        />
        <Route
          path="auditoria"
          element={
            <Guard permission="audit:read">
              <AuditPage />
            </Guard>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
