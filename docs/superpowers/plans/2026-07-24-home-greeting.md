# Saludo personalizado en el home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar "Hola {nombre}, escanea y lo sabrás en segundos." en el subtítulo del home cuando el usuario tiene un nombre guardado; dejar el texto genérico actual sin cambios cuando no lo tiene.

**Architecture:** Una función pura nueva en `home.js`, `greetingSubtitle(profile)`, calcula el texto (o `null`) a partir del mismo perfil que `home.js` ya sincroniza en su listener `DOMContentLoaded`. El listener aplica el resultado al DOM (`.heading-sub`) vía `textContent` — sin `innerHTML`, sin necesidad de escapar el nombre.

**Tech Stack:** JS clásico (no módulo, mismo patrón que el resto de `home.js`), Vitest + jsdom.

## Global Constraints

- `textContent` únicamente para insertar el nombre — nunca `innerHTML` (evita cualquier riesgo de inyección de markup, y es más simple que escapar).
- Si no hay `displayName` (sin perfil, o perfil sin nombre guardado), `.heading-sub` no se toca — mantiene el texto que ya trae `index.html`.
- El `<h1 class="heading-title">¿Puedo comerlo?</h1>` nunca cambia.
- No se modifica `redirectTargetForIncompleteOnboarding` ni el resto de la lógica de `home.js`.

---

### Task 1: `greetingSubtitle` + wiring en `DOMContentLoaded` + test

**Files:**
- Modify: `home.js`
- Test: `tests/home.test.js`

**Interfaces:**
- Produces: `function greetingSubtitle(profile)` — toma el mismo shape de perfil que `redirectTargetForIncompleteOnboarding` ya usa (`{ profile: { displayName }, displayName, ... }` o `null`), regresa un `string` con el saludo o `null` si no hay nombre.

- [ ] **Step 1: Escribir el test (RED)**

En `tests/home.test.js`, agregar `greetingSubtitle` a la extracción existente y un nuevo `describe`:

```js
let redirectTargetForIncompleteOnboarding, greetingSubtitle

beforeAll(() => {
  const fn = new Function(homeCode + '\nreturn { redirectTargetForIncompleteOnboarding, greetingSubtitle }')
  const exported = fn()
  redirectTargetForIncompleteOnboarding = exported.redirectTargetForIncompleteOnboarding
  greetingSubtitle = exported.greetingSubtitle
})
```

(Reemplaza la línea `let redirectTargetForIncompleteOnboarding` existente y el cuerpo de `beforeAll` por lo de arriba.)

Y al final del archivo, agregar:

```js

describe('greetingSubtitle', () => {
  it('regresa null sin perfil (no logueado — el subtítulo genérico de index.html no se toca)', () => {
    expect(greetingSubtitle(null)).toBeNull()
  })

  it('regresa null si el perfil no tiene displayName todavía', () => {
    expect(greetingSubtitle({ email: 'a@b.com' })).toBeNull()
  })

  it('usa profile.profile.displayName cuando existe', () => {
    expect(greetingSubtitle({ profile: { displayName: 'Ana Ruiz' } })).toBe('Hola Ana Ruiz, escanea y lo sabrás en segundos.')
  })

  it('cae a profile.displayName si profile.profile no lo tiene', () => {
    expect(greetingSubtitle({ displayName: 'Luis' })).toBe('Hola Luis, escanea y lo sabrás en segundos.')
  })
})
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `npx vitest run tests/home.test.js`
Expected: FAIL — `greetingSubtitle is not a function` (no existe aún en `home.js`).

- [ ] **Step 3: Implementar `greetingSubtitle` en `home.js`**

Justo después de la función `redirectTargetForIncompleteOnboarding` existente (antes del `document.addEventListener('DOMContentLoaded', ...)`), agregar:

```js
function greetingSubtitle(profile) {
  const displayName = profile && ((profile.profile && profile.profile.displayName) || profile.displayName || '');
  return displayName ? `Hola ${displayName}, escanea y lo sabrás en segundos.` : null;
}
```

- [ ] **Step 4: Aplicar el saludo dentro de `DOMContentLoaded`**

Dentro del listener existente, justo después de la línea:

```js
  const profile = window.authClient ? await window.authClient.syncUserProfile() : null;
```

agregar:

```js
  const greeting = greetingSubtitle(profile);
  if (greeting) {
    const headingSub = document.querySelector('.heading-sub');
    if (headingSub) headingSub.textContent = greeting;
  }

```

(antes de la línea `const redirectTarget = redirectTargetForIncompleteOnboarding(profile);` que ya existe).

- [ ] **Step 5: Correr el test para confirmar que pasa**

Run: `npx vitest run tests/home.test.js`
Expected: PASS, todos los tests verdes (los 5 existentes de `redirectTargetForIncompleteOnboarding` + los 4 nuevos de `greetingSubtitle`).

- [ ] **Step 6: Correr la suite completa para confirmar que no hay regresiones**

Run: `npx vitest run`
Expected: PASS en todas las suites salvo la falla preexistente y no relacionada de `tests/e2e/scan-cycle.spec.js` (config de Playwright, fuera de alcance).

- [ ] **Step 7: Commit**

```bash
git add home.js tests/home.test.js
git commit -m "feat(home): saludo personalizado \"Hola {nombre},\" en el subtítulo

Reemplaza el subtítulo genérico por un saludo con el nombre del
usuario cuando está disponible (independiente del método de login),
usando textContent — sin riesgo de inyección de markup. Sin nombre
disponible, el subtítulo original no cambia."
```
