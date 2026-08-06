# Afordancia visual del grid "Tipo de Dieta" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El hint de la sección "Tipo de Dieta" en `scan.html` es legible y usa lenguaje simple, y cada botón del grid muestra una señal visual persistente de que es tocable.

**Architecture:** Cambio de copy + CSS en `styles.css`/`scan.html` para el hint, más un badge `👆` agregado por `app.js` a cada botón del grid — mismo patrón visual ya usado por el badge `🤖` existente (posición absoluta, esquina opuesta).

**Tech Stack:** HTML/CSS/JS vanilla (sin build step para estos 3 archivos).

## Global Constraints

- Sin tests automatizados para esta sección (confirmado: `tests/` no referencia `renderDietaryBadges` ni este markup) — este task se verifica manualmente.
- El badge `👆` es puramente visual: `aria-hidden="true"`, no debe duplicarse en voz para lectores de pantalla (el botón ya tiene `aria-expanded`/`aria-controls`/`state-text`).
- Se agrega a **todos** los botones del grid, sin excepción — no solo a los estados `ai-yes`/`ai-no`.
- Sin inventar colores nuevos: el hint usa `var(--ink-3)` (`#5f7568`, ya documentado en el archivo como "~4.5:1 en --paper", cumple WCAG AA), no un valor hex nuevo.
- Fuera de alcance (no tocar en este plan): demo automática, etiqueta "IA estimó" visible, reordenar el grid por preferencias, cambios a la leyenda o al panel de detalle.

---

### Task 1: Hint legible + badge "toca aquí" en cada botón del grid

**Files:**
- Modify: `scan.html` (texto del hint, ~línea 244)
- Modify: `styles.css` (`.dietary-hint` ~línea 1026; `.dietary-grid-item` ~línea 1003-1017; nueva regla `.tap-badge`)
- Modify: `app.js` (`renderDietaryBadges`, ~línea 1029)

**Interfaces:**
- Consumes: nada de otras tasks — es la única.
- Produces: nada consumido por otras tasks — es la única.

- [ ] **Step 1: Cambiar el texto del hint en `scan.html`**

Cambia (línea 244):

```html
<p class="dietary-hint" id="dietary-hint">Toca un ícono para ver el detalle de cada clasificación.</p>
```

a:

```html
<p class="dietary-hint" id="dietary-hint">👉 Toca cualquier cuadro de color para saber qué significa</p>
```

- [ ] **Step 2: Subir contraste/tamaño del hint en `styles.css`**

Cambia (línea 1026):

```css
.dietary-hint { margin: 0 0 6px; font-size: 0.72rem; color: #6b6b6b; }
```

a:

```css
.dietary-hint { margin: 0 0 6px; font-size: 0.85rem; font-weight: 600; color: var(--ink-3); }
```

- [ ] **Step 3: Agregar `position: relative` a la regla base de `.dietary-grid-item` en `styles.css`**

Cambia (líneas 1003-1017):

```css
.dietary-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 9px 5px;
  border-radius: var(--radius-sm);
  background: var(--paper);
  border: 1.5px solid var(--border);
  box-shadow: var(--shadow-card);
  transition: var(--transition);
  cursor: pointer;
  font-family: inherit;
}
```

a:

```css
.dietary-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 9px 5px;
  border-radius: var(--radius-sm);
  background: var(--paper);
  border: 1.5px solid var(--border);
  box-shadow: var(--shadow-card);
  transition: var(--transition);
  cursor: pointer;
  font-family: inherit;
  position: relative;
}
```

(Las variantes `.ai-yes`/`.ai-no` ya declaran `position: relative;` individualmente — queda redundante para esos dos casos tras este cambio, pero no rompe nada dejarlo así; no lo quites de esas reglas en este task, no es necesario y no aporta nada tocarlo.)

- [ ] **Step 4: Agregar la regla `.tap-badge` en `styles.css`**

Agrega esto justo después de la regla `.ai-badge` ya existente (líneas 1318-1324):

```css
.tap-badge {
  position: absolute;
  top: -6px;
  left: -6px;
  font-size: 0.65rem;
  line-height: 1;
}
```

- [ ] **Step 5: Agregar el badge al render de cada botón en `app.js`**

Cambia `renderDietaryBadges` (dentro del `items.forEach(item => { ... })`, justo después de la línea que agrega el badge `ai-badge` condicional, ~línea 1030-1035):

De:

```js
    btn.innerHTML = `<span class="emoji">${item.emoji}</span><span class="state-text">${DIETARY_STATE_TEXT[item.state] || ''}</span><span class="label">${item.noun}</span>`;
    if (item.state === 'ai-yes' || item.state === 'ai-no') {
      const badge = document.createElement("span");
      badge.className = "ai-badge";
      badge.textContent = "🤖";
      btn.appendChild(badge);
    }
```

a:

```js
    btn.innerHTML = `<span class="emoji">${item.emoji}</span><span class="state-text">${DIETARY_STATE_TEXT[item.state] || ''}</span><span class="label">${item.noun}</span>`;
    if (item.state === 'ai-yes' || item.state === 'ai-no') {
      const badge = document.createElement("span");
      badge.className = "ai-badge";
      badge.textContent = "🤖";
      btn.appendChild(badge);
    }
    const tapBadge = document.createElement("span");
    tapBadge.className = "tap-badge";
    tapBadge.textContent = "👆";
    tapBadge.setAttribute("aria-hidden", "true");
    btn.appendChild(tapBadge);
```

- [ ] **Step 6: Verificar sintaxis**

Run: `node --check app.js`
Expected: sin salida (sin errores de sintaxis)

- [ ] **Step 7: Commit**

```bash
git add scan.html styles.css app.js
git commit -m "feat(scan): mejora afordancia visual del grid Tipo de Dieta (hint legible + badge toca-aquí)"
```

- [ ] **Step 8: Verificación manual**

No hay test automatizado para esta sección. Verificar manualmente:

1. Abrir `scan.html`, escanear (o simular) un producto que tenga al menos un ítem `db-yes`, uno `ai-yes` (o `ai-no`), y uno `unknown` en el grid de "Tipo de Dieta".
2. Confirmar que el hint se lee claramente ("👉 Toca cualquier cuadro de color para saber qué significa"), más grande y oscuro que antes.
3. Confirmar que **todos** los botones del grid muestran el badge 👆 en la esquina superior izquierda — incluyendo los que ya tienen 🤖 en la esquina superior derecha (confirmar que no se traslapan).
4. Con un lector de pantalla (o inspeccionando el DOM), confirmar que el `<span class="tap-badge">` tiene `aria-hidden="true"` y no se anuncia por separado.
5. Confirmar que tocar un botón sigue expandiendo/colapsando el panel de detalle exactamente igual que antes (este task no cambia esa lógica).

---

## Verificación final

Correr la suite completa: `npx vitest run` — debe dar el mismo resultado base ya conocido en este repo (todos los tests de vitest en verde; el único archivo que falla es `tests/e2e/scan-cycle.spec.js`, un problema de configuración de Playwright preexistente y no relacionado — este plan no agrega tests nuevos porque no existía cobertura previa para esta sección). Completar la verificación manual del Step 8 antes de dar el cambio por terminado.
