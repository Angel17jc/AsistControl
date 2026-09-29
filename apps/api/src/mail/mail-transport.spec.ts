import { smtpOptions } from './mail-transport';

describe('smtpOptions', () => {
  it('uses implicit TLS for smtps:// and the standard port', () => {
    expect(
      smtpOptions({ url: 'smtps://mailer:s3cret@mail.empresa.com', from: 'x', requireTls: true }),
    ).toMatchObject({
      host: 'mail.empresa.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: 'mailer', pass: 's3cret' },
    });
  });

  it('demands STARTTLS on smtp:// when asked to (production)', () => {
    const options = smtpOptions({
      url: 'smtp://mail.empresa.com:2525',
      from: 'x',
      requireTls: true,
    });
    expect(options).toMatchObject({ port: 2525, secure: false, requireTLS: true, auth: undefined });
    expect(smtpOptions({ url: 'smtp://localhost', from: 'x', requireTls: false })).toMatchObject({
      port: 587,
      requireTLS: false,
    });
  });

  it('decodes credentials with reserved characters', () => {
    const options = smtpOptions({
      url: 'smtp://avisos%40empresa.com:p%40ss%3Aword@mail.empresa.com',
      from: 'x',
      requireTls: false,
    });
    expect(options.auth).toEqual({ user: 'avisos@empresa.com', pass: 'p@ss:word' });
  });

  it('never waits forever for a mail server', () => {
    const options = smtpOptions({ url: 'smtp://mail.empresa.com', from: 'x', requireTls: false });
    expect(options.connectionTimeout).toBeGreaterThan(0);
    expect(options.greetingTimeout).toBeGreaterThan(0);
    expect(options.socketTimeout).toBeGreaterThan(0);
  });
});
