/**
 * The first administrator of a new installation. Production starts with no accounts, and the
 * demo seed refuses to run there:
 *
 *   docker compose exec api node dist/cli/create-admin.js --email admin@empresa.com
 *
 * Asks for the password twice without showing it, or reads it from stdin with
 * --password-stdin (for scripts: `printf '%s' "$PASS" | docker compose exec -T api …`).
 * Refuses while an active super administrator exists: from then on, accounts are managed in
 * the app. --reset gives a new password to an existing super administrator who lost theirs
 * (whoever runs this has the server, and so the database, anyway). Either way the owner must
 * choose their own password when signing in, and the audit log records it.
 */
import { PrismaClient } from '@prisma/client';
import { isStrongPassword } from '@asistcontrol/shared';
import { hashPassword } from '../auth/password-hashing';

export interface AdminInput {
  email: string;
  password: string;
  reset: boolean;
}

export interface AdminResult {
  action: 'created' | 'reset';
  id: string;
  email: string;
}

/** A refusal the operator can act on; anything else is a bug or an infrastructure failure. */
export class AdminCommandError extends Error {}

export async function createAdmin(prisma: PrismaClient, input: AdminInput): Promise<AdminResult> {
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) throw new AdminCommandError(`Not a valid email address: "${input.email}"`);
  if (!isStrongPassword(input.password)) {
    throw new AdminCommandError('The password needs at least 10 characters, letters and numbers');
  }
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    if (input.reset) {
      const user = await tx.user.findUnique({ where: { email } });
      if (user?.role !== 'SUPER_ADMIN') {
        throw new AdminCommandError(`No super administrator with the email ${email}`);
      }
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: true, isActive: true },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: 'update',
          entity: 'User',
          entityId: user.id,
          metadata: { passwordReset: true, reactivated: !user.isActive, via: 'create-admin' },
        },
      });
      return { action: 'reset', id: user.id, email };
    }

    const existing = await tx.user.findFirst({
      where: { role: 'SUPER_ADMIN', isActive: true },
      select: { email: true },
    });
    if (existing) {
      throw new AdminCommandError(
        `A super administrator already exists (${existing.email}): manage accounts in the app, ` +
          'or use --reset if that account lost its password',
      );
    }
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new AdminCommandError(`An account with the email ${email} already exists`);
    }
    const user = await tx.user.create({
      data: { email, passwordHash, role: 'SUPER_ADMIN', mustChangePassword: true },
    });
    await tx.auditLog.create({
      data: {
        action: 'create',
        entity: 'User',
        entityId: user.id,
        metadata: { email, role: 'SUPER_ADMIN', via: 'create-admin' },
      },
    });
    return { action: 'created', id: user.id, email };
  });
}

/** One "@", something on both sides, a dot in the domain, no spaces. Linear on any input. */
function isEmail(value: string): boolean {
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@') || /\s/.test(value)) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return value.length <= 254 && dot > 0 && dot < domain.length - 1;
}

interface Io {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown };
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

const USAGE = 'Usage: node dist/cli/create-admin.js --email <email> [--reset] [--password-stdin]';

/** Parses the arguments, gets the password and runs the command; returns the exit code. */
export async function run(argv: string[], io: Io, prisma: PrismaClient): Promise<number> {
  const options = parse(argv);
  if (!options) {
    io.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const password = options.passwordStdin ? await readAll(io.stdin) : await promptTwice(io);
    const result = await createAdmin(prisma, {
      email: options.email,
      password,
      reset: options.reset,
    });
    io.stdout.write(
      result.action === 'created'
        ? `Super administrator ${result.email} created. They must choose their own password ` +
            'when signing in.\n'
        : `New password set for ${result.email}; their sessions were closed. They must choose ` +
            'their own password when signing in.\n',
    );
    return 0;
  } catch (error) {
    if (!(error instanceof AdminCommandError)) throw error;
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

/** Known flags only: a typo must not run the command with something else than intended. */
function parse(argv: string[]) {
  let email: string | undefined;
  let reset = false;
  let passwordStdin = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email') email = argv[++i];
    else if (arg === '--reset') reset = true;
    else if (arg === '--password-stdin') passwordStdin = true;
    else return null;
  }
  return email ? { email, reset, passwordStdin } : null;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += String(chunk);
  // A trailing newline comes from `echo`, not from the password.
  return text.replace(/\r?\n$/, '');
}

async function promptTwice(io: Io): Promise<string> {
  if (!io.stdin.isTTY || !io.stdin.setRawMode) {
    throw new AdminCommandError(
      'No terminal to ask for the password: run with "exec -it", or pass --password-stdin',
    );
  }
  const first = await readHidden(io, 'Password: ');
  const second = await readHidden(io, 'Repeat it: ');
  if (first !== second) throw new AdminCommandError('The passwords do not match');
  return first;
}

const ENTER = new Set(['\r', '\n']);
const CTRL_C = String.fromCodePoint(3);
const BACKSPACE = new Set([String.fromCodePoint(127), String.fromCodePoint(8)]);

/** Reads a line from the terminal without echoing it. */
function readHidden(io: Io, prompt: string): Promise<string> {
  const { stdin, stdout } = io;
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (finish: () => void) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write('\n');
      finish();
    };
    const onData = (chunk: Buffer | string) => {
      const chars = [...String(chunk)];
      for (const [i, char] of chars.entries()) {
        if (ENTER.has(char)) {
          // A paste can bring the next line in the same chunk: leave it for the next read
          // (without the "\n" of a "\r\n" line ending, or that read would end empty).
          const next = char === '\r' && chars[i + 1] === '\n' ? i + 2 : i + 1;
          const rest = chars.slice(next).join('');
          return done(() => {
            if (rest) stdin.unshift(rest);
            resolve(value);
          });
        }
        if (char === CTRL_C) return done(() => reject(new AdminCommandError('Cancelled')));
        value = BACKSPACE.has(char) ? value.slice(0, -1) : value + char;
      }
    };
    stdout.write(prompt);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  run(process.argv.slice(2), process, prisma)
    .then((code) => (process.exitCode = code))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
