# ADR 0001 — Monorepo con npm workspaces y versiones estables

- **Estado:** aceptada · 2026-09-21

## Contexto

API, web y la librería de dispositivos comparten tipos (enums de dominio, permisos, eventos en tiempo real). Mantenerlos en repositorios separados obliga a publicar paquetes y sincronizar versiones en cada cambio.

## Decisión

- Un monorepo con **npm workspaces** (`apps/*`, `packages/*`). Sin herramientas adicionales (Nx/Turborepo) hasta que el tiempo de CI lo justifique.
- `packages/shared` y `packages/biometric-core` se compilan con `tsup` a CJS + ESM + tipos, consumibles tanto por Nest (CommonJS) como por Vite (ESM).
- Versiones: la última _minor_ de la major **estable y madura** de cada familia (NestJS 11, Prisma 6, TypeScript 5.9, Vite 7, React 19). Majors publicadas recientemente (p. ej. TypeScript 7 nativo, Prisma 8 RC, NestJS 12) se adoptarán cuando su ecosistema (ts-jest, plugins) las soporte; Dependabot abre los PRs agrupados por familia.

## Consecuencias

- Un cambio de contrato (p. ej. un nuevo estado de dispositivo) se hace en un único PR y rompe la compilación de todos los consumidores si es incompatible.
- Es necesario `npm run build:packages` antes de typecheck/tests (automatizado en CI y documentado).
