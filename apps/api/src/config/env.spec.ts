import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  DEVICE_SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.APP_TIMEZONE).toBe('America/Guayaquil');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('rejects short secrets and bad keys', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, DEVICE_SECRETS_KEY: 'abc' })).toThrow(/DEVICE_SECRETS_KEY/);
  });

  it('requires different access and refresh secrets', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow(
      /must be different/,
    );
  });

  it('leaves email off unless SMTP_URL is set, and then demands a sender', () => {
    const env = validateEnv(base);
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.EMAIL_DISPATCH_INTERVAL_SECONDS).toBe(30);
    expect(() => validateEnv({ ...base, SMTP_URL: 'smtp://mail.local:587' })).toThrow(/MAIL_FROM/);
    expect(() =>
      validateEnv({ ...base, SMTP_URL: 'https://mail.local', MAIL_FROM: 'a@b.c' }),
    ).toThrow(/SMTP_URL/);
    expect(
      validateEnv({
        ...base,
        SMTP_URL: 'smtps://user:secret@mail.local:465',
        MAIL_FROM: 'AsistControl <no-reply@empresa.com>',
        APP_PUBLIC_URL: 'https://asistencia.empresa.com/',
      }).APP_PUBLIC_URL,
    ).toBe('https://asistencia.empresa.com');
  });

  it('treats empty values as unset, as Docker Compose passes them', () => {
    const env = validateEnv({ ...base, SMTP_URL: '', MAIL_FROM: '', APP_PUBLIC_URL: '' });
    expect(env).toMatchObject({
      SMTP_URL: undefined,
      MAIL_FROM: undefined,
      APP_PUBLIC_URL: undefined,
    });
  });

  it('rejects invalid timezones', () => {
    expect(() => validateEnv({ ...base, APP_TIMEZONE: 'Mars/Olympus' })).toThrow(/APP_TIMEZONE/);
  });

  it('refuses placeholder secrets in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-access-secret-at-least-32-characters',
      }),
    ).toThrow(/placeholder/);
  });
});
