import {
  DeviceAuthenticationError,
  DeviceConnectionError,
  DeviceProtocolError,
  DeviceTimeoutError,
} from '../errors';
import { type DigestChallenge, digestAuthorization, parseAuthChallenge } from './digest-auth';
import { describeIsapiError } from './isapi';

export interface IsapiClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/**
 * Minimal ISAPI client: one request at a time, Digest authentication, and every failure
 * translated into the typed errors of the adapter contract.
 *
 * Authentication failures are never retried here and are not `retryable` for the sync
 * pipeline either: Hikvision terminals lock the account after a few wrong passwords, so a
 * misconfigured device must fail once, loudly, instead of locking itself out.
 */
export class IsapiClient {
  private challenge: DigestChallenge | null = null;
  private nonceCount = 0;

  constructor(private readonly options: IsapiClientOptions) {}

  async getText(path: string): Promise<string> {
    return this.read(await this.request('GET', path), `GET ${path}`);
  }

  async getJson<T>(path: string): Promise<T> {
    return parseJson<T>(await this.getText(path), path);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.request('POST', path, JSON.stringify(body));
    return parseJson<T>(await this.read(res, `POST ${path}`), path);
  }

  /** The timeout also covers the body: a terminal can stall halfway through a page. */
  private async read(res: Response, operation: string): Promise<string> {
    try {
      return await res.text();
    } catch (error) {
      throw translateNetworkError(error, operation, this.options.timeoutMs);
    }
  }

  private async request(method: 'GET' | 'POST', path: string, body?: string): Promise<Response> {
    // The cached nonce (if any) is tried first. On a 401 the request is repeated once with the
    // fresh challenge; a second 401 with a nonce the device just issued means bad credentials.
    let res = await this.send(method, path, body);
    if (res.status === 401) {
      await res.body?.cancel();
      const challenge = parseAuthChallenge(res.headers.get('www-authenticate'));
      if (!challenge) throw new DeviceProtocolError(`${path} answered 401 without a challenge`);
      if (challenge.scheme === 'Basic') {
        throw new DeviceAuthenticationError(
          'Device only offers Basic authentication; refusing to send the password in clear text',
        );
      }
      this.challenge = challenge;
      this.nonceCount = 0;
      res = await this.send(method, path, body);
      if (res.status === 401) {
        await res.body?.cancel();
        this.challenge = null;
        throw new DeviceAuthenticationError('Device rejected the username or password');
      }
    }
    return this.checkStatus(res, path);
  }

  private async send(method: string, path: string, body?: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json, application/xml' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.challenge) {
      headers.Authorization = digestAuthorization(this.challenge, {
        method,
        uri: path,
        username: this.options.username,
        password: this.options.password,
        nonceCount: ++this.nonceCount,
      });
    }
    try {
      return await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw translateNetworkError(error, `${method} ${path}`, this.options.timeoutMs);
    }
  }

  private async checkStatus(res: Response, path: string): Promise<Response> {
    if (res.ok) return res;
    const detail = describeIsapiError(await res.text().catch(() => ''));
    const suffix = detail ? `: ${detail}` : '';
    if (res.status === 403) {
      throw new DeviceAuthenticationError(
        `The device user is not allowed to call ${path}${suffix}`,
      );
    }
    throw new DeviceProtocolError(`${path} answered HTTP ${res.status}${suffix}`);
  }
}

function parseJson<T>(text: string, path: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DeviceProtocolError(`${path} did not return JSON`);
  }
}

function translateNetworkError(error: unknown, operation: string, timeoutMs: number): Error {
  const name = (error as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new DeviceTimeoutError(`${operation} timed out after ${timeoutMs}ms`);
  }
  const cause = (error as { cause?: { code?: string } })?.cause;
  return new DeviceConnectionError(
    `Device is unreachable (${cause?.code ?? (error as Error)?.message ?? 'network error'})`,
  );
}
