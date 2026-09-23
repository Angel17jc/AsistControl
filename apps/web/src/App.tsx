import type { Permission } from '@asistcontrol/shared';
import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { refreshSession } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { useAuth } from './stores/auth';

/**
 * Pages load on demand: the first render only ships the shell and the page in view.
 * It also keeps heavy dependencies out of the entry bundle (Recharts only reaches the
 * browser when the dashboard is opened). Login stays eager: it is the first screen.
 */
const AttendancePage = lazy(() =>
  import('./pages/AttendancePage').then((m) => ({ default: m.AttendancePage })),
);
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const ContractTypesPage = lazy(() =>
  import('./pages/ContractTypesPage').then((m) => ({ default: m.ContractTypesPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const DevicesPage = lazy(() =>
  import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })),
);
const EmployeesPage = lazy(() =>
  import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const RequestsPage = lazy(() =>
  import('./pages/RequestsPage').then((m) => ({ default: m.RequestsPage })),
);

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
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={status === 'authenticated' ? <AppShell /> : <Navigate to="/login" replace />}
        >
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
            path="contratos"
            element={
              <Guard permission="organization:read">
                <ContractTypesPage />
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
    </Suspense>
  );
}
