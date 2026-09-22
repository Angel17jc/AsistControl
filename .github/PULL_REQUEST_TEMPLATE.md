## Qué cambia y por qué

<!-- El problema de negocio o técnico que resuelve. Enlaza el issue: Closes #123 -->

## Cómo se probó

- [ ] Tests unitarios nuevos o actualizados
- [ ] Tests e2e (si toca API, base de datos o sincronización)
- [ ] Probado manualmente (describe el escenario, p. ej. simulador con dispositivo desconectado)

## Checklist

- [ ] El título del PR sigue Conventional Commits (`feat(attendance): …`)
- [ ] `npm run lint`, `npm run typecheck` y `npm test` pasan en local
- [ ] Si cambia el esquema: hay migración de Prisma y `docs/database.md` está actualizado
- [ ] Si cambia una regla laboral: es configurable (no hay valores fijos en código) y está documentada
- [ ] Si cambia un endpoint: Swagger (`@ApiOperation`, DTOs) y `docs/api.md` están actualizados
- [ ] No se exponen secretos, credenciales de dispositivos ni datos sensibles en respuestas o logs
- [ ] Las acciones sensibles quedan registradas en auditoría

## Capturas / notas para el revisor

<!-- Opcional -->
