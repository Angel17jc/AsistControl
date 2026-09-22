# ADR 0003 — Roles fijos, permisos en código y alcance por fila

- **Estado:** aceptada · 2026-09-21

## Contexto

Se requieren cinco roles (SUPER_ADMIN, ADMIN, HR, SUPERVISOR, EMPLOYEE). Un modelo de tablas `Role`/`Permission`/`RolePermission` permitiría roles personalizados, pero hoy no hay ese requisito y agrega joins, administración y superficie de error.

Además, RBAC no basta: un supervisor puede "leer asistencia", pero solo la de su equipo.

## Decisión

- Roles como enum de Postgres; permisos granulares (`attendance:read`, `devices:sync`, …) y la matriz rol→permisos en `packages/shared/src/rbac.ts`, compartida con el frontend (que solo la usa para ocultar UI).
- `@RequirePermissions()` + `PermissionsGuard` global (exige **todos** los permisos listados).
- `AccessScopeService` traduce el usuario a un filtro Prisma (`self + subordinados` / `self`) aplicado en servicios y en las salas de WebSocket.
- Reglas de privilegio explícitas: solo SUPER_ADMIN gestiona administradores; nadie aprueba sus propias solicitudes ni horas extra.

## Consecuencias

- Cambiar permisos requiere un despliegue (auditable en Git y revisado por CODEOWNERS).
- Si se necesitan roles personalizados, se migrará la matriz a tablas manteniendo los mismos nombres de permiso.
