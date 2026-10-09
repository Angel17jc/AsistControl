# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa **GitHub → Security → Report a vulnerability** (Security Advisories privados). Se responde en un plazo objetivo de 72 horas.

## Activos y amenazas

| Activo                                   | Amenaza principal                                                    | Controles                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registros de asistencia (base de nómina) | Manipulación para cobrar horas no trabajadas                         | Marcaciones inmutables; correcciones como eventos nuevos con justificación; auditoría append-only; horas extra requieren aprobación de otra persona (nadie aprueba lo propio)                                                                                                                                                   |
| Cuentas                                  | Fuerza bruta, robo de sesión                                         | argon2id (parámetros OWASP), rate limit 5/min en login, respuesta y tiempo idénticos ante usuario inexistente, access token de 15 min en memoria, refresh rotativo httpOnly con detección de reutilización, revocación al desactivar o restablecer la contraseña; cambiar la propia exige la actual y cierra las demás sesiones |
| Datos personales de empleados            | Acceso horizontal (un empleado ve a otros)                           | RBAC + **alcance por fila** en servicio y en salas de WebSocket                                                                                                                                                                                                                                                                 |
| Credenciales de dispositivos             | Exposición en BD, logs o API                                         | AES-256-GCM con IV aleatorio y autenticación; nunca se devuelven; `redact()` en auditoría; logs redactan `authorization`/`cookie`                                                                                                                                                                                               |
| Red de dispositivos                      | SSRF / escaneo interno                                               | Solo `ADMIN`/`SUPER_ADMIN` registran IPs; validación de host; timeouts por operación                                                                                                                                                                                                                                            |
| Exportaciones CSV                        | CSV/formula injection                                                | Celdas que empiezan con `= + - @` se neutralizan                                                                                                                                                                                                                                                                                |
| Correo de notificaciones                 | Credenciales SMTP expuestas, correo en claro, inyección de cabeceras | `SMTP_URL` solo por entorno (secreto); STARTTLS obligatorio en producción; los errores guardados son la respuesta del servidor, sin la URL; los nombres no pueden abrir una cabecera nueva (se eliminan saltos de línea); en el HTML todo dato se escapa y el único enlace es `APP_PUBLIC_URL`, que solo admite `http`/`https`  |
| Configuración                            | Despliegue inseguro                                                  | Validación de entorno al arrancar; producción rechaza secretos de ejemplo; simulador desactivable                                                                                                                                                                                                                               |

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

### Avisos de dependencias aceptados

Un aviso de `npm audit` se corrige si hay versión compatible. Si no la hay, se decide por escrito si es **alcanzable**: qué código vulnerable se ejecuta, con qué datos y en qué imagen. Los aceptados:

| Paquete                                                | Aviso                                                                 | Dónde vive                                                                                              | Por qué no es alcanzable                                                                                                                               | Se revisa cuando…                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `deepmerge-ts` < 8 (vía `@prisma/config` 6.19.x)       | GHSA-ggr8-5vv4-36mx, agotamiento de pila (alta)                       | Solo la imagen del migrador ([ADR 0013](adr/0013-migrations-as-a-job.md)), unos segundos por despliegue | Solo fusiona los archivos de configuración del propio Prisma en el CLI, nunca datos de usuarios. Forzar la 8.x con `overrides` rompe `prisma generate` | Salga una 6.x de Prisma que lo actualice, o al migrar a Prisma 7               |
| `js-yaml` 5.3.0 (fijado por `@nestjs/swagger` 11.4.7)  | GHSA-r3ph-w7gj-g6xm, CPU con claves de fusión vacías (moderada)       | Imagen de la API                                                                                        | El fallo está al **parsear** YAML; `@nestjs/swagger` solo llama a `jsyaml.dump()` para serializar el documento OpenAPI que genera la propia API        | Salga un `@nestjs/swagger` 11.x con `js-yaml` ≥ 5.4.1, o al migrar a NestJS 12 |
| `esbuild` 0.27.x (vía `tsup` 8.5.1, que exige `^0.27`) | Lectura de archivos desde el servidor de desarrollo en Windows (baja) | Solo desarrollo: empaqueta `packages/*`                                                                 | El fallo está en `esbuild --serve`; `tsup` solo compila, y Vite 8 usa Rolldown. Nunca llega a una imagen                                               | `tsup` admita `esbuild` ≥ 0.28.1                                               |

Comprobación: `npm audit --omit=dev` en el repositorio, y dentro de la imagen de la API (`docker run --rm --user root --entrypoint sh <imagen> -c 'cd /app && npm audit --omit=dev'`).

## Checklist de despliegue

- [ ] `NODE_ENV=production`, secretos generados (`JWT_*`, `DEVICE_SECRETS_KEY`) y guardados en un gestor de secretos
- [ ] `COOKIE_SECURE=true` y TLS terminado en el proxy
- [ ] `ENABLE_MOCK_DEVICES=false`, `SEED_DEMO_DATA=false`
- [ ] Si se usa correo: `SMTP_URL` en el gestor de secretos, con un usuario SMTP dedicado, y `APP_PUBLIC_URL` con la dirección HTTPS
- [ ] Contraseña de PostgreSQL fuerte; puerto 5432 no expuesto públicamente
- [ ] Backups automáticos de PostgreSQL y prueba de restauración
- [ ] Rotación de logs / envío a un colector
