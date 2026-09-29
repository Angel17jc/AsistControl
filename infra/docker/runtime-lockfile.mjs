// Drops packages from the workspace manifests and the lockfile, inside the runtime image
// only, so that `npm ci` never installs them nor anything only they need (ADR 0013).
//
//   node runtime-lockfile.mjs prisma
//
// Why not `npm uninstall`: the Prisma CLI is an optional peer of @prisma/client already in the
// lockfile, and npm keeps an optional peer that the lockfile lists. Without its entry,
// `npm ci` prunes what no remaining package reaches, and keeps what is shared (e.g. dotenv,
// also used by the API). Only drop optional peers: a required one breaks `npm ci`.
import fs from 'node:fs';

const drop = new Set(process.argv.slice(2));
if (drop.size === 0) {
  console.error('usage: node runtime-lockfile.mjs <package>...');
  process.exit(2);
}

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const removed = [];

for (const [path, entry] of Object.entries(lock.packages)) {
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (path.includes('node_modules/') && drop.has(name)) {
    delete lock.packages[path];
    removed.push(path);
    continue;
  }
  // Workspaces (and the root) list their direct dependencies in the lockfile too.
  if (!path.includes('node_modules/')) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const dep of drop) delete entry[field]?.[dep];
    }
    if (path !== '') rewriteManifest(`${path}/package.json`);
  }
}
rewriteManifest('package.json');
fs.writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
process.stdout.write(`runtime lockfile: dropped ${removed.join(', ') || 'nothing'}\n`);

function rewriteManifest(file) {
  if (!fs.existsSync(file)) return;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const dep of drop) delete manifest[field]?.[dep];
  }
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
