# AsistControl

**Plataforma empresarial de control de asistencia, jornadas laborales y sincronización con marcadores biométricos por red LAN.**

[![CI](https://github.com/Angel17jc/AsistControl/actions/workflows/ci.yml/badge.svg)](https://github.com/Angel17jc/AsistControl/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Angel17jc/AsistControl/actions/workflows/codeql.yml/badge.svg)](https://github.com/Angel17jc/AsistControl/actions/workflows/codeql.yml)

> 🚧 Proyecto en construcción incremental. Cada módulo entra por Pull Request con CI obligatoria — el historial de PRs cuenta cómo se construyó.

## Qué contiene hoy

| Paquete                                              | Descripción                                                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/shared`](packages/shared)                 | Contratos compartidos entre API y web: enums de dominio, matriz RBAC, eventos en tiempo real.                                                             |
| [`packages/biometric-core`](packages/biometric-core) | Interfaz `BiometricDeviceAdapter` independiente del fabricante, errores tipados, registro de drivers y **simulador de marcador** con inyección de fallos. |

## Próximos PRs

- [ ] `feat(api)` — API NestJS: datos, autenticación, RBAC, motor de asistencia, sincronización con dispositivos, reportes
- [ ] `feat(web)` — Dashboard React en tiempo real
- [ ] `build(infra)` — Docker y `docker compose up -d`
- [ ] `docs` — Arquitectura, API, base de datos, seguridad y ADRs completos

## Desarrollo

```bash
npm install
npm run build:packages
npm run lint && npm run typecheck && npm test
```

## Contribuir

Trunk-based, Conventional Commits y squash merge. Ver [`docs/contributing.md`](docs/contributing.md) y las decisiones en [`docs/adr`](docs/adr).

## Licencia

[MIT](LICENSE)
