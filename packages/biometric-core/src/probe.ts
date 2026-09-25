import { PUNCH_TYPES, type PunchType, VERIFY_MODES, type VerifyMode } from '@asistcontrol/shared';
import type { BiometricDeviceAdapter } from './adapter';
import { BiometricDeviceError } from './errors';

/**
 * Hardware validation: runs against a real terminal the same sequence the platform runs
 * (connect, identify, list users, full download, incremental download) and reports what a
 * person must check, step by step. It never throws and never writes to the device, so it is
 * safe to point at a terminal in production. Wrong credentials are tried ONCE: some terminals
 * lock the account after a few failures.
 */
export type ProbeStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface ProbeStep {
  id: 'connect' | 'identity' | 'clock' | 'users' | 'download' | 'incremental';
  label: string;
  status: ProbeStatus;
  /** What was found, in words for whoever runs the probe. */
  detail: string;
  durationMs: number;
}

export interface ProbeReport {
  driver: string;
  steps: ProbeStep[];
  /** The worst status of any step. */
  outcome: 'ok' | 'warn' | 'fail';
  /** Counts of the downloaded punches, to compare with the terminal's own log. */
  punches: {
    total: number;
    byPunchType: Record<PunchType, number>;
    byVerifyMode: Record<VerifyMode, number>;
    first: string | null;
    last: string | null;
  };
}

export interface ProbeOptions {
  /** Server clock, injectable for tests. */
  now?: () => Date;
  /** Clock drift beyond this is a warning. */
  maxDriftSeconds?: number;
}

const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** A punch older than this usually means a wrong clock or time zone, not old data. */
const OLD_PUNCH_MS = 5 * 365 * 86_400_000;

export async function probeDevice(
  adapter: BiometricDeviceAdapter,
  { now = () => new Date(), maxDriftSeconds = 60 }: ProbeOptions = {},
): Promise<ProbeReport> {
  const steps: ProbeStep[] = [];
  const punches: ProbeReport['punches'] = {
    total: 0,
    byPunchType: countersFor(PUNCH_TYPES),
    byVerifyMode: countersFor(VERIFY_MODES),
    first: null,
    last: null,
  };
  const skipRest = (reason: string) => {
    for (const [id, label] of STEPS) {
      if (!steps.some((s) => s.id === id)) {
        steps.push({ id, label, status: 'skipped', detail: reason, durationMs: 0 });
      }
    }
  };
  const run = async (
    id: ProbeStep['id'],
    fn: () => Promise<{ status: ProbeStatus; detail: string }>,
  ): Promise<boolean> => {
    const started = Date.now();
    let result: { status: ProbeStatus; detail: string };
    try {
      result = await fn();
    } catch (err) {
      result = { status: 'fail', detail: describeError(err) };
    }
    steps.push({ id, label: labelOf(id), ...result, durationMs: Date.now() - started });
    return result.status !== 'fail';
  };

  try {
    const connected = await run('connect', async () => {
      await adapter.connect();
      return { status: 'ok', detail: 'Conectado y autenticado' };
    });
    if (!connected) {
      skipRest('No se ejecutó: la conexión falló');
      return report(adapter.driver, steps, punches);
    }

    await run('identity', async () => {
      const info = await adapter.getDeviceInfo();
      const drift = Math.round((info.deviceTime.getTime() - now().getTime()) / 1000);
      steps.push({
        id: 'clock',
        label: labelOf('clock'),
        status: Math.abs(drift) > maxDriftSeconds ? 'warn' : 'ok',
        detail: describeDrift(drift),
        durationMs: 0,
      });
      return {
        status: 'ok',
        detail:
          `${info.manufacturer} ${info.model} · serie ${info.serialNumber} · firmware ` +
          `${info.firmwareVersion} · ${info.userCount} usuarios · ${info.logCount} registros`,
      };
    });
    if (!steps.some((s) => s.id === 'clock')) {
      steps.push({
        id: 'clock',
        label: labelOf('clock'),
        status: 'skipped',
        detail: 'Sin identidad no se puede leer el reloj',
        durationMs: 0,
      });
    }

    await run('users', async () => {
      if (!adapter.capabilities.users) {
        return { status: 'skipped', detail: 'El driver no lee la lista de usuarios' };
      }
      const users = await adapter.getUsers();
      if (users.length === 0) {
        return { status: 'warn', detail: 'Sin usuarios enrolados' };
      }
      const sample = users
        .slice(0, 5)
        .map((u) => u.deviceUserId)
        .join(', ');
      return {
        status: 'ok',
        detail: `${users.length} usuarios; los primeros ID: ${sample} (deben coincidir con el ID biométrico de cada empleado)`,
      };
    });

    let cursor: string | null = null;
    const downloaded = await run('download', async () => {
      const result = await adapter.sync({ cursor: null });
      cursor = result.cursor;
      const at = now().getTime();
      let future = 0;
      let old = 0;
      for (const log of result.logs) {
        punches.byPunchType[log.punchType]++;
        punches.byVerifyMode[log.verifyMode]++;
        const t = log.timestamp.getTime();
        if (t > at + FUTURE_TOLERANCE_MS) future++;
        if (t < at - OLD_PUNCH_MS) old++;
        const iso = log.timestamp.toISOString();
        if (punches.first === null || iso < punches.first) punches.first = iso;
        if (punches.last === null || iso > punches.last) punches.last = iso;
      }
      punches.total = result.logs.length;

      if (result.logs.length === 0) {
        return {
          status: 'warn',
          detail: 'El equipo no devolvió marcaciones: marque una vez en el equipo y repita',
        };
      }
      const problems = [
        future > 0 && `${future} con hora futura (reloj o zona horaria del equipo)`,
        old > 0 && `${old} de hace más de 5 años (reloj o zona horaria del equipo)`,
        punches.byPunchType.UNKNOWN > 0 &&
          `${punches.byPunchType.UNKNOWN} sin tipo de marcación reconocido`,
      ].filter(Boolean);
      return {
        status: problems.length > 0 ? 'warn' : 'ok',
        detail:
          `${result.logs.length} marcaciones, de ${punches.first} a ${punches.last}` +
          (problems.length > 0 ? `; ${problems.join('; ')}` : ''),
      };
    });

    if (downloaded) {
      await run('incremental', async () => {
        const again = await adapter.sync({ cursor });
        return again.logs.length === 0
          ? { status: 'ok', detail: 'La segunda descarga no trajo nada nuevo: el cursor avanza' }
          : {
              status: 'warn',
              detail:
                `La segunda descarga trajo ${again.logs.length} marcaciones otra vez (o nuevas ` +
                'hechas durante la prueba). La plataforma las deduplica, pero revise el cursor',
            };
      });
    }
    skipRest('No se ejecutó: la descarga completa falló');
    return report(adapter.driver, steps, punches);
  } finally {
    await adapter.disconnect().catch(() => undefined);
  }
}

const STEPS: [ProbeStep['id'], string][] = [
  ['connect', 'Conexión'],
  ['identity', 'Identidad'],
  ['clock', 'Reloj'],
  ['users', 'Usuarios'],
  ['download', 'Descarga completa'],
  ['incremental', 'Descarga incremental'],
];

function labelOf(id: ProbeStep['id']): string {
  return STEPS.find(([step]) => step === id)![1];
}

function report(driver: string, steps: ProbeStep[], punches: ProbeReport['punches']): ProbeReport {
  const ordered = STEPS.map(([id]) => steps.find((s) => s.id === id)!);
  const outcome = ordered.some((s) => s.status === 'fail')
    ? 'fail'
    : ordered.some((s) => s.status === 'warn')
      ? 'warn'
      : 'ok';
  return { driver, steps: ordered, outcome, punches };
}

function describeError(err: unknown): string {
  if (err instanceof BiometricDeviceError) {
    const hint = {
      CONNECTION_FAILED: 'revise IP, puerto, red y que el equipo esté encendido',
      NOT_CONNECTED: 'la sesión se cerró',
      TIMEOUT: 'el equipo no respondió a tiempo; revise la red o aumente el timeout',
      PROTOCOL_ERROR: 'el equipo respondió algo inesperado; revise el driver y el modelo',
      AUTHENTICATION_FAILED:
        'credenciales rechazadas; no se reintenta para no bloquear la cuenta del equipo',
      UNSUPPORTED_DRIVER: 'driver desconocido',
      UNSUPPORTED_OPERATION: 'el equipo no admite la operación',
    }[err.code];
    return `${err.code}: ${err.message} (${hint})`;
  }
  return `Error inesperado: ${err instanceof Error ? err.message : String(err)}`;
}

function describeDrift(seconds: number): string {
  if (seconds === 0) return 'Hora del equipo igual a la del servidor';
  const abs = Math.abs(seconds);
  const text = abs >= 60 ? `${Math.floor(abs / 60)} min ${abs % 60} s` : `${abs} s`;
  return `El equipo va ${text} ${seconds > 0 ? 'adelantado' : 'atrasado'} respecto del servidor`;
}

function countersFor<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

const MARK: Record<ProbeStatus, string> = {
  ok: '[OK]   ',
  warn: '[AVISO]',
  fail: '[FALLO]',
  skipped: '[--]   ',
};

/** The report as text for a terminal: one line per step, then the punch counts. */
export function formatProbeReport(report: ProbeReport, target: string): string {
  const lines = [`Diagnóstico ${report.driver} ${target}`, ''];
  for (const step of report.steps) {
    // The clock is worked out from the identity, not an operation of its own.
    const time = step.status === 'skipped' || step.id === 'clock' ? '' : ` (${step.durationMs} ms)`;
    lines.push(`${MARK[step.status]} ${step.label.padEnd(21)} ${step.detail}${time}`);
  }
  if (report.punches.total > 0) {
    const nonZero = (counts: Record<string, number>) =>
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([key, n]) => `${key} ${n}`)
        .join(', ');
    lines.push(
      '',
      `Marcaciones por tipo:   ${nonZero(report.punches.byPunchType)}`,
      `Marcaciones por método: ${nonZero(report.punches.byVerifyMode)}`,
      'Compárelas con el registro del propio equipo antes de usarlo en producción.',
    );
  }
  const verdict = {
    ok: 'Resultado: todo correcto',
    warn: 'Resultado: funciona, con avisos que revisar',
    fail: 'Resultado: FALLÓ',
  }[report.outcome];
  lines.push('', verdict);
  return lines.join('\n');
}
