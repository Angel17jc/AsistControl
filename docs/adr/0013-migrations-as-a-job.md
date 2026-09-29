# ADR 0013 — Migraciones como tarea aparte, no al arrancar la API

- **Estado:** aceptada · 2026-09-29

## Contexto

La imagen de la API aplicaba las migraciones en su _entrypoint_ (`prisma migrate deploy`) y luego arrancaba el servidor. Era simple, pero tenía tres costos:

- **La API cargaba el CLI de Prisma** y toda su cadena de dependencias (motores de esquema, `effect`, `@prisma/config`…): unos 140 MB que solo se usan unos segundos en cada despliegue, pero viven en el contenedor que corre 24/7. Esa cadena incluye además el `deepmerge-ts` vulnerable que se aceptó como riesgo ([`docs/security.md`](../security.md)).
- **Cada réplica intentaba migrar al arrancar.** Prisma lo serializa con un _advisory lock_, así que no se corrompe nada, pero migrar el esquema no es responsabilidad de cada instancia del servidor, y un arranque o un reinicio no debería poder cambiar la base de datos.
- Una migración fallida dejaba a la API en un bucle de reinicios, en vez de detener el despliegue antes de tocar el servicio.

## Decisión

- **Dos imágenes desde el mismo Dockerfile** (`infra/docker/api.Dockerfile`):
  - `migrator` (`--target migrator`): aplica las migraciones y, si `SEED_DEMO_DATA=true`, siembra los datos de demo; luego termina. Es la única imagen con el CLI de Prisma.
  - `runtime` (objetivo por defecto): solo el servidor, **sin el CLI**. `npm uninstall` no sirve: el CLI es un _peer_ opcional de `@prisma/client` que ya figura en el lockfile, y npm conserva un peer opcional que el lockfile lista. En su lugar, `infra/docker/runtime-lockfile.mjs` lo quita del lockfile **de esa imagen** y `npm ci` deja fuera todo lo que ya nadie alcanza, conservando lo compartido (p. ej. `dotenv`, que también usa la API). Es npm quien decide qué alcanza el grafo; no se borra nada a mano. Los scripts de instalación se omiten (el de la API ejecutaría `prisma generate` sin CLI): el cliente generado se copia desde la etapa de compilación, y `argon2` trae binarios precompilados.
- **Orden de despliegue:** primero el migrador hasta terminar con éxito, luego la API. En Docker Compose, el servicio `migrate` y `depends_on: condition: service_completed_successfully` en `api`. En Kubernetes, un `Job` previo al despliegue o un `initContainer`.
- **La prueba de humo** (`infra/docker/smoke-test.sh`, en la CI) ejecuta las dos imágenes en ese orden contra un PostgreSQL desechable, exige `/health` y un **inicio de sesión real** con el usuario de la demo (binario nativo de `argon2`, JWT y base de datos).

## Consecuencias

- La imagen de la API no puede migrar ni sembrar: si alguien la arranca sin haber ejecutado el migrador, el servidor encuentra el esquema desactualizado. Por eso la regla de orden va en el README y en `docker-compose.yml`.
- Una migración que falla detiene el despliegue en el migrador, con su error en el log, y la API anterior sigue sirviendo.
- Las migraciones deben seguir siendo compatibles hacia atrás con la versión de la API que está corriendo mientras se aplican (añadir antes de quitar), como ya exige cualquier despliegue sin corte.
