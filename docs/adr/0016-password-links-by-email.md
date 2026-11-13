# ADR 0016 — Enlaces por correo para elegir la contraseña

- **Estado:** aceptada · 2026-11-12

## Contexto

Quien olvidaba su contraseña dependía de un administrador: la restablecía con una contraseña temporal, se la pasaba por otro medio y la persona la cambiaba al entrar. Con unas 25 personas, y cuentas para cada empleado, eso es trabajo diario para quien administra y una contraseña viajando por WhatsApp. La empresa ya tiene Amazon SES para enviar correos, y AsistControl ya envía notificaciones por SMTP ([ADR 0011](0011-email-notifications.md)).

## Alternativas

1. **Códigos de 6 dígitos por correo.** Fáciles de dictar, pero cortos: exigen contar intentos por cuenta y bloquear, y siguen siendo adivinables con suficientes intentos.
2. **Enlace con un token en el buzón de salida de las notificaciones** (`EmailDelivery`), para heredar los reintentos. Obliga a guardar el token en claro en la base hasta que se envíe: quien lea la base tiene un enlace válido.
3. **Enlace con un token aleatorio largo, guardando solo su resumen, enviado en segundo plano.**

## Decisión

Se adopta la opción 3, para «olvidé mi contraseña» y para las invitaciones de cuentas nuevas.

- **Token de 32 bytes aleatorios** (base64url, 43 caracteres). La tabla `password_links` guarda su SHA-256, el propósito (`RESET` o `INVITE`), el vencimiento y cuándo se usó. El token solo existe en el correo.
- **Un solo uso y uno vigente por cuenta.** Usarlo, pedir otro, cambiar la contraseña por cualquier otra vía (desde «Mi cuenta» o un restablecimiento del administrador) o desactivar la cuenta lo invalidan. Al usarlo se cierran todas las sesiones de la cuenta.
- **Vence:** 30 minutos para recuperar (se pide y se usa en el momento) y 72 horas para una invitación (la persona puede verla al día siguiente).
- **La respuesta no delata cuentas.** `POST /auth/forgot-password` responde siempre 202 sin cuerpo, exista o no la cuenta, y el correo se envía después de responder, así que el tiempo de respuesta tampoco cambia. Límite de 5 pedidos por minuto por IP y un correo por cuenta por minuto. Cada pedido queda en la auditoría con el motivo si no se envió.
- **El token va después de `#`** (`/restablecer#token`): los navegadores no lo envían al servidor, así que no aparece en los registros de nginx ni en el `Referer`. La página lo lee una vez y lo borra de la barra de direcciones; lo manda a la API por `POST`.
- **Sin SMTP:** fuera de producción el correo se escribe en el registro de la API, para poder probar el recorrido sin configurar nada. En producción no, porque un registro no debe guardar enlaces válidos: la opción se apaga (`GET /auth/options` → `passwordLinks: false`) y la pantalla de inicio indica pedírsela a un administrador. También se apaga sin `APP_PUBLIC_URL`, porque no hay a dónde apuntar el enlace.
- **Reintentos en memoria:** tres intentos en unos 12 segundos. Si el servidor de correo falla más, la persona vuelve a pedirlo; no vale la pena un buzón persistente para un enlace de 30 minutos.

## Consecuencias

- Amazon SES se conecta por su interfaz SMTP (`SMTP_URL`, `MAIL_FROM` con un remitente verificado); no hace falta el SDK de AWS. Ver [despliegue](../deployment.md).
- En el modo de prueba de SES («sandbox») solo llegan correos a direcciones verificadas, hasta que Amazon habilite el envío a cualquiera.
- El correo de quien no tenga acceso a su buzón sigue necesitando a un administrador: el restablecimiento con contraseña temporal se mantiene.
