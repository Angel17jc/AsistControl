# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Added

- Driver ZKTECO (TCP 4370, experimental): protocolo, cliente TCP, adaptador con cursor incremental y servidor falso para pruebas.
- Zona horaria configurable por dispositivo (config.timezone).
- Driver HIKVISION (ISAPI + Digest, experimental), adaptado a terminales estrictos de la serie DS-K1A (#36, #109); diagnóstico `device:probe` de equipos reales, solo lectura (#55, #75, #109).
- Notificaciones en la campana y por correo (outbox con reintentos, preferencias por tipo) (#39, #40, #56, #58, #71-#73).
- Saldos de vacaciones calculados por tipo de contrato: devengo por aniversario, mensual o por año calendario, antigüedad, caducidad, medios días y anticipos (#42, #43, #51-#54, #60).
- Edición de empleados con baja y reincorporación; horarios por empleado con historial y deshacer (#45-#49).
- Administración desde la web: usuarios, Mi cuenta, organización y reglas de asistencia con recálculo (#77, #84-#88, #91); contraseña nueva obligatoria tras crearla o restablecerla un administrador (#101).
- Producción: `docker-compose.prod.yml`, comando `create-admin`, respaldo verificado con restauración y guía de despliegue (#105-#107).
- Corrección manual con vista previa de la jornada y registro de un día entero de una vez (#115).
- Presencia: tablero en vivo de quién está (#116).
- Tarjeta de tiempo por empleado con totales e impresión con firmas; almuerzo visible en las jornadas (#117).
- Ayuda en cada pantalla y en cada campo; los obligatorios llevan un asterisco rojo (#118, #120).
- Suite de navegador con Playwright en la CI (#35).

### Changed

- Imagen de la API más pequeña; migraciones como tarea de un solo uso fuera de la imagen (#61, #62).
- El recálculo de rangos procesa tres empleados a la vez y sin un evento en vivo por jornada (#90).

### Fixed

- Una marcación que no cae en ninguna jornada ya no se pierde en silencio: el día la reporta como «Marcación fuera de jornada» (#121).
- Cierre de sesión real con el token de acceso vencido (#85); la política de asistencia rechaza claves desconocidas (#89).
- Producción: el seed demo se salta en vez de fallar y las tareas programadas corren en la hora de la empresa (#104).

### Security

- nginx reemplaza `X-Forwarded-For`: ya no se esquiva el límite de intentos de inicio de sesión con una cabecera inventada (#103).
- Cuentas de supervisor y empleado exigen un empleado vinculado (#76).
- Parches de `body-parser`, `nodemailer`, `undici` y `fast-uri`; avisos aceptados y justificados en `docs/security.md` (#70, #108).

## [0.1.0] - 2026-09-21

### Added

- Monorepo (API NestJS, web React, `shared`, `biometric-core`), Docker Compose y CI.
- Abstracción `BiometricDeviceAdapter`, registro de drivers y simulador con inyección de fallos.
- Sincronización idempotente con cursor opaco, lock por dispositivo, reintentos y push en tiempo real.
- Motor de asistencia configurable (atrasos, salidas anticipadas, horas extra, ausencias, turnos nocturnos, feriados, permisos).
- Autenticación JWT con refresh rotativo, RBAC con alcance por fila, auditoría.
- Permisos/vacaciones, aprobación de horas extra, reportes CSV, dashboard en tiempo real.
