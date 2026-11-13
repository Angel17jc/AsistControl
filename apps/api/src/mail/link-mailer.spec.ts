import type { AppConfigService } from '../config/app-config.service';
import { LinkMailer } from './link-mailer';
import type { MailMessage, MailTransport } from './mail-transport';

const MESSAGE: MailMessage = { to: 'a@b.co', subject: 'Asunto', text: 'Texto' };

function config(values: { APP_PUBLIC_URL?: string; production?: boolean }) {
  return {
    get: (key: string) => (key === 'APP_PUBLIC_URL' ? values.APP_PUBLIC_URL : undefined),
    isProduction: values.production ?? false,
  } as unknown as AppConfigService;
}

describe('LinkMailer', () => {
  const transport = (): MailTransport & { sent: MailMessage[] } => {
    const sent: MailMessage[] = [];
    return { sent, send: async (m) => void sent.push(m) };
  };

  it('sends by email when SMTP and the public address are set', async () => {
    const t = transport();
    const mailer = new LinkMailer(config({ APP_PUBLIC_URL: 'https://x.co' }), t);
    expect(mailer.delivery).toBe('send');
    await mailer.dispatch(MESSAGE, 'test');
    expect(t.sent).toEqual([MESSAGE]);
  });

  it('writes to the log outside production when there is no SMTP', () => {
    expect(new LinkMailer(config({ APP_PUBLIC_URL: 'https://x.co' }), null).delivery).toBe('log');
  });

  it('is off in production without SMTP: a production log must not hold a live link', () => {
    const mailer = new LinkMailer(
      config({ APP_PUBLIC_URL: 'https://x.co', production: true }),
      null,
    );
    expect(mailer.delivery).toBe('off');
  });

  it('is off without a public address: there is nothing to link to', () => {
    expect(new LinkMailer(config({}), transport()).delivery).toBe('off');
  });

  it('retries a refused send, and never throws to the caller', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const flaky: MailTransport = {
      send: async () => {
        calls++;
        throw new Error('421 Service not available');
      },
    };
    const mailer = new LinkMailer(config({ APP_PUBLIC_URL: 'https://x.co' }), flaky);
    const done = mailer.dispatch(MESSAGE, 'test');
    await jest.runAllTimersAsync();
    await expect(done).resolves.toBeUndefined();
    expect(calls).toBe(3);
    jest.useRealTimers();
  });
});
