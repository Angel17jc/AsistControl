import { createHash, randomBytes } from 'node:crypto';

/**
 * HTTP Digest authentication (RFC 7616), the scheme Hikvision terminals require on ISAPI.
 * Pure functions: parsing the server challenge and computing the `Authorization` header.
 *
 * Digest never sends the password over the wire; the device proves it knows the same secret
 * by hashing it together with a nonce it chose. MD5 is what most terminals still offer: it is
 * dictated by the device, not a choice of this code, and SHA-256 is preferred when offered.
 */
export type DigestAlgorithm = 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess';

export interface DigestChallenge {
  scheme: 'Digest';
  realm: string;
  nonce: string;
  /** `auth` when the server offers it; undefined for legacy RFC 2069 servers. */
  qop?: 'auth';
  opaque?: string;
  algorithm: DigestAlgorithm;
  /** The nonce expired but the credentials were right: retry with the new one. */
  stale: boolean;
}

export interface BasicChallenge {
  scheme: 'Basic';
  realm: string;
}

export type AuthChallenge = DigestChallenge | BasicChallenge;

const SUPPORTED_ALGORITHMS: readonly DigestAlgorithm[] = [
  'MD5',
  'MD5-sess',
  'SHA-256',
  'SHA-256-sess',
];

/**
 * Parses a `WWW-Authenticate` value. A server may offer several challenges, and `fetch`
 * joins repeated headers with commas. Returns the strongest supported challenge: Digest
 * SHA-256, then Digest MD5, then Basic.
 */
export function parseAuthChallenge(header: string | null): AuthChallenge | null {
  if (!header) return null;
  const challenges = tokenizeAuthHeader(header)
    .map(toChallenge)
    .filter((c): c is AuthChallenge => c !== null);

  const rank = (c: AuthChallenge) =>
    c.scheme === 'Basic' ? 0 : c.algorithm.startsWith('SHA-256') ? 2 : 1;
  return challenges.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

function toChallenge({ scheme, params }: AuthHeaderPart): AuthChallenge | null {
  if (/^basic$/i.test(scheme)) return { scheme: 'Basic', realm: params.get('realm') ?? '' };
  const nonce = params.get('nonce');
  if (!/^digest$/i.test(scheme) || !nonce) return null;

  const algorithm = (params.get('algorithm') ?? 'MD5').toUpperCase();
  const normalized = SUPPORTED_ALGORITHMS.find((a) => a.toUpperCase() === algorithm);
  if (!normalized) return null;

  const qops = (params.get('qop') ?? '').split(',').map((q) => q.trim().toLowerCase());
  return {
    scheme: 'Digest',
    realm: params.get('realm') ?? '',
    nonce,
    qop: qops.includes('auth') ? 'auth' : undefined,
    opaque: params.get('opaque'),
    algorithm: normalized,
    stale: (params.get('stale') ?? '').toLowerCase() === 'true',
  };
}

/** Parameters of RFC 7616 challenges and responses; anything else is ignored. */
const KNOWN_PARAMS = new Set([
  'realm',
  'nonce',
  'qop',
  'opaque',
  'algorithm',
  'stale',
  'domain',
  'charset',
  'userhash',
  'username',
  'uri',
  'response',
  'nc',
  'cnonce',
]);

interface AuthHeaderPart {
  scheme: string;
  params: Map<string, string>;
}

const TOKEN_CHAR = /[A-Za-z0-9!#$%&'*+.^_`|~-]/;

/**
 * Splits an authentication header into schemes and their parameters in a single pass.
 * The header comes from a device on the network, so parsing must stay linear in its length
 * (no backtracking regular expressions) and only keep the parameters it knows.
 */
function tokenizeAuthHeader(input: string): AuthHeaderPart[] {
  const parts: AuthHeaderPart[] = [];
  let current: AuthHeaderPart | null = null;
  let i = 0;
  const skip = (chars: string) => {
    while (i < input.length && chars.includes(input[i]!)) i++;
  };
  const token = () => {
    const begin = i;
    while (i < input.length && TOKEN_CHAR.test(input[i]!)) i++;
    return input.slice(begin, i);
  };

  while (i < input.length) {
    skip(' \t,');
    const name = token();
    if (!name) {
      i++; // an unexpected character: step over it so the loop always advances
      continue;
    }
    skip(' \t');
    if (input[i] !== '=') {
      current = { scheme: name, params: new Map() };
      parts.push(current);
      continue;
    }
    i++;
    skip(' \t');
    let value = '';
    if (input[i] === '"') {
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) i++;
        value += input[i];
        i++;
      }
      i++;
    } else {
      const begin = i;
      while (i < input.length && input[i] !== ',' && input[i] !== ' ' && input[i] !== '\t') i++;
      value = input.slice(begin, i);
    }
    const key = name.toLowerCase();
    if (current && KNOWN_PARAMS.has(key)) current.params.set(key, value);
  }
  return parts;
}

export interface DigestRequest {
  method: string;
  /** Request target exactly as sent: path plus query string. */
  uri: string;
  username: string;
  password: string;
  /** Requests already made with this nonce, starting at 1. */
  nonceCount: number;
  /** Client nonce; random by default, fixed only to check the RFC examples. */
  cnonce?: string;
}

/** Response hash of RFC 7616 §3.4.1. Exported for the fake device and the RFC vectors. */
export function digestResponse(
  challenge: DigestChallenge,
  request: DigestRequest & { cnonce: string },
): string {
  const algorithm = challenge.algorithm.startsWith('SHA-256') ? 'sha256' : 'md5';
  const hash = (value: string) => createHash(algorithm).update(value, 'utf8').digest('hex');
  const nc = formatNonceCount(request.nonceCount);

  let ha1 = hash(`${request.username}:${challenge.realm}:${request.password}`);
  if (challenge.algorithm.endsWith('-sess')) {
    ha1 = hash(`${ha1}:${challenge.nonce}:${request.cnonce}`);
  }
  const ha2 = hash(`${request.method}:${request.uri}`);
  return challenge.qop
    ? hash(`${ha1}:${challenge.nonce}:${nc}:${request.cnonce}:${challenge.qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);
}

/** Value of the `Authorization` header answering a Digest challenge. */
export function digestAuthorization(challenge: DigestChallenge, request: DigestRequest): string {
  const cnonce = request.cnonce ?? randomBytes(16).toString('hex');
  const response = digestResponse(challenge, { ...request, cnonce });
  const fields = [
    `username="${quote(request.username)}"`,
    `realm="${quote(challenge.realm)}"`,
    `nonce="${quote(challenge.nonce)}"`,
    `uri="${quote(request.uri)}"`,
    `algorithm=${challenge.algorithm}`,
    `response="${response}"`,
  ];
  if (challenge.qop) {
    fields.push(`qop=${challenge.qop}`, `nc=${formatNonceCount(request.nonceCount)}`);
    fields.push(`cnonce="${cnonce}"`);
  }
  if (challenge.opaque !== undefined) fields.push(`opaque="${quote(challenge.opaque)}"`);
  return `Digest ${fields.join(', ')}`;
}

/** Parses the `Authorization` header a client sent (used by the fake device to verify it). */
export function parseDigestAuthorization(header: string | undefined): Record<string, string> {
  const [part] = header ? tokenizeAuthHeader(header) : [];
  if (!part || !/^digest$/i.test(part.scheme)) return {};
  return Object.fromEntries(part.params);
}

function formatNonceCount(count: number): string {
  return count.toString(16).padStart(8, '0');
}

function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
