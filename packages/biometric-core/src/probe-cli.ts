/**
 * npm run device:probe -- --driver ZKTECO --host 192.168.1.201 [--port 4370]
 *
 * Validates a real terminal before registering it (see docs/device-integration.md).
 * Credentials come from the environment, never from arguments, so they stay out of the shell
 * history: DEVICE_COMM_KEY (ZKTeco) or DEVICE_USERNAME / DEVICE_PASSWORD (Hikvision).
 * Exit code: 0 = works (maybe with warnings), 1 = failed, 2 = wrong usage.
 */
import { parseArgs } from 'node:util';
import type { BiometricDeviceAdapter } from './adapter';
import { HikvisionAdapter } from './hikvision/hikvision.adapter';
import { formatProbeReport, probeDevice } from './probe';
import type { DeviceConnectionConfig } from './types';
import { ZKTecoAdapter } from './zkteco/zkteco.adapter';

const USAGE = `Uso: npm run device:probe -- --driver <ZKTECO|HIKVISION> --host <IP> [opciones]

  --port <n>          Puerto (ZKTECO 4370, HIKVISION 80 u 443 con https)
  --timezone <zona>   Zona horaria del reloj del equipo (por defecto, la de este equipo)
  --timeout <ms>      Timeout por operación (10000)
  --protocol <http|https>  Solo HIKVISION
  --json              Informe en JSON

Credenciales por variables de entorno:
  ZKTECO     DEVICE_COMM_KEY (0 o vacío si el equipo no tiene clave)
  HIKVISION  DEVICE_USERNAME y DEVICE_PASSWORD (use un usuario dedicado, no admin)`;

const DRIVERS: Record<
  string,
  { port: number; create: (c: DeviceConnectionConfig) => BiometricDeviceAdapter }
> = {
  ZKTECO: { port: 4370, create: (c) => new ZKTecoAdapter(c) },
  HIKVISION: { port: 80, create: (c) => new HikvisionAdapter(c) },
};

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        driver: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'string' },
        timezone: { type: 'string' },
        timeout: { type: 'string' },
        protocol: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const driver = values.driver?.toUpperCase() ?? '';
  const spec = Object.hasOwn(DRIVERS, driver) ? DRIVERS[driver] : undefined;
  if (values.help || !spec || !values.host) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }

  const https = values.protocol === 'https';
  const port = Number(values.port ?? (driver === 'HIKVISION' && https ? 443 : spec.port));
  const timeoutMs = Number(values.timeout ?? 10_000);
  if (!Number.isInteger(port) || port <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`Puerto o timeout inválido.\n\n${USAGE}`);
    return 2;
  }
  const env = process.env;
  const credentials: Record<string, string> =
    driver === 'ZKTECO'
      ? { commKey: env.DEVICE_COMM_KEY ?? '0' }
      : { username: env.DEVICE_USERNAME ?? '', password: env.DEVICE_PASSWORD ?? '' };
  if (driver === 'HIKVISION' && (!credentials.username || !credentials.password)) {
    console.error('Defina DEVICE_USERNAME y DEVICE_PASSWORD con un usuario ISAPI del equipo.');
    return 2;
  }

  const adapter = spec.create({
    host: values.host,
    port,
    timeoutMs,
    credentials,
    options: {
      timezone: values.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(driver === 'HIKVISION' && { protocol: https ? 'https' : 'http' }),
    },
  });
  const report = await probeDevice(adapter);
  // The report is the program's output (stdout); usage and errors go to stderr.
  process.stdout.write(
    `${values.json ? JSON.stringify(report, null, 2) : formatProbeReport(report, `${values.host}:${port}`)}\n`,
  );
  return report.outcome === 'fail' ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
