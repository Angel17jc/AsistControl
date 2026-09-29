# ADR 0011 — Notificaciones por correo: un canal más, con outbox

- **Estado:** aceptada · 2026-09-29
- **Amplía:** [ADR 0007](0007-notifications.md)

## Contexto

Las notificaciones ([ADR 0007](0007-notifications.md)) solo se ven dentro de la aplicación. Un equipo caído un sábado o una solicitud de vacaciones pendiente no llegan a nadie que no tenga AsistControl abierto. El correo resuelve eso, pero trae sus propios problemas:

- un servidor SMTP puede ser lento, rechazar temporalmente o caerse, y **nada de eso puede bloquear ni deshacer** una sincronización o una aprobación;
- con varias instancias de la API, cada correo debe salir **una sola vez**;
- activar el correo en una instalación con meses de uso **no debe enviar el histórico**;
- nadie quiere un correo de algo que ya vio en la aplicación.

## Decisión

- **Un canal más de las mismas notificaciones.** Mismos destinatarios, mismos datos y mismas reglas del ADR 0007; no hay un sistema de avisos paralelo. El texto del correo lo redacta la API, como otro cliente de los datos (`notifications/email/notification-email.ts`, función pura con `switch` exhaustivo: un tipo nuevo sin su correo no compila). Solo texto plano por ahora.
- **Outbox transaccional.** Cada notificación creada con el correo activo se guarda **en la misma transacción** con su fila `EmailDelivery` (`PENDING`). La entrega es de otra tabla, no de la notificación: la notificación es el hecho, y cada canal lleva su estado de entrega.
- **Un worker envía** (`EMAIL_DISPATCH_INTERVAL_SECONDS`, 30 s): toma lo pendiente cuyo momento llegó y lo **reclama fila a fila** con una actualización condicional, el mismo patrón que `syncLockedAt` en la sincronización. Solo la instancia cuya actualización coincidió envía; un reclamo de más de 5 minutos es de una instancia caída y se puede retomar.
- **Reintentos con backoff:** 1, 5, 15 y 60 minutos; tras el quinto fallo, `FAILED` con el error del servidor en `detail`. Sin _jitter_: con pocos correos por minuto no hace falta suavizar y los tests pueden afirmar horas exactas.
- **Se omite (`SKIPPED`) lo que ya no hace falta enviar:** notificación leída en la aplicación antes del envío, usuario inactivo o que desactivó los correos (`User.emailNotifications`, se consulta al enviar y vale también para lo ya encolado), y lo pendiente de más de 24 horas.
- **Apagado por defecto.** Sin `SMTP_URL` no se encola nada, así que activarlo después no envía el histórico. `MAIL_FROM` es obligatorio con `SMTP_URL` (se valida al arrancar). En producción, `smtp://` exige STARTTLS; `smtps://` usa TLS implícito. Timeouts explícitos de conexión, saludo y socket.
- **Transporte como puerto** (`MailTransport`): SMTP con nodemailer en producción, uno en memoria en los tests e2e.
- Cada usuario ve y cambia su preferencia en `GET/PATCH /notifications/preferences`, que también dice si el servidor tiene correo configurado (`emailAvailable`).

## Consecuencias

- Una notificación nunca espera al correo, y un fallo de SMTP queda registrado y reintentado sin intervención.
- El texto vive en dos lugares (web y correo). Se acepta: son dos medios con necesidades distintas y los dos `switch` exhaustivos obligan a mantenerlos al día.
- Los correos caen con la notificación: la retención de 90 días borra ambas (cascada).
- **Fuera de alcance por ahora:** correo en HTML, preferencias por tipo de notificación, resúmenes diarios y proveedores por API (SES, SendGrid), que serían otra implementación de `MailTransport`.
