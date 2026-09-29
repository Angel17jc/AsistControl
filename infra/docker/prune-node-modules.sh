#!/bin/sh
# Removes from an installed production tree what `node` never reads. Runs in the same RUN
# as `npm ci`: deleting in a later layer would not make the image any smaller.
set -eu

npm cache clean --force
# Prisma's postinstall leaves a second copy of its engines here.
rm -rf /root/.cache
# Dependencies' source maps and type declarations.
find /app -path '*/node_modules/*' -type f \
  \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete
