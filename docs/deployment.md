# Despliegue en una empresa

Guía para instalar, operar y actualizar AsistControl en producción con `docker-compose.prod.yml`.

Los comandos de Docker Compose, el primer administrador, las comprobaciones, el respaldo, la
**restauración**, la actualización y la generación de secretos se ejecutaron tal cual en un ensayo de
despliegue en producción (2026-10-26). No se pudieron ejecutar aquí, porque dependen del servidor o de
cuentas de la empresa: la instalación de Docker en Ubuntu, el clonado en `/opt`, el `crontab`, el
reinicio del servidor, las comprobaciones desde otro PC y el túnel de Cloudflare. El modo interactivo de
`create-admin` se probó con una terminal simulada.

## 1. Dónde instalarlo

**El servidor tiene que alcanzar el marcador por red**: la API lo **consulta** por su IP cada 5 minutos
(no es el marcador el que envía las marcaciones). Por eso lo recomendado es un equipo **en la misma red
que el marcador**, con acceso desde fuera opcional mediante un túnel (§6).

Un servicio en la nube no sirve tal cual (el servidor no llegaría a la red de la empresa), y
plataformas como Vercel tampoco: AsistControl es un proceso permanente con tareas de fondo y WebSocket.

### Requisitos (medidos)

| Recurso | Mínimo                                                    | Recomendado | Por qué                                                            |
| ------- | --------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| CPU     | 2 núcleos                                                 | 2–4         | En reposo ≈ 0 %; el recálculo de jornadas usa 3 consultas a la vez |
| RAM     | 2 GB                                                      | 4 GB        | La pila usa ≈ 120 MB en reposo; el resto es SO, Postgres y margen  |
| Disco   | 20 GB                                                     | 40 GB SSD   | Imágenes ≈ 400 MB; datos ≈ 150 MB/año con 200 personas; respaldos  |
| SO      | **Linux** (Ubuntu Server 24.04 LTS o Debian 12)           | —           | Docker Engine arranca solo al encender y no requiere licencia      |
| Red     | **IP fija**, misma red que el marcador; salida a internet | —           | Consultar el marcador; descargar actualizaciones                   |
| Reloj   | NTP activo                                                | —           | Jornadas, atrasos y avisos dependen de la hora                     |

**Windows con Docker Desktop no es recomendable para un servidor:** Docker Desktop solo arranca cuando
un usuario inicia sesión (tras un corte de luz el sistema no vuelve solo), y es de pago en empresas con
250 empleados o más, o con más de 10 M USD de facturación anual
([licencia](https://docs.docker.com/subscription-billing/desktop-license/)). Docker Engine en Linux no
tiene esas limitaciones.

### Puertos

| Dirección                     | Puerto                   | Para qué                                                   |
| ----------------------------- | ------------------------ | ---------------------------------------------------------- |
| Usuarios → servidor           | 80 (o el de `HTTP_PORT`) | La web y la API, por el mismo origen                       |
| Servidor → marcador Hikvision | 80 (ISAPI)               | Leer marcaciones                                           |
| Servidor → marcador ZKTeco    | 4370 TCP                 | Leer marcaciones                                           |
| Servidor → internet           | 443                      | Imágenes y actualizaciones; túnel (7844); correo (465/587) |
| PostgreSQL, API               | **ninguno**              | Solo dentro de la red de Docker                            |

## 2. Instalación

### 2.1 Docker Engine

En Ubuntu, seguir la guía oficial (repositorio `apt` de Docker): <https://docs.docker.com/engine/install/ubuntu/>.
Luego:

```bash
sudo systemctl enable --now docker       # que arranque al encender
docker compose version                   # Compose v2
timedatectl                              # "System clock synchronized: yes"
```

### 2.2 Código y configuración

```bash
sudo mkdir -p /opt/asistcontrol && sudo chown "$USER" /opt/asistcontrol
git clone https://github.com/Angel17jc/AsistControl.git /opt/asistcontrol
cd /opt/asistcontrol
cp .env.production.example .env.production
chmod 600 .env.production
```

Completar **todos** los valores de `.env.production`; cada uno está explicado en el archivo. Los secretos
se generan así (letras, dígitos, `-` y `_`, válidos dentro de una URL):

```bash
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='    # POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (uno distinto cada vez)
openssl rand -base64 32                               # DEVICE_SECRETS_KEY
```

- **`PUBLIC_URL`**: la dirección que la gente abre en el navegador (también va en los enlaces de los
  correos).
- **`COOKIE_SECURE`**: `true` si `PUBLIC_URL` es `https://` (§6). `false` **solo** en una red cerrada sin
  HTTPS: con `true` sobre HTTP simple, el navegador descarta la cookie de sesión y nadie se mantiene
  conectado.
- **Guardar una copia de `.env.production` en un gestor de contraseñas.** Sin `DEVICE_SECRETS_KEY`, un
  respaldo restaurado no puede leer las contraseñas de los marcadores.

El Compose se niega a arrancar si falta algo, y dice qué:

```text
required variable COOKIE_SECURE is missing a value: set COOKIE_SECURE to true (HTTPS) or false (plain HTTP on a closed LAN)
```

### 2.3 Arranque

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait
docker compose -f docker-compose.prod.yml --env-file .env.production ps -a
```

La primera vez construye las imágenes (≈ 6 min). Orden: `postgres` sano → `migrate` aplica las
migraciones y **termina con `Exited (0)`** → `api` sana → `web` sana. Solo `web` publica un puerto.

### 2.4 Primer administrador

La base de datos arranca **sin cuentas**. Se crea la primera desde el servidor; pide la contraseña dos
veces sin mostrarla:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec api node dist/cli/create-admin.js --email admin@empresa.com
```

Al entrar por primera vez, la web pide reemplazar esa contraseña. El comando se niega mientras exista otro
super administrador activo: a partir de ahí, las cuentas se gestionan desde **Usuarios**. Si el único
super administrador perdió su contraseña, el mismo comando con `--reset` le asigna una nueva y cierra sus
sesiones.

### 2.5 Configuración inicial (desde la web)

Producción arranca vacía. En este orden: **Organización** (departamentos y cargos) → **Contratos**
(reglas de vacaciones) → **Horarios** (turnos, horarios semanales y **feriados del año**, incluidos los
locales) → **Configuración** (tolerancias, horas extra, almuerzo) → **Empleados** (con su **ID
biométrico** = número de usuario en el marcador) → **Dispositivos** (§4) → **Usuarios** (cuentas para
RR. HH., supervisores y empleados).

Las marcaciones de personas que todavía no están cargadas no se pierden: se guardan y se vinculan solas al
crear el empleado con ese ID biométrico.

## 3. Comprobaciones tras instalar

| Qué                   | Cómo                                                                            | Esperado                                       |
| --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Salud                 | `curl -s http://localhost/health`                                               | `"status":"ok","database":"connected"`         |
| Zona de las tareas    | `docker compose … logs api \| grep "Scheduled jobs"`                            | `Scheduled jobs run on America/Guayaquil time` |
| BD y API no expuestas | Desde **otro** PC: `Test-NetConnection <ip-servidor> -Port 5432` y `-Port 3000` | Ambos fallan                                   |
| Swagger apagado       | `curl -s -o /dev/null -w '%{http_code}' http://localhost/api/docs`              | `404`                                          |
| Límite de intentos    | 6 logins fallidos seguidos (aunque se inventen cabeceras `X-Forwarded-For`)     | Respuesta `429` desde el 5.º–6.º               |
| HTTPS (si aplica)     | Abrir `PUBLIC_URL`                                                              | Candado válido; la sesión sobrevive a recargar |
| Reinicio              | `sudo reboot`                                                                   | Todo vuelve solo (`restart: unless-stopped`)   |

## 4. El marcador

Antes de registrarlo, **diagnosticarlo** desde un PC de la misma red con el repositorio y Node 22. El
diagnóstico solo lee:

```powershell
Test-NetConnection <IP-del-marcador> -Port 80
$env:DEVICE_USERNAME='<usuario>'; $env:DEVICE_PASSWORD='<contraseña>'
npm run device:probe -- --driver HIKVISION --host <IP> --timezone America/Guayaquil --out informe.json
```

- Usar un **usuario de red de permisos mínimos** (no `admin`). Los Hikvision **bloquean la cuenta** tras
  pocos intentos fallidos (unos 30 min): probar **una vez**, sin reintentos.
- **Hikvision serie DS-K1A** (huella, tarjeta y teclado): sus manuales no documentan interfaz web; se
  gestionan con iVMS-4200 (puerto 8000). Si solo responde el puerto 8000 y no el 80, el equipo **no
  expone ISAPI por HTTP**, que es lo que usa el driver. Ver el modelo y el firmware en el propio equipo:
  OK 3 s → **Info. → Device**.
- El diagnóstico termina con **Tipos de evento**: cuántos eventos de cada tipo guarda el equipo y si se
  cuentan como marcación. Si aparece un tipo frecuente con «NO se cuenta» (por ejemplo, marcaciones con
  PIN), hay que añadir su código a `config.eventMinors` del dispositivo antes de usarlo.

Si el diagnóstico es correcto: **Dispositivos → Nuevo**, con la IP, el puerto y el usuario → **Probar
conexión** (modelo, hora, desfase de reloj) → **Sincronizar**. Después, la API lo consulta sola cada
`DEVICE_SYNC_INTERVAL_SECONDS`. La primera sincronización lee los últimos 31 días.

## 5. Respaldos

```bash
infra/scripts/backup.sh
```

Hace un `pg_dump` comprimido, **lo restaura en una base temporal y compara los conteos** (un respaldo que
nadie restauró no es un respaldo), y borra los de más de 14 días (`BACKUP_KEEP_DAYS`). Programarlo a
diario y **copiar `backups/` fuera del servidor** (NAS, disco externo o nube de la empresa):

```bash
mkdir -p backups
crontab -e
# 30 2 * * * cd /opt/asistcontrol && infra/scripts/backup.sh >> backups/backup.log 2>&1
```

El script no copia `.env.production` a propósito: los secretos se guardan aparte de los datos (§2.2).

### Restaurar (reemplaza los datos actuales)

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C stop web api
$C exec -T postgres psql -U asistcontrol -d postgres -c "DROP DATABASE asistcontrol WITH (FORCE)" -c "CREATE DATABASE asistcontrol"
$C exec -T postgres pg_restore -U asistcontrol -d asistcontrol --no-owner --exit-on-error < backups/asistcontrol-AAAA-MM-DD_HHMM.dump
$C up -d --wait
```

Restaurado en **otro** servidor: usar el mismo `.env.production` (sobre todo `DEVICE_SECRETS_KEY`).

## 6. HTTPS y acceso desde fuera

Sin HTTPS, contraseñas y sesiones viajan en claro por la red. Opciones:

- **Cloudflare Tunnel** (recomendado si se usa desde fuera): `cloudflared` solo **sale** hacia
  Cloudflare, sin abrir puertos de entrada; soporta WebSocket, es gratuito y su límite de espera (125 s)
  cubre el recálculo de jornadas. Requiere un dominio gestionado en Cloudflare
  ([documentación](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)).
  Detrás del túnel, nginx tiene que saber quién es el cliente real, o el límite de intentos de login
  vería a todos como uno solo: copiar `infra/docker/real-ip.d/cloudflared.conf.example` a
  `cloudflared.conf` (se monta solo en el contenedor `web`) y reiniciar `web`. _(Configuración
  documentada; el túnel no se pudo probar sin una cuenta de la empresa.)_
- **Proxy con certificado** delante de `web` (Caddy o nginx con Let's Encrypt), si hay un dominio público.
  Declararlo también en `real-ip.d/` con su dirección y `real_ip_header X-Forwarded-For` (el proxy debe
  **reemplazar** esa cabecera, no añadir a la del cliente).
- **Solo red interna, sin HTTPS**: `COOKIE_SECURE=false`. Aceptable únicamente en una red cerrada y de
  confianza.

Con HTTPS: `PUBLIC_URL=https://…` y `COOKIE_SECURE=true`, y volver a ejecutar `up -d`.

## 7. Actualizar

```bash
infra/scripts/backup.sh                                   # siempre antes
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait
```

`migrate` aplica las migraciones nuevas antes de que arranque la API nueva
([ADR 0013](adr/0013-migrations-as-a-job.md)). Si algo falla, `docker compose … logs migrate api`.

## 8. Operación diaria

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C ps                          # estado
$C logs -f api                 # logs (JSON); cada contenedor guarda como máximo 5 × 10 MB
$C restart api                 # reiniciar la API
```

Checklist de seguridad completo: [`security.md`](security.md#checklist-de-despliegue).
