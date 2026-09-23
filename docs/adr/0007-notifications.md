# ADR 0007 — Notificaciones: datos por destinatario, un aviso por incidente

- **Estado:** aceptada · 2026-09-23

## Contexto

Hay hechos que alguien debe atender y que hoy solo se ven si se entra a buscarlos: un marcador que dejó de responder o una solicitud de permiso pendiente de revisión. Tres cuestiones de diseño condicionan la solución:

1. **Un marcador caído falla en cada sondeo.** Con el intervalo por defecto (5 min), un corte de una noche son más de cien sincronizaciones fallidas. Notificar cada fallo convertiría la campana en ruido y enseñaría a ignorarla.
2. **El texto depende del idioma y del cliente.** La interfaz está en español, la API responde en inglés y mañana puede haber otro cliente (móvil, correo).
3. **El destinatario es cuestión de permisos.** No todos deben enterarse de todo: RRHH no administra dispositivos y un supervisor solo revisa a su equipo.

## Decisión

- **Una fila por destinatario** (`notifications.user_id`), con su propio estado de lectura. Los destinatarios se resuelven **al ocurrir el hecho**, a partir de la matriz RBAC (`rolesWith(permiso)`) y del alcance por fila:
  - `DEVICE_DOWN` / `DEVICE_RECOVERED` → usuarios activos con `devices:sync`, es decir, quienes pueden actuar sobre el equipo.
  - `LEAVE_REQUESTED` → roles con `leave:approve` sin restricción de alcance, más el supervisor directo del empleado. Se excluyen el propio empleado y quien presentó la solicitud.
  - `LEAVE_REVIEWED` → el empleado y quien presentó la solicitud, salvo el revisor.
- **Datos, no frases.** Se guarda `type` + `data` (JSON con forma fija por tipo, `NotificationDataByType` en `packages/shared`), y cada cliente redacta el texto. La API sigue siendo neutral respecto al idioma.
- **Un aviso por incidente.** Un incidente de un dispositivo empieza en su último contacto correcto (`lastSeenAt`). Se notifica `DEVICE_DOWN` solo si no existe ya uno posterior a ese instante, y `DEVICE_RECOVERED` solo si hubo un `DEVICE_DOWN` en ese incidente. Un equipo que nunca respondió (`lastSeenAt` nulo) no "se cayó": no se notifica.
- **Entrega en vivo** por Socket.IO a la sala `user:<id>`, a la que cada socket se une al autenticarse. Solo el destinatario la recibe.
- **Mejor esfuerzo.** La acción de negocio (sincronizar, aprobar) ya ocurrió: un fallo al notificar se registra en el log y nunca la revierte ni la bloquea.
- **Retención de 90 días**, leídas o no: son avisos, no registros. El historial de lo ocurrido es la auditoría.

## Consecuencias

- La campana solo muestra lo que cada persona puede atender, y un corte largo produce dos avisos: uno al caer y otro al volver.
- Cambiar de rol no retira avisos ya enviados, porque el destinatario se fijó al ocurrir el hecho. Es aceptable para mensajes con 90 días de vida.
- Traducir o cambiar el texto no exige migrar datos. A cambio, cada cliente debe conocer los tipos; el tipado de `AppNotification` hace que añadir un tipo sin su redacción no compile en la web.
- Se añaden notificaciones nuevas implementando un productor en `NotificationsService` y su redacción en el cliente. Candidatas: horas extra por aprobar, jornadas incompletas del equipo.
