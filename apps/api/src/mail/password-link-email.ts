import type { PasswordLinkPurpose } from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import { type RenderedEmail, renderEmailHtml, singleLine } from './email-layout';

export interface PasswordLinkEmail {
  purpose: PasswordLinkPurpose;
  /** The account the link sets a password for. */
  email: string;
  /** The full link, token included. Only ever written into this email. */
  link: string;
  expiresAt: Date;
  /** Company timezone, to say until when the link works as people read the time. */
  timezone: string;
  /** Who created the account (invitations): their name, or their email. */
  invitedBy?: string;
}

const FOOTER =
  'Correo automático de AsistControl. Nadie de la empresa le va a pedir su contraseña: ' +
  'no la comparta.';

/**
 * The email with a password link (ADR 0016), in Spanish, plain text and HTML. Pure: no Nest,
 * no clock. It says until when the link works and what to do if it was not expected.
 */
export function renderPasswordLinkEmail(input: PasswordLinkEmail): RenderedEmail {
  const until = DateTime.fromJSDate(input.expiresAt, { zone: input.timezone })
    .setLocale('es')
    .toFormat("d 'de' LLLL, HH:mm");
  const { subject, paragraphs, action } =
    input.purpose === 'RESET'
      ? {
          subject: 'Restablecer su contraseña de AsistControl',
          paragraphs: [
            `Alguien pidió restablecer la contraseña de la cuenta ${input.email} en AsistControl.`,
            `Para elegir una nueva, abra el enlace antes del ${until}. Sirve una sola vez.`,
            'Si no lo pidió usted, ignore este correo: su contraseña sigue siendo la misma.',
          ],
          action: 'Elegir una contraseña nueva',
        }
      : {
          subject: 'Su cuenta de AsistControl',
          paragraphs: [
            `${input.invitedBy ?? 'Un administrador'} le creó una cuenta en AsistControl, el ` +
              `sistema de asistencia de la empresa, con el correo ${input.email}.`,
            `Para entrar, elija su contraseña con el enlace antes del ${until}. Sirve una sola vez.`,
            'Si no esperaba este correo, ignórelo: nadie puede entrar con esta cuenta sin elegir ' +
              'antes una contraseña desde el enlace.',
          ],
          action: 'Elegir mi contraseña',
        };

  const title = singleLine(subject);
  const text = [...paragraphs, '', `${action}: ${input.link}`, '', '—', FOOTER].join('\n');
  const html = renderEmailHtml({
    title,
    paragraphs,
    action: { label: action, url: input.link },
    footer: FOOTER,
  });
  return { subject: title, text, html };
}
