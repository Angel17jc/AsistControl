# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa **GitHub → Security → Report a vulnerability** (Security Advisories privados). Se responde en un plazo objetivo de 72 horas.

## Activos y amenazas

| Activo                                   | Amenaza principal                            | Controles                                                                                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registros de asistencia (base de nómina) | Manipulación para cobrar horas no trabajadas | Marcaciones inmutables; correcciones como eventos nuevos con justificación; auditoría append-only; horas extra requieren aprobación de otra persona (nadie aprueba lo propio)                                                                             |
| Cuentas                                  | Fuerza bruta, robo de sesión                 | argon2id (parámetros OWASP), rate limit 5/min en login, respuesta y tiempo idénticos ante usuario inexistente, access token de 15 min en memoria, refresh rotativo httpOnly con detección de reutilización, revocación al desactivar o cambiar contraseña |
| Datos personales de empleados            | Acceso horizontal (un empleado ve a otros)   | RBAC + **alcance por fila** en servicio y en salas de WebSocket                                                                                                                                                                                           |
| Credenciales de dispositivos             | Exposición en BD, logs o API                 | AES-256-GCM con IV aleatorio y autenticación; nunca se devuelven; `redact()` en auditoría; logs redactan `authorization`/`cookie`                                                                                                                         |
| Red de dispositivos                      | SSRF / escaneo interno                       | Solo `ADMIN`/`SUPER_ADMIN` registran IPs; validación de host; timeouts por operación                                                                                                                                                                      |
| Exportaciones CSV                        | CSV/formula injection                        | Celdas que empiezan con `= + - @` se neutralizan                                                                                                                                                                                                          |
| Configuración                            | Despliegue inseguro                          | Validación de entorno al arrancar; producción rechaza secretos de ejemplo; simulador desactivable                                                                                                                                                         |

## Controles transversales

- **Seguro por defecto**: guard JWT global; solo `@Public()` abre una ruta (`/health`, login, refresh).
- **Validación estricta**: `whitelist` + `forbidNonWhitelisted`; campos desconocidos → 400 (evita mass assignment de `role`, etc.).
- **Errores sin filtraciones**: filtro global; los 500 no exponen stack, SQL ni rutas; `requestId` para correlación.
- **Cabeceras**: `helmet` en la API; nginx añade `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`; `server_tokens off`.
- **CORS** restringido a `CORS_ORIGINS`; en Docker el navegador usa un único origen (nginx proxy), por lo que la cookie `SameSite=Strict` no necesita CORS.
- **Privilegios**: solo `SUPER_ADMIN` crea/modifica administradores; nadie puede cambiarse su propio rol ni desactivarse.
- **Contenedores**: imágenes multi-stage, la API corre como usuario `node`, sin dependencias de desarrollo.
- **Cadena de suministro**: `npm ci` con lockfile, Dependabot, CodeQL (`security-extended`), CODEOWNERS en áreas críticas.

## Decisiones conscientes (trade-offs)

- El access token es _stateless_: tras revocar una sesión puede seguir siendo válido hasta 15 min. Se acepta por rendimiento; reducir `JWT_ACCESS_TTL_SECONDS` si el riesgo lo requiere.
- El rate limiting es en memoria por instancia. Con varias réplicas debe usarse un store compartido (Redis) — roadmap.
- `COOKIE_SECURE=true` es obligatorio detrás de HTTPS en producción.

## Checklist de despliegue

- [ ] `NODE_ENV=production`, secretos generados (`JWT_*`, `DEVICE_SECRETS_KEY`) y guardados en un gestor de secretos
- [ ] `COOKIE_SECURE=true` y TLS terminado en el proxy
- [ ] `ENABLE_MOCK_DEVICES=false`, `SEED_DEMO_DATA=false`
- [ ] Contraseña de PostgreSQL fuerte; puerto 5432 no expuesto públicamente
- [ ] Backups automáticos de PostgreSQL y prueba de restauración
- [ ] Rotación de logs / envío a un colector
