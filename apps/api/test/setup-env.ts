/**
 * Deterministic environment for e2e tests. TEST_DATABASE_URL must point to a disposable
 * database whose name ends in "_test": global-setup truncates it before the run.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://asistcontrol:asistcontrol@localhost:5434/asistcontrol_test?schema=public';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  LOG_LEVEL: 'fatal',
  LOG_FORMAT: 'json',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdefghijklmnop',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdefghijklmnop',
  DEVICE_SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'),
  DEVICE_SYNC_INTERVAL_SECONDS: '0',
  ENABLE_MOCK_DEVICES: 'true',
  APP_TIMEZONE: 'America/Guayaquil',
  THROTTLE_ENABLED: 'false',
  CORS_ORIGINS: 'http://localhost:5173',
});
