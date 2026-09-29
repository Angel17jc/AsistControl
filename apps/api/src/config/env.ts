import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Optional setting. Compose passes `${VAR:-}` as an empty string: that means unset too. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * Environment contract. The API refuses to boot with a missing or weak configuration,
 * so misconfiguration fails at deploy time instead of at the first request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** json for containers/log collectors, pretty for local development (needs pino-pretty). */
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  COOKIE_SECURE: bool.default(false),

  DEVICE_SECRETS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes encoded as base64'),
  DEVICE_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),
  ENABLE_MOCK_DEVICES: bool.default(true),

  APP_TIMEZONE: z
    .string()
    .default('America/Guayaquil')
    .refine(isValidTimeZone, 'must be a valid IANA timezone'),

  /**
   * Email channel for notifications (ADR 0011). Unset = off. `smtps://` for implicit TLS;
   * with `smtp://` production demands STARTTLS. Credentials go in the URL, which is a secret.
   */
  SMTP_URL: optional(
    z
      .string()
      .url()
      .refine((v) => /^smtps?:\/\//.test(v), 'must start with smtp:// or smtps://'),
  ),
  /** Sender, e.g. `AsistControl <no-reply@empresa.com>`. Required with SMTP_URL. */
  MAIL_FROM: optional(z.string().min(3)),
  /** Public address of the web app, for links in emails. Without it, emails carry no link. */
  APP_PUBLIC_URL: optional(z.string().url().transform(withoutTrailingSlashes)),
  /** How often pending emails are sent; 0 = never (the e2e suite drives it by hand). */
  EMAIL_DISPATCH_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(30),

  /** Only meant to be disabled by the e2e test suite. */
  THROTTLE_ENABLED: bool.default(true),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (parsed.data.SMTP_URL && !parsed.data.MAIL_FROM) {
    throw new Error('MAIL_FROM is required when SMTP_URL is set');
  }
  if (parsed.data.NODE_ENV === 'production') {
    const weak = (['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const).filter((k) =>
      parsed.data[k].includes('change-me'),
    );
    if (weak.length > 0) {
      throw new Error(
        `Refusing to start in production with placeholder secrets: ${weak.join(', ')}`,
      );
    }
  }
  return parsed.data;
}

/** Linear on purpose: a `/\/+$/` regex backtracks quadratically on long runs of slashes. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
