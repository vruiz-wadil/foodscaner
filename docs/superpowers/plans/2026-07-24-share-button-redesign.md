# Rediseño del botón "Compartir" — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el botón "Compartir" genérico full-width por un pill pequeño dentro del banner del veredicto, coloreado automáticamente según sano/regular/evitar.

**Architecture:** Un solo cambio cohesivo entre 3 archivos (`scan.html`, `styles.css`, `app.js`) — HTML mueve el botón adentro de `#verdict-banner` junto a un nuevo `<span id="verdict-text">`; CSS usa `currentColor`/`color:inherit` para heredar el tono del veredicto sin duplicar reglas; `app.js` apunta el texto del veredicto al nuevo span en vez de pisar todo `#verdict-banner` (que borraría el botón).

**Tech Stack:** HTML/CSS estático + `app.js` (vanilla, sin build step para estos archivos).

Spec de referencia: `docs/superpowers/specs/2026-07-24-share-button-redesign-design.md`.

## Global Constraints

- Comportamiento de `shareResult()`/`share.js` NO cambia — mismo id `#btn-share-result`, mismo wiring `onclick`.
- `verdictBanner.className = 'verdict-banner verdict-' + verdict;` no cambia — sigue en el contenedor.
- `renderProductData` no está unit-testeado hoy (no aparece en la lista de funciones exportadas de `tests/app.test.js`) — este plan no le agrega testeabilidad nueva (sería scope creep para un cambio de rediseño visual); se verifica con la suite completa (regresión) + un smoke test manual/Playwright del flujo de escaneo real.
- El único test existente que toca `#verdict-banner` (`renderPersonalizedDisclaimer`, `tests/app.test.js:645`) usa un `<div>` vacío sin verificar contenido — no se ve afectado, no requiere cambios.

---

### Task 1: Mover el botón de compartir al banner del veredicto

**Files:**
- Modify: `scan.html` (estructura de `#verdict-banner` + disclaimer)
- Modify: `styles.css` (`.verdict-banner`, nueva `.verdict-share-btn`)
- Modify: `app.js` (`renderProductData` — target del texto del veredicto)

**Interfaces:**
- Produces: `#verdict-text` (nuevo span, hijo de `#verdict-banner`) — recibe el texto del veredicto. `#btn-share-result` conserva su id y su wiring externo (`app.js:1840-1843`), solo cambia de posición en el DOM.

- [ ] **Step 1: Implementar `scan.html`**

Reemplaza (busca el bloque actual del veredicto, dentro de `#result-success`):

```html
<div id="verdict-banner" class="verdict-banner" role="status"></div>
<p id="verdict-disclaimer" class="verdict-disclaimer">Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud.</p>
```

por:

```html
<div id="verdict-banner" class="verdict-banner" role="status">
  <span id="verdict-text"></span>
  <button type="button" id="btn-share-result" class="verdict-share-btn" aria-label="Compartir resultado">
    <svg class="share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"/>
      <circle cx="6" cy="12" r="3"/>
      <circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
    Compartir
  </button>
</div>
<p id="verdict-disclaimer" class="verdict-disclaimer">Estimación automatizada con IA, con fines informativos — no es un diagnóstico ni sustituye el consejo de un profesional de salud.</p>
```

Busca y **borra** el `<button type="button" id="btn-share-result" class="btn btn-secondary">Compartir</button>` viejo que existía en otra parte de `#result-success` (ya no aplica — el id se movió al botón nuevo de arriba). Confirma con un grep que `id="btn-share-result"` aparece UNA sola vez en el archivo tras el cambio.

- [ ] **Step 2: Implementar `styles.css`**

En la regla `.verdict-banner` existente, agrega `justify-content: space-between;` a las propiedades ya presentes (no la reemplaces entera, solo agrega la propiedad).

Agrega, después de la regla `.verdict-banner.hidden { display: none; }`:

```css
.verdict-share-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  background: rgba(255,255,255,0.55);
  border: 1px solid currentColor;
  color: inherit;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.verdict-share-btn .share-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Implementar `app.js`**

En `renderProductData` (dentro del bloque `if (verdictBanner) { ... }`, busca la línea):

```js
    verdictBanner.textContent = verdictText;
```

Reemplázala por:

```js
    const verdictTextEl = document.getElementById('verdict-text');
    if (verdictTextEl) verdictTextEl.textContent = verdictText;
```

No cambies la línea `verdictBanner.className = 'verdict-banner verdict-' + verdict;` ni el bloque de `btn-share-result` que sigue después — ambos quedan igual.

- [ ] **Step 4: Correr la suite completa**

Run: `npx vitest run`
Expected: PASS — mismo conteo de tests que antes de este cambio (único fallo esperado: el preexistente de Playwright/e2e, sin relación). Ningún test debería fallar por este cambio (confirmado en el spec: nada depende de `verdictBanner.textContent`/estructura interna hoy).

- [ ] **Step 5: Smoke test manual (recomendado, no bloqueante)**

Si hay forma de correr la app localmente o en un preview de Vercel: escanear un producto real, confirmar que el pill "Compartir" aparece en la esquina del banner con el color correcto (verde/ámbar/rojo según el veredicto) y que tocarlo sigue disparando `shareResult()` (Web Share API o portapapeles) igual que antes.

- [ ] **Step 6: Commit**

```bash
git add scan.html styles.css app.js
git commit -m "feat(scan): redesign share button as verdict-colored pill in the banner"
```

---

## Al terminar

Usar `superpowers:finishing-a-development-branch` para decidir push/deploy — no se hace commit a `master`/producción sin instrucción explícita del usuario (regla de sesión: `develop` únicamente).
