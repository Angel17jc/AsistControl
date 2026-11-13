/**
 * The look every email shares: the Kairosig brand (white card, yellow edge, the blue of
 * "sig" for the button). Table layout and inline styles, which is what email clients reliably
 * render. Every piece of text is escaped: names come from people and devices.
 */
export interface RenderedEmail {
  subject: string;
  text: string;
  /** The same content as `text`, for clients that show HTML. */
  html: string;
}

export interface EmailAction {
  label: string;
  url: string;
}

const BRAND = {
  page: '#f6f7fb',
  card: '#ffffff',
  yellow: '#ffd008',
  blue: '#3550a3',
  ink: '#1b1938',
  muted: '#686783',
};

export function renderEmailHtml({
  title,
  paragraphs,
  action,
  footer,
}: {
  title: string;
  paragraphs: string[];
  action: EmailAction | null;
  footer: string;
}): string {
  const text = `font-size:14px;line-height:1.55;margin:0 0 12px;color:${BRAND.ink}`;
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title></head>`,
    `<body style="margin:0;padding:24px;background:${BRAND.page};`,
    `font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink}">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ',
    `style="max-width:560px;margin:0 auto;background:${BRAND.card};border-radius:8px;`,
    `border-top:4px solid ${BRAND.yellow}">`,
    '<tr><td style="padding:24px">',
    `<p style="margin:0 0 16px;font-size:12px;letter-spacing:.08em;color:${BRAND.muted};`,
    'text-transform:uppercase">AsistControl · Kairosig</p>',
    `<h1 style="margin:0 0 16px;font-size:18px;color:${BRAND.ink}">${escapeHtml(title)}</h1>`,
    ...paragraphs.map((p) => `<p style="${text}">${escapeHtml(p)}</p>`),
    action
      ? `<p style="margin:20px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;` +
        `padding:11px 18px;background:${BRAND.blue};color:#ffffff;text-decoration:none;` +
        `border-radius:6px;font-size:14px;font-weight:bold">${escapeHtml(action.label)}</a></p>`
      : '',
    `<p style="margin:24px 0 0;font-size:12px;color:${BRAND.muted}">${escapeHtml(footer)}</p>`,
    '</td></tr></table></body></html>',
  ].join('');
}

const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES.get(c)!);
}

/** A subject must stay on one line: names never get to start a new header. */
export function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}
