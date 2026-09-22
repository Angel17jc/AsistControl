# ADR 0005 — Marcaciones inmutables, jornadas derivadas y recalculables

- **Estado:** aceptada · 2026-09-21

## Contexto

La asistencia se corrige constantemente: marcaciones olvidadas, permisos aprobados después, feriados cargados tarde, cambios de horario retroactivos, empleados enrolados después de marcar. Si la jornada se calculara una sola vez al recibir cada marcación, cada corrección exigiría lógica especial y el resultado dependería del orden de llegada.

## Decisión

- `AttendanceEvent` es la **fuente de verdad** e inmutable. Correcciones = eventos `MANUAL` nuevos con justificación; errores = anulación (`voided_at`), nunca borrado ni edición.
- `AttendanceRecord` es una **proyección**: `calculateAttendance` es una función pura y `AttendanceProcessingService.recompute*` la aplica a una jornada completa (idempotente, upsert por empleado+fecha).
- Cualquier cambio que afecte un día dispara su recálculo: nueva marcación, anulación, vinculación de marcaciones huérfanas, aprobación/cancelación de permisos, asignación de horario retroactiva, alta/baja de feriado, o `POST /attendance/recompute`.
- `is_final` distingue jornadas abiertas; un job horario las cierra y crea las ausencias (retrocede 7 días para tolerar caídas del servicio).
- Las horas extra aprobadas/rechazadas son decisiones humanas y **no** se sobrescriben al recalcular (se registra un warning si difieren).

## Consecuencias

- El histórico se puede reconstruir y auditar.
- Recalcular rangos grandes cuesta consultas; `WorkCalendar` precarga horarios y feriados para mantenerlo acotado. Si crece el volumen, el recálculo pasará a una cola de trabajos.
