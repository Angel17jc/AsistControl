# ADR 0006 — Permisos y vacaciones en un único flujo

- **Estado:** aceptada · 2026-09-21

## Contexto

Se pidieron las entidades `PermissionRequest` y `VacationRequest`. Ambas tienen el mismo ciclo (solicitada → aprobada/rechazada/cancelada), los mismos actores y el mismo efecto sobre la asistencia (justifican ausencia total o parcial). Además, "Permission" ya significa permiso RBAC en el código.

## Decisión

Una sola entidad `LeaveRequest` con `type: PERSONAL | MEDICAL | VACATION | OTHER` e intervalo `startsAt`–`endsAt` en instantes (sirve para permisos de horas y para días completos).

## Consecuencias

- Un único flujo de aprobación, una única integración con el motor de asistencia.
- Reglas propias de vacaciones (saldo, acumulación, días hábiles) se implementarán como política sobre `type = VACATION` sin cambiar el modelo base (roadmap).
