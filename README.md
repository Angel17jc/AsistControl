# AsistControl

**Plataforma empresarial de control de asistencia, jornadas laborales y sincronización con marcadores biométricos por red LAN.**

AsistControl recibe las marcaciones de los dispositivos biométricos de la empresa, las valida y deduplica, calcula cada jornada (horas trabajadas, atrasos, salidas anticipadas, ausencias, horas extra) según reglas **configurables**, y entrega esa información en tiempo real a un dashboard y en reportes listos para nómina.

El sistema **no depende de ningún fabricante**: cada marca se integra mediante un adaptador (`BiometricDeviceAdapter`). Incluye un **simulador de dispositivo** completo y drivers **ZKTeco** (TCP 4370) y **Hikvision** (ISAPI sobre HTTP con Digest), ambos experimentales, por lo que todo el producto funciona y se prueba sin hardware.

[![CI](https://github.com/Angel17jc/AsistControl/actions/workflows/ci.yml/badge.svg)](https://github.com/Angel17jc/AsistControl/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Angel17jc/AsistControl/actions/workflows/codeql.yml/badge.svg)](https://github.com/Angel17jc/AsistControl/actions/workflows/codeql.yml)

---

## Contenido

- [Funcionalidades](#funcionalidades)
- [Arquitectura](#arquitectura)
- [Stack tecnológico](#stack-tecnológico)
- [Inicio rápido](#inicio-rápido)
- [Variables de entorno](#variables-de-entorno)
- [Docker](#docker)
- [Base de datos](#base-de-datos)
- [Desarrollo](#desarrollo)
- [Testing](#testing)
- [API](#api)
- [Integración de dispositivos y simulador](#integración-de-dispositivos-y-simulador)
- [Seguridad](#seguridad)
- [Contribuir](#contribuir)
- [Roadmap](#roadmap)
- [Licencia](#licencia)

## Funcionalidades

| Área                      | Qué hace                                                                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dispositivos**          | Registro de marcadores por IP/puerto, prueba de conexión (latencia y desfase de reloj), credenciales cifradas (AES-256-GCM), estados `ONLINE / OFFLINE / SYNCING / ERROR / DISABLED`.                                                                                                                                |
| **Sincronización**        | Descarga incremental con cursor opaco por adaptador, validación, normalización, deduplicación idempotente, reintentos con backoff, bloqueo por dispositivo entre instancias, historial de cada ejecución (`DeviceSyncLog`). Push en tiempo real + polling programado como red de seguridad.                          |
| **Asistencia**            | Separación entre **marcaciones** (`AttendanceEvent`, inmutables) y **jornadas** (`AttendanceRecord`, derivadas y recalculables). Atrasos, salida anticipada, almuerzo, horas extra, ausencias, jornadas incompletas, dobles marcaciones, marcaciones fuera de horario, feriados, días libres y **turnos nocturnos**. |
| **Correcciones**          | Marcaciones manuales con justificación obligatoria y anulación (nunca borrado), todo auditado.                                                                                                                                                                                                                       |
| **Horarios**              | Turnos reutilizables, horarios semanales, historial de asignaciones por empleado (un cambio de horario no reescribe el pasado), feriados.                                                                                                                                                                            |
| **Permisos y vacaciones** | Flujo único de solicitud → aprobación; al aprobar se recalculan los días afectados (un permiso de mañana mueve la hora esperada de llegada).                                                                                                                                                                         |
| **Horas extra**           | Propuestas automáticamente por el motor, **aprobadas por una persona** antes de llegar a nómina.                                                                                                                                                                                                                     |
| **Reportes**              | Diario, mensual (nómina), atrasos, ausencias, horas extra, marcaciones y sincronización. Exportación CSV segura para Excel.                                                                                                                                                                                          |
| **Dashboard**             | Presentes, atrasados, ausentes, permisos, horas extra del mes, dispositivos en línea, marcaciones por hora y feed en vivo por WebSocket.                                                                                                                                                                             |
| **Seguridad**             | JWT de corta duración + refresh token rotativo en cookie httpOnly con detección de reutilización, argon2id, RBAC por permisos, **alcance por fila** (supervisor → su equipo, empleado → sí mismo), rate limiting, validación estricta, auditoría inmutable.                                                          |

## Arquitectura

```mermaid
flowchart LR
  subgraph LAN
    D1[Marcador ZKTeco] --> A2
    D3[Terminal Hikvision] --> A3
    D2[Marcador simulado] --> A1
  end
  subgraph API[API NestJS]
    A1[MockDeviceAdapter] --> CM[DeviceConnectionManager]
    A2[ZKTecoAdapter] --> CM
    A3[HikvisionAdapter] --> CM
    CM --> SYNC[DeviceSyncService<br/>validar · normalizar · deduplicar]
    SYNC --> ATT[AttendanceProcessingService]
    ATT --> CALC[[calculateAttendance<br/>dominio puro]]
    ATT --> DB[(PostgreSQL)]
    ATT --> RT[RealtimeGateway]
  end
  RT -- Socket.IO --> WEB[Dashboard React]
  WEB -- REST + JWT --> API
```

Monorepo con npm workspaces:

```
apps/
  api/                 NestJS: REST + WebSocket, Prisma, dominio de asistencia
  web/                 React + Vite: dashboard y operación
packages/
  shared/              Contratos compartidos: enums de dominio, matriz RBAC, eventos en tiempo real
  biometric-core/      Interfaz BiometricDeviceAdapter, errores tipados, registro de drivers y simulador
infra/docker/          Dockerfiles, nginx, entrypoint
docs/                  Arquitectura, API, BD, dispositivos, seguridad, ADRs
.github/               CI, CodeQL, Dependabot, plantillas de issues/PR, CODEOWNERS
```

Detalle completo en [`docs/architecture.md`](docs/architecture.md).

## Stack tecnológico

| Capa     | Tecnología                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------- |
| Backend  | Node.js 22, NestJS 11, TypeScript 5.9, Socket.IO, Swagger/OpenAPI, pino                             |
| Datos    | PostgreSQL 17, Prisma 6                                                                             |
| Frontend | React 19, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query 5, Zustand (solo sesión), Recharts |
| Testing  | Jest + Supertest (API, e2e contra PostgreSQL real), Vitest + Testing Library (web y paquetes)       |
| DevOps   | Docker multi-stage, Docker Compose, GitHub Actions, CodeQL, Dependabot                              |

Se eligieron las últimas versiones **estables y maduras** de cada familia en lugar de majors recién publicadas; Dependabot propone las actualizaciones agrupadas (ver [ADR 0001](docs/adr/0001-monorepo-and-stack.md)).

## Inicio rápido

Requisitos: **Docker** (para todo el stack) o **Node.js ≥ 22.12** + Docker (para desarrollo).

```bash
git clone https://github.com/Angel17jc/AsistControl.git
cd AsistControl
docker compose up -d
```

Abrir <http://localhost:8080> e ingresar con un usuario de demo (contraseña `AsistControl2026`):

| Rol                 | Usuario                         |
| ------------------- | ------------------------------- |
| Super administrador | `admin@asistcontrol.local`      |
| Talento humano      | `rrhh@asistcontrol.local`       |
| Supervisor          | `supervisor@asistcontrol.local` |
| Empleado            | `angel@asistcontrol.local`      |

**Recorrido de demo (2 minutos):** Dispositivos → _Generar jornada_ (escenario _Mixto_) → _Sincronizar_ → Dashboard y Asistencia muestran los cálculos. Active _Marcaciones en vivo_ y observe el dashboard actualizarse solo; pulse _Desconectar equipo_ y sincronice para ver el manejo de fallos.

## Variables de entorno

La API valida su configuración al arrancar y **se niega a iniciar** si falta algo o, en producción, si detecta secretos de ejemplo. Referencia completa en [`apps/api/.env.example`](apps/api/.env.example).

| Variable                                             | Descripción                                                       | Por defecto             |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| `DATABASE_URL`                                       | Conexión PostgreSQL                                               | — (obligatoria)         |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`           | Secretos distintos, ≥ 32 caracteres                               | — (obligatorias)        |
| `JWT_ACCESS_TTL_SECONDS` / `JWT_REFRESH_TTL_SECONDS` | Vida de los tokens                                                | `900` / `604800`        |
| `DEVICE_SECRETS_KEY`                                 | Clave AES-256 (32 bytes base64) para credenciales de dispositivos | — (obligatoria)         |
| `APP_TIMEZONE`                                       | Zona horaria IANA de la empresa                                   | `America/Guayaquil`     |
| `DEVICE_SYNC_INTERVAL_SECONDS`                       | Polling de dispositivos (`0` = desactivado)                       | `300`                   |
| `ENABLE_MOCK_DEVICES`                                | Habilita el driver `MOCK` y el simulador                          | `true`                  |
| `CORS_ORIGINS`                                       | Orígenes permitidos (coma)                                        | `http://localhost:5173` |
| `COOKIE_SECURE`                                      | Cookie de refresh solo por HTTPS                                  | `false`                 |
| `LOG_LEVEL` / `LOG_FORMAT`                           | Nivel y formato (`json` / `pretty`)                               | `info` / `json`         |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT`            | Rate limiting global                                              | `60` / `120`            |

Para Docker Compose se puede crear un `.env` en la raíz a partir de [`.env.example`](.env.example).

## Docker

| Servicio   | Puerto | Descripción                                                              |
| ---------- | ------ | ------------------------------------------------------------------------ |
| `postgres` | 5432   | PostgreSQL 17 con volumen persistente                                    |
| `api`      | 3000   | Aplica migraciones, siembra datos de demo (opcional) y arranca la API    |
| `web`      | 8080   | nginx: sirve la SPA y hace proxy de `/api` y `/socket.io` (mismo origen) |
| `pgadmin`  | 5050   | Opcional: `docker compose --profile tools up -d`                         |

```bash
docker compose up -d            # levantar
docker compose logs -f api      # logs estructurados de la API
docker compose down             # detener (conserva datos)
```

Las imágenes son multi-stage: la de la API no contiene código fuente ni dependencias de desarrollo y corre como usuario sin privilegios.

## Base de datos

Modelo, decisiones y diagrama ER en [`docs/database.md`](docs/database.md).

```bash
npm run db:migrate    # crear/aplicar migraciones en desarrollo
npm run db:seed       # datos de demo (idempotente; bloqueado en producción)
```

## Desarrollo

```bash
npm install
npm run build:packages                       # compila shared y biometric-core
cp apps/api/.env.example apps/api/.env
docker compose up -d postgres
npm run db:migrate && npm run db:seed
npm run dev:api                              # http://localhost:3000  (docs en /api/docs)
npm run dev:web                              # http://localhost:5173  (proxy a la API)
```

| Script                                  | Qué hace                                    |
| --------------------------------------- | ------------------------------------------- |
| `npm run lint` / `npm run format:check` | ESLint (0 warnings) y Prettier              |
| `npm run typecheck`                     | TypeScript estricto en todos los workspaces |
| `npm test`                              | Tests unitarios de todo el monorepo         |
| `npm run test:e2e`                      | Tests e2e de la API contra PostgreSQL       |
| `npm run test:ui`                       | Tests de navegador (Playwright)             |
| `npm run build`                         | Build de producción de todo                 |

## Testing

| Suite                 | Herramienta                   | Cubre                                                                                                                                                                                                                                                                                                          |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motor de asistencia   | Jest                          | Ejemplo del enunciado, tolerancias, atrasos, salida anticipada, horas extra (dos bases de cálculo), almuerzo no marcado, dobles marcaciones, entrada sin salida, salida sin entrada, jornada en curso, ausencia, permisos parciales y totales, días libres, feriados, empleado sin horario, **turno nocturno** |
| Pipeline de ingesta   | Jest                          | Validación, normalización, duplicados en lote e idempotencia entre lotes, relojes adelantados, datos corruptos                                                                                                                                                                                                 |
| Seguridad             | Jest                          | RBAC, cifrado de credenciales, validación de entorno, CSV injection                                                                                                                                                                                                                                            |
| Simulador / adaptador | Vitest                        | Conexión, timeouts, pérdida de conexión, errores de protocolo, cursor incremental, memoria borrada, reloj retrasado, push en tiempo real                                                                                                                                                                       |
| API e2e               | Jest + Supertest + PostgreSQL | Login, rotación y robo de refresh token, 401/403, alcance por rol, sincronización completa con fallos inyectados, sync concurrente, empleados no enrolados, correcciones, permisos, horas extra, reportes CSV                                                                                                  |
| Web                   | Vitest + Testing Library      | Cliente API (refresh único ante 401 concurrentes), login, componentes del dashboard                                                                                                                                                                                                                            |
| Navegador (UI e2e)    | Playwright + Chromium         | Sesión con cookie de refresco y recarga, menú y rutas por rol, alta de marcador, prueba de conexión, generación y descarga de jornada, idempotencia, equipo desconectado, marcaciones en vivo por WebSocket, descarga de CSV, uso en teléfono                                                                  |

```bash
npm test
docker compose up -d postgres && docker compose exec postgres createdb -U asistcontrol asistcontrol_test
TEST_DATABASE_URL=postgresql://asistcontrol:asistcontrol@localhost:5432/asistcontrol_test npm run test:e2e

# Navegador: compila, levanta API + bundle web y ejecuta Chromium contra una base propia
npx playwright install chromium
npm run test:ui
```

Los tests de navegador usan su propia base de datos (`asistcontrol_ui_test`), la migran y la
siembran antes de arrancar la API; nunca tocan la de desarrollo. Detalles en
[`apps/e2e/README.md`](apps/e2e/README.md).

## API

- Swagger/OpenAPI interactivo: **<http://localhost:3000/api/docs>**
- Health check: `GET /health` → `{ "status": "ok", "database": "connected", ... }`
- Guía de endpoints, autenticación, errores y tiempo real: [`docs/api.md`](docs/api.md)

## Integración de dispositivos y simulador

Toda integración implementa:

```ts
interface BiometricDeviceAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<boolean>;
  getDeviceInfo(): Promise<DeviceInfo>;
  getUsers(): Promise<DeviceUser[]>;
  getAttendanceLogs(from: Date, to: Date): Promise<AttendanceLog[]>;
  sync(options?: { cursor?: string | null }): Promise<SyncResult>;
  onAttendanceLog?(listener): Unsubscribe; // si el equipo hace push
}
```

El **simulador** reproduce un marcador real: usuarios enrolados, memoria de marcaciones, jornadas por escenario (puntual, atrasos, horas extra, salida olvidada, sin almuerzo, doble marcación, ausencia), turnos nocturnos, desconexión, timeouts, errores de protocolo, pérdida de conexión a mitad de la descarga, lecturas duplicadas, latencia, desfase de reloj y marcaciones en vivo.

Cómo añadir un fabricante: [`docs/device-integration.md`](docs/device-integration.md).

## Seguridad

Resumen del modelo de amenazas y controles en [`docs/security.md`](docs/security.md). Las vulnerabilidades se reportan de forma **privada** mediante _GitHub Security Advisories_.

## Contribuir

Flujo trunk-based con ramas cortas, Conventional Commits, PRs con CI obligatorio y squash merge. Ver [`docs/contributing.md`](docs/contributing.md).

## Roadmap

- [x] Núcleo: adaptadores, simulador, sincronización idempotente, motor de asistencia, RBAC, auditoría, reportes, dashboard en tiempo real
- [x] Adaptador **ZKTeco** (TCP 4370) — experimental, pendiente de validar con hardware
- [x] Adaptador **Hikvision** (ISAPI + Digest) — experimental, pendiente de validar con hardware
- [ ] Recepción _push_ HTTP (ADMS/iclock) para equipos en la nube
- [ ] Saldos de vacaciones y políticas por tipo de contrato
- [ ] Notificaciones (dispositivo desconectado, solicitudes pendientes) por correo/in-app
- [ ] Exportación directa a formatos de nómina y PDF firmado
- [ ] Multi-empresa / multi-sede con zonas horarias por sede
- [ ] Métricas Prometheus y trazas OpenTelemetry
- [ ] E2E de interfaz con Playwright

## Licencia

[MIT](LICENSE)
