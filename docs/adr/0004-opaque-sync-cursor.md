# ADR 0004 — Cursor de sincronización opaco por adaptador

- **Estado:** aceptada · 2026-09-21 (reemplaza el cursor por timestamp de la primera versión)

## Contexto

La primera implementación guardaba "fecha de la última marcación descargada" y pedía al equipo los registros posteriores (con 5 min de solapamiento). Las pruebas de humo con el simulador mostraron que **se perdían marcaciones** cuando:

- el reloj del equipo se corrige hacia atrás (registros nuevos con hora anterior al cursor);
- se cargan registros históricos o el equipo estuvo fuera de hora;
- la memoria del equipo se borra y el contador vuelve a cero.

Perder una marcación afecta directamente la nómina.

## Decisión

- `SyncOptions.cursor` y `SyncResult.cursor` son **strings opacos** definidos por cada adaptador (índice de registro, secuencia, id). La plataforma solo los persiste y los devuelve.
- Si un adaptador no puede continuar desde el cursor (memoria borrada, cursor inválido/antiguo), **relee todo**; la deduplicación por `dedup_key` UNIQUE hace que releer sea seguro.
- El simulador usa `"<generación de memoria>:<índice>"`.
- Migración `device_sync_cursor_opaque`: la columna pasa a `TEXT` y los cursores de tiempo existentes se ponen en `NULL` (fuerza una relectura completa e idempotente).

## Consecuencias

- La corrección depende de la idempotencia, que ya es un invariante del sistema (probado en unit y e2e).
- Adaptadores cuyo protocolo solo permite filtrar por fecha deben aplicar su propia ventana de solapamiento.
