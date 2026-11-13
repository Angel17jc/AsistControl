import { renderPasswordLinkEmail } from './password-link-email';

const LINK =
  'https://asistencia.empresa.com/restablecer#AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
// 30 minutes after 15:00 in Ecuador (UTC-5).
const EXPIRES = new Date('2026-11-12T20:30:00Z');

describe('renderPasswordLinkEmail', () => {
  it('writes the reset email with the link and until when it works, in company time', () => {
    const email = renderPasswordLinkEmail({
      purpose: 'RESET',
      email: 'melanie@empresa.com',
      link: LINK,
      expiresAt: EXPIRES,
      timezone: 'America/Guayaquil',
    });
    expect(email.subject).toBe('Restablecer su contraseña de AsistControl');
    expect(email.text).toContain('la cuenta melanie@empresa.com');
    expect(email.text).toContain('antes del 12 de noviembre, 15:30');
    expect(email.text).toContain(`Elegir una contraseña nueva: ${LINK}`);
    expect(email.text).toContain('ignore este correo');
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.html).toContain('AsistControl · Kairosig');
  });

  it('writes the invitation, naming who created the account', () => {
    const email = renderPasswordLinkEmail({
      purpose: 'INVITE',
      email: 'melanie@empresa.com',
      link: LINK,
      expiresAt: EXPIRES,
      timezone: 'America/Guayaquil',
      invitedBy: 'Ana Ruiz',
    });
    expect(email.subject).toBe('Su cuenta de AsistControl');
    expect(email.text).toContain('Ana Ruiz le creó una cuenta en AsistControl');
    expect(email.text).toContain(`Elegir mi contraseña: ${LINK}`);
  });

  it('escapes names in the HTML and keeps the subject on one line', () => {
    const email = renderPasswordLinkEmail({
      purpose: 'INVITE',
      email: 'a@b.co',
      link: LINK,
      expiresAt: EXPIRES,
      timezone: 'America/Guayaquil',
      invitedBy: '<img src=x onerror=alert(1)>',
    });
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
