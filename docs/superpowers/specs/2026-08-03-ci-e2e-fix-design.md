# CI mínimo + fix e2e — Design

## Contexto

Auditoría técnica (2026-08-03) encontró dos bloqueadores de producción relacionados:

1. **Sin CI**: no existe `.github/workflows`. `develop`/`master` reciben push directo, Vercel auto-deploya sin ningún gate de tests. Con pagos reales (Stripe) en producción, esto es riesgo de desplegar código roto.
2. **e2e roto**: `tests/e2e/scan-cycle.spec.js` falla al correr `npm test`.

## Causa raíz del e2e roto

`vitest.config.js` solo excluye `**/node_modules/**` y `**/.worktrees/**`. `tests/e2e/scan-cycle.spec.js` matchea el glob por defecto de Vitest (`**/*.spec.js`), así que **Vitest intenta correrlo como test propio**. El archivo usa `test`/`expect` importados de `@playwright/test`, con fixtures (`{ page }`) y hooks (`test.beforeEach`) que solo existen bajo el runner de Playwright. Bajo Vitest esos fixtures no se inyectan → el test falla o no corre en absoluto.

No es un bug de Playwright ("async test.describe no soportado" era diagnóstico previo incorrecto) — son dos test runners peleando por el mismo archivo.

Adicionalmente, `playwright.config.js` tiene `webServer: null` y apunta a `baseURL: http://localhost:3459`, pero nada levanta un servidor en ese puerto automáticamente — el server estático vive en `tests/e2e/server.mjs` y hay que arrancarlo a mano hoy.

## Cambios

### 1. `vitest.config.js`
Agregar `tests/e2e/**` a `exclude`:
```js
exclude: ['**/node_modules/**', '**/.worktrees/**', 'tests/e2e/**'],
```

### 2. `playwright.config.js`
Agregar `webServer` para levantar `tests/e2e/server.mjs` automáticamente, y corregir el puerto para que coincida:
```js
webServer: {
  command: 'node tests/e2e/server.mjs 3456',
  url: 'http://localhost:3456',
  reuseExistingServer: !process.env.CI,
  timeout: 10000,
},
use: {
  baseURL: 'http://localhost:3456',
  ...
}
```

### 3. `package.json`
Agregar script:
```json
"test:e2e": "playwright test"
```

### 4. `.github/workflows/ci.yml` (nuevo)
Un job, corre en push y PR contra `develop` y `master`:
```yaml
name: CI
on:
  push:
    branches: [develop, master]
  pull_request:
    branches: [develop, master]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

No incluye build ni typecheck: no hay TypeScript ni bundler propio (Vercel build es solo inyección de config Firebase + estático).

## Fuera de alcance

- No se mueve el deploy de Vercel a GitHub Actions — Vercel sigue auto-deployando en push, sin cambios ahí.
- El gate real (bloquear merge si CI falla) requiere marcar el check como "required" en la protección de rama de GitHub — acción manual del usuario en la configuración del repo, fuera del alcance de este cambio de código. Se documenta como paso post-implementación.

## Testing

- Correr `npm test` localmente tras el cambio de exclude — debe pasar sin tocar `tests/e2e`.
- Correr `npm run test:e2e` localmente — debe levantar el server solo y pasar los specs existentes.
- Verificar el workflow corriendo en un push/PR de prueba.
