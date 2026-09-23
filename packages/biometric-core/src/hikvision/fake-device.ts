import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { formatLocalIso } from '../device-time';
import {
  type DigestAlgorithm,
  type DigestChallenge,
  digestResponse,
  parseDigestAuthorization,
} from './digest-auth';
import { ACS_MAJOR_EVENT, ACS_MINOR, parseIsapiTime } from './isapi';

export interface FakeHikEvent {
  /** Omit to imitate firmware that does not number its events. */
  serialNo?: number;
  employeeNo: string;
  /** As the terminal writes it: with an offset, or wall-clock time only. */
  time: string;
  /** Defaults to "face authentication passed". */
  minor?: number;
  attendanceStatus?: string;
}

export interface FakeHikvisionOptions {
  username?: string;
  password?: string;
  algorithm?: DigestAlgorithm;
  /** Offer only Basic authentication, like a badly configured terminal. */
  basicOnly?: boolean;
  serialNumber?: string;
  model?: string;
  firmwareVersion?: string;
  /** Zone of the terminal's clock; used to render its time and read search bounds. */
  timezone?: string;
  /** Fixed device clock (ISO). Defaults to the real current time. */
  deviceTime?: string;
  events?: FakeHikEvent[];
  users?: { employeeNo: string; name: string; admin?: boolean }[];
  /** Page size the terminal enforces, whatever the client asks for. */
  maxResults?: number;
  /** Older firmware has no count endpoints. */
  supportsCounts?: boolean;
  /** Delay before every answer, to exercise timeouts. */
  delayMs?: number;
  /** Answer these paths with an error, e.g. an ISAPI ResponseStatus. */
  failures?: Record<string, { status: number; body: string }>;
}

export interface FakeHikRequest {
  method: string;
  path: string;
  authorized: boolean;
  body: unknown;
}

/**
 * An HTTP server that speaks ISAPI like a Hikvision access-control terminal, used to test the
 * adapter without hardware: Digest authentication with rotating nonces, paginated searches
 * and the same minor/time filtering a real terminal applies.
 */
export class FakeHikvisionDevice {
  options: FakeHikvisionOptions;
  readonly requests: FakeHikRequest[] = [];
  private server: Server | null = null;
  private nonce = newNonce();

  constructor(options: FakeHikvisionOptions = {}) {
    this.options = {
      username: 'admin',
      password: 'Hik12345!',
      algorithm: 'MD5',
      serialNumber: 'DS-K1T671M20260101V030230ENF00000001',
      model: 'DS-K1T671M',
      firmwareVersion: 'V3.2.30 build 260101',
      timezone: 'America/Guayaquil',
      events: [],
      users: [],
      maxResults: 30,
      supportsCounts: true,
      ...options,
    };
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => void this.handle(req, res));
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** The next request carrying the current nonce finds it expired (stale=true). */
  expireNonce(): void {
    this.nonce = newNonce();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://device');
    const authorized = this.authorize(req, res);
    const body = parseBody(raw);
    this.requests.push({ method: req.method ?? 'GET', path: url.pathname, authorized, body });
    if (!authorized) return;

    if (this.options.delayMs) await new Promise((r) => setTimeout(r, this.options.delayMs));
    const failure = this.options.failures?.[url.pathname];
    if (failure) return send(res, failure.status, failure.body);

    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /ISAPI/System/deviceInfo':
        return send(res, 200, this.deviceInfoXml(), 'application/xml');
      case 'GET /ISAPI/System/time':
        return send(res, 200, this.timeXml(), 'application/xml');
      case 'GET /ISAPI/AccessControl/UserInfo/Count':
        return this.options.supportsCounts
          ? json(res, { UserInfoCount: { userNumber: this.options.users!.length } })
          : notSupported(res);
      case 'POST /ISAPI/AccessControl/AcsEventTotalNum':
        return this.options.supportsCounts
          ? json(res, { AcsEventTotalNum: { totalNum: this.options.events!.length } })
          : notSupported(res);
      case 'POST /ISAPI/AccessControl/UserInfo/Search':
        return this.userSearch(res, body as UserSearchBody);
      case 'POST /ISAPI/AccessControl/AcsEvent':
        return this.eventSearch(res, body as EventSearchBody);
      default:
        return send(res, 404, statusXml('Invalid Operation', 'notSupport'), 'application/xml');
    }
  }

  /** Answers the 401 itself when the request is not properly authenticated. */
  private authorize(req: IncomingMessage, res: ServerResponse): boolean {
    const { username, password, algorithm, basicOnly } = this.options;
    if (basicOnly) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DS-K1T"' }).end();
      return false;
    }
    const challenge: DigestChallenge = {
      scheme: 'Digest',
      realm: 'DS-K1T',
      nonce: this.nonce,
      qop: 'auth',
      opaque: 'fake-opaque',
      algorithm: algorithm!,
      stale: false,
    };
    const auth = parseDigestAuthorization(req.headers.authorization);
    const expected =
      auth.response &&
      digestResponse(challenge, {
        method: req.method ?? 'GET',
        uri: auth.uri ?? '',
        username: username!,
        password: password!,
        nonceCount: Number.parseInt(auth.nc ?? '0', 16),
        cnonce: auth.cnonce ?? '',
      });
    const valid =
      auth.username === username &&
      auth.uri === req.url &&
      auth.nonce === this.nonce &&
      auth.response === expected;
    if (valid) return true;

    const stale = Boolean(auth.nonce) && auth.nonce !== this.nonce;
    res
      .writeHead(401, {
        'WWW-Authenticate':
          `Digest qop="auth", realm="${challenge.realm}", nonce="${this.nonce}", ` +
          `opaque="${challenge.opaque}", algorithm=${algorithm}, stale=${stale ? 'TRUE' : 'FALSE'}`,
      })
      .end();
    return false;
  }

  private deviceInfoXml(): string {
    const o = this.options;
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<DeviceInfo version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">\n' +
      '<deviceName>Acceso &amp; Asistencia</deviceName>\n' +
      `<model>${o.model}</model>\n<serialNumber>${o.serialNumber}</serialNumber>\n` +
      `<firmwareVersion>${o.firmwareVersion}</firmwareVersion>\n<deviceType>ACS</deviceType>\n` +
      '</DeviceInfo>'
    );
  }

  private timeXml(): string {
    const now = this.options.deviceTime ?? formatLocalIso(new Date(), this.options.timezone!);
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n<Time version="2.0">\n<timeMode>NTP</timeMode>\n' +
      `<localTime>${now}</localTime>\n<timeZone>CST+5:00:00</timeZone>\n</Time>`
    );
  }

  private userSearch(res: ServerResponse, body: UserSearchBody): void {
    const cond = body?.UserInfoSearchCond;
    if (!cond) return send(res, 400, statusXml('Invalid Content', 'badJsonContent'));
    const page = this.page(this.options.users!, cond.searchResultPosition, cond.maxResults);
    json(res, {
      UserInfoSearch: {
        searchID: cond.searchID,
        responseStatusStrg: page.status,
        numOfMatches: page.items.length,
        totalMatches: page.total,
        UserInfo: page.items.map((u) => ({
          employeeNo: u.employeeNo,
          name: u.name,
          userType: 'normal',
          localUIRight: Boolean(u.admin),
        })),
      },
    });
  }

  private eventSearch(res: ServerResponse, body: EventSearchBody): void {
    const cond = body?.AcsEventCond;
    if (!cond) return send(res, 400, statusXml('Invalid Content', 'badJsonContent'));
    const tz = this.options.timezone!;
    const start = parseIsapiTime(cond.startTime, tz).getTime();
    const end = parseIsapiTime(cond.endTime, tz).getTime();

    // Every stored event is an access-control one (major 5); minor 0 means "any minor".
    const majorMatches = cond.major === ACS_MAJOR_EVENT || cond.major === 0;
    const matching = this.options
      .events!.filter(() => majorMatches)
      .filter((e) => !cond.minor || (e.minor ?? ACS_MINOR.FACE_PASSED) === cond.minor)
      .filter((e) => {
        const t = parseIsapiTime(e.time, tz).getTime();
        return t >= start && t <= end;
      })
      .sort((a, b) => parseIsapiTime(a.time, tz).getTime() - parseIsapiTime(b.time, tz).getTime());

    const page = this.page(matching, cond.searchResultPosition, cond.maxResults);
    json(res, {
      AcsEvent: {
        searchID: cond.searchID,
        responseStatusStrg: page.status,
        numOfMatches: page.items.length,
        totalMatches: page.total,
        ...(page.items.length > 0 && {
          InfoList: page.items.map((e) => ({
            major: ACS_MAJOR_EVENT,
            minor: e.minor ?? ACS_MINOR.FACE_PASSED,
            time: e.time,
            employeeNoString: e.employeeNo,
            ...(e.serialNo !== undefined && { serialNo: e.serialNo }),
            attendanceStatus: e.attendanceStatus ?? 'checkIn',
            currentVerifyMode: 'cardOrFaceOrFp',
            doorNo: 1,
            cardReaderNo: 1,
          })),
        }),
      },
    });
  }

  private page<T>(items: T[], position = 0, requested = 30) {
    const size = Math.min(requested, this.options.maxResults!);
    const slice = items.slice(position, position + size);
    const status =
      items.length === 0 ? 'NO MATCH' : position + slice.length < items.length ? 'MORE' : 'OK';
    return { items: slice, total: items.length, status };
  }
}

interface UserSearchBody {
  UserInfoSearchCond?: { searchID: string; searchResultPosition: number; maxResults: number };
}

interface EventSearchBody {
  AcsEventCond?: {
    searchID: string;
    searchResultPosition: number;
    maxResults: number;
    major: number;
    minor: number;
    startTime: string;
    endTime: string;
  };
}

function newNonce(): string {
  return randomBytes(16).toString('hex');
}

function parseBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json'): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': type }).end(body);
}

function json(res: ServerResponse, body: unknown): void {
  send(res, 200, JSON.stringify(body));
}

function notSupported(res: ServerResponse): void {
  send(
    res,
    404,
    JSON.stringify({
      statusCode: 4,
      statusString: 'Invalid Operation',
      subStatusCode: 'notSupport',
    }),
  );
}

function statusXml(statusString: string, subStatusCode: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<ResponseStatus version="2.0">\n' +
    `<statusCode>4</statusCode>\n<statusString>${statusString}</statusString>\n` +
    `<subStatusCode>${subStatusCode}</subStatusCode>\n</ResponseStatus>`
  );
}
