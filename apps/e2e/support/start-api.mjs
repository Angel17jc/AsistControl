/**
 * Prepares the browser-test database and starts the API on top of it.
 *
 * Playwright launches its web servers before any global setup runs, so the database has to
 * be ready inside this same command: migrate, seed the demo data, then boot. The seed is
 * idempotent and the tests create their own devices, so re-running the suite is safe.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  fail('DATABASE_URL is required (playwright.config.ts passes it).');
}
// The suite truncates nothing, but it does write: refuse to run against a real database.
const name = new URL(DATABASE_URL).pathname.slice(1);
if (!name.endsWith('_test')) {
  fail(`Refusing to run browser tests against "${name}": the database name must end with _test.`);
}

// The CLI is run through Node directly: on Windows, spawning the npx shim needs a shell.
const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js');
run(['migrate', 'deploy']);
run(['db', 'seed']);

// Started from the repository root on purpose: apps/api/.env belongs to development and
// must not leak into the tests, which get their whole configuration from playwright.config.ts.
const api = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: ROOT, stdio: 'inherit' });
api.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => api.kill(signal));
}

function run(args) {
  const result = spawnSync(process.execPath, [prisma, ...args], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit',
  });
  if (result.error) fail(`prisma ${args.join(' ')} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`prisma ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

function fail(message) {
  process.stderr.write(`start-api: ${message}\n`);
  process.exit(1);
}
