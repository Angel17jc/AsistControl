import { execSync } from 'node:child_process';
import { PassThrough, Readable, Writable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { run } from '../src/cli/create-admin';
import { TEST_DATABASE_URL } from './setup-env';

const SCHEMA = 'fresh_install';
const GIVEN = 'Clave-Inicial-2026';

/**
 * The first administrator of a real installation. It runs on a schema of its own, migrated
 * from scratch and empty, like a production database right after deploying (the shared test
 * database always has administrators).
 */
describe('create-admin command (e2e)', () => {
  let prisma: PrismaClient;

  /** Runs the command as a shell would, with the password on stdin unless told otherwise. */
  async function command(args: string[], stdin: string | null = `${GIVEN}\n`) {
    let stdout = '';
    let stderr = '';
    const sink = (append: (text: string) => void) =>
      new Writable({ write: (chunk, _encoding, next) => (append(String(chunk)), next()) });
    const code = await run(
      stdin === null ? args : [...args, '--password-stdin'],
      {
        stdin: Readable.from(stdin === null ? [] : [stdin]),
        stdout: sink((t) => (stdout += t)),
        stderr: sink((t) => (stderr += t)),
      },
      prisma,
    );
    return { code, stdout, stderr };
  }

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL);
    url.searchParams.set('schema', SCHEMA);
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    execSync('npx prisma migrate deploy', {
      cwd: `${__dirname}/..`,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'ignore',
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  it('creates the first super administrator, who must then choose a password', async () => {
    expect(await prisma.user.count()).toBe(0);

    const result = await command(['--email', ' Admin@Empresa.com ']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('Super administrator admin@empresa.com created');

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresa.com' } });
    expect(admin).toMatchObject({ role: 'SUPER_ADMIN', isActive: true, mustChangePassword: true });
    // The trailing newline of `echo` is not part of the password.
    expect(await argon2.verify(admin.passwordHash, GIVEN)).toBe(true);
    expect(
      await prisma.auditLog.findFirst({ where: { entityId: admin.id, action: 'create' } }),
    ).toMatchObject({ entity: 'User', metadata: { via: 'create-admin' } });
  });

  it('refuses another one: from then on accounts are managed in the app', async () => {
    const result = await command(['--email', 'otro@empresa.com']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('A super administrator already exists (admin@empresa.com)');
    expect(await prisma.user.count()).toBe(1);
  });

  it('gives a new password to a super administrator who lost theirs', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresa.com' } });
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
    const session = await prisma.session.create({
      data: { userId: admin.id, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 60_000) },
    });

    const result = await command(['--email', 'admin@empresa.com', '--reset'], 'Clave-Rescate-2026');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('their sessions were closed');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.mustChangePassword).toBe(true);
    expect(await argon2.verify(after.passwordHash, 'Clave-Rescate-2026')).toBe(true);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt,
    ).not.toBeNull();
  });

  it('asks twice at a terminal without echoing what is typed', async () => {
    // A terminal: raw mode on while reading, both lines pasted at once with Windows endings.
    const tty = Object.assign(new PassThrough(), { isTTY: true, setRawMode: jest.fn() });
    tty.write('Clave-Teclado-2026\r\nClave-Teclado-2026\r\n');
    let shown = '';
    const out = new Writable({ write: (chunk, _e, next) => ((shown += String(chunk)), next()) });

    const code = await run(
      ['--email', 'admin@empresa.com', '--reset'],
      {
        stdin: tty,
        stdout: out,
        stderr: out,
      },
      prisma,
    );

    expect(code).toBe(0);
    expect(shown).toContain('Password: ');
    expect(shown).toContain('Repeat it: ');
    expect(shown).not.toContain('Clave-Teclado');
    expect(tty.setRawMode.mock.calls).toEqual([[true], [false], [true], [false]]);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresa.com' } });
    expect(await argon2.verify(admin.passwordHash, 'Clave-Teclado-2026')).toBe(true);
  });

  it('rejects what it cannot do safely', async () => {
    const weak = await command(['--email', 'nuevo@empresa.com'], 'corta1');
    expect(weak).toMatchObject({ code: 1 });
    expect(weak.stderr).toContain('at least 10 characters');

    const notAdmin = await command(['--email', 'nadie@empresa.com', '--reset']);
    expect(notAdmin.stderr).toContain('No super administrator with the email nadie@empresa.com');

    // A typo in a flag must not run the command with something else than intended.
    expect((await command(['--email', 'a@b.co', '--rest'])).code).toBe(2);
    expect((await command(['--mail', 'a@b.co'])).code).toBe(2);

    // Without a terminal it cannot ask for the password without showing it.
    const noTty = await command(['--email', 'nuevo@empresa.com'], null);
    expect(noTty).toMatchObject({ code: 1 });
    expect(noTty.stderr).toContain('--password-stdin');
  });
});
