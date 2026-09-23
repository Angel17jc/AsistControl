# Tests de navegador (Playwright)

Esta suite ejecuta el producto completo —bundle de producción del frontend, API compilada y
PostgreSQL real— en un navegador, y comprueba los flujos que ninguna otra capa puede probar:
la sesión con cookie de refresco, los guardias de rutas por rol, el ciclo de un marcador
(alta → prueba de conexión → jornada → sincronización → dashboard), las marcaciones que
llegan en vivo por WebSocket, la descarga del CSV y el uso en un teléfono.

## Ejecutar

```bash
npx playwright install chromium   # solo la primera vez
npm run test:ui                   # desde la raíz: compila y ejecuta todo
```

Desde este directorio, con los artefactos ya compilados:

```bash
npm run test:ui -w @asistcontrol/e2e
npm run test:ui:headed -w @asistcontrol/e2e   # viendo el navegador
npm run report -w @asistcontrol/e2e           # abre el último informe HTML
```

## Qué levanta

`playwright.config.ts` arranca dos servidores y los apaga al terminar:

| Servidor | Puerto (configurable)   | Cómo arranca                                              |
| -------- | ----------------------- | --------------------------------------------------------- |
| API      | `3100` (`E2E_API_PORT`) | `support/start-api.mjs`: migra, siembra y ejecuta `dist/` |
| Web      | `4173` (`E2E_WEB_PORT`) | `vite preview` con proxy `/api` y `/socket.io` a la API   |

La base de datos se toma de `E2E_DATABASE_URL`; si no está definida se usa
`asistcontrol_ui_test` en el puerto del `.env` de la raíz (5434 en esta máquina, 5432 por
defecto). El script **se niega a arrancar** si el nombre de la base no termina en `_test`,
para no escribir nunca sobre la de desarrollo.

La API de pruebas arranca con el rate limiting desactivado (`THROTTLE_ENABLED=false`): la
suite inicia sesión muchas más veces por minuto que una persona, y ese límite ya está
cubierto por los tests e2e de la API.

## Convenciones

- Los tests se escriben **en español**, como el producto, y consultan por rol y texto
  accesible (`getByRole`, `getByLabel`), no por clases CSS.
- Cada test que necesita datos **crea su propio marcador MOCK**: las marcaciones se
  deduplican por dispositivo, así que una ejecución nunca depende de las anteriores.
- La preparación que no es el objeto del test (registrar un equipo, generar marcaciones) se
  hace por API con `support/app.ts`; las comprobaciones siempre pasan por la interfaz.
- Un solo worker: la suite comparte base de datos y red de dispositivos simulados.

Cuando algo falla, el informe HTML, la traza, el vídeo y la captura quedan en
`playwright-report/` y `test-results/` (en CI se suben como artefacto del job _UI e2e_).
