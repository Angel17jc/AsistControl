# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [Unreleased]

## [0.1.0] - 2026-09-21

### Added

- Monorepo (API NestJS, web React, `shared`, `biometric-core`), Docker Compose y CI.
- Abstracción `BiometricDeviceAdapter`, registro de drivers y simulador con inyección de fallos.
- Sincronización idempotente con cursor opaco, lock por dispositivo, reintentos y push en tiempo real.
- Motor de asistencia configurable (atrasos, salidas anticipadas, horas extra, ausencias, turnos nocturnos, feriados, permisos).
- Autenticación JWT con refresh rotativo, RBAC con alcance por fila, auditoría.
- Permisos/vacaciones, aprobación de horas extra, reportes CSV, dashboard en tiempo real.
