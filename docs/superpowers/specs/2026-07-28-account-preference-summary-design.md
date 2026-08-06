# Resumen visual del perfil alimenticio en Mi cuenta — Diseño

## Contexto

`account-ui.js`'s `renderAccountHub()` muestra hoy, cuando el usuario ya configuró preferencias:

```html
<p class="account-summary">Tu perfil: organic, lacteos, celiac...</p>
```

Concatena los códigos internos crudos (`prefs.dietary`, `prefs.allergens.map(a => a.code)`, `prefs.healthConditions`), mezclando inglés/español (`organic`, `caseinFree`, `glutenFree` vs `lacteos`, `celiac`) sin traducir ni dar contexto visual. El usuario pidió que sea más visual/amigable y que no mezcle idiomas.

Los códigos ya tienen traducción + emoji definidos como markup en `preferences.html` (tiles de dietético/salud/alérgenos), pero esa traducción vive solo en el HTML de esa página — `account-ui.js` no tiene acceso a ella sin duplicar strings o leer el DOM de otra página.

## Arquitectura

Nuevo módulo `preference-labels.js`, única fuente de verdad para traducir código→texto visible:

- `DIETARY_LABELS`, `HEALTH_LABELS`, `ALLERGEN_LABELS`: objetos `{ [code]: { emoji, label } }`, con los mismos 12 + 4 + 8 códigos y emojis ya usados en `preferences.html`.
- `SEVERITY_LABELS`: `{ mild: 'Aviso', severe: 'Estricto' }`.
- `CATEGORY_META`: `{ dietary: { emoji: '🌱', singular: 'dietético', plural: 'dietéticos' }, allergens: { emoji: '⚠️', singular: 'alergia', plural: 'alergias' }, health: { emoji: '❤️', singular: 'condición', plural: 'condiciones' } }`.
- `buildPreferenceSummary(prefs)`: función pura que devuelve `{ counts: [{emoji, text}], chips: [{category, emoji, label, extra}] }` — `counts` es la lista de categorías con al menos 1 item (con singular/plural ya resuelto), `chips` es la lista completa para la vista expandida (alergias incluyen `extra` = label de severidad).

`account-ui.js` importa y usa `buildPreferenceSummary`; no duplica ninguna tabla de traducción.

## Comportamiento en Mi cuenta

Reemplaza el `<p class="account-summary">` por:

- **Colapsado (default):** una línea con los conteos por categoría separados por " · " (ej. `🌱 2 dietéticos · ⚠️ 1 alergia · ❤️ 1 condición`), más un botón "Ver todo ▾".
- **Expandido:** al hacer click en el botón, se agrega debajo (misma card, sin navegar) una vista agrupada por categoría — mini-header de categoría + fila de chips (emoji + label) para cada una de las 3 categorías con al menos 1 item. Chips de alergia muestran también la severidad (`🥛 Lácteos · Estricto`) y usan color según severidad (rojo para Estricto, ámbar para Aviso — mismos tonos que ya usa `.allergen-grid-item.detected`/`.traces` en `styles.css`). El botón cambia a "Ocultar ▲"; click de nuevo colapsa.
- Sin persistencia entre cargas de página — siempre arranca colapsado al entrar a Mi cuenta.
- Implementación del toggle: variable de módulo `preferenceSummaryExpanded` (booleano, default `false`) en `account-ui.js`; el click handler la invierte y vuelve a llamar `renderAccountHub()` (ya reconstruye todo `root.innerHTML` en cada llamada — mismo patrón que el resto del archivo, sin estado nuevo tipo "parchear el DOM a mano").
- Categorías sin ningún item (conteo 0) no aparecen ni en la línea colapsada ni en la vista expandida.
- Código sin match en el mapa de labels (dato viejo/corrupto) se muestra tal cual, sin emoji — nunca rompe el render.
- Sin preferencias configuradas: sin cambios, se mantiene el mensaje actual "Aún no configuraste tus preferencias."

## Testing

- `tests/preference-labels.test.js` (nuevo): `buildPreferenceSummary` — conteos correctos y singular/plural, categorías en 0 omitidas de `counts`, chips completos con emoji/label/severidad correctos, código desconocido no rompe (se incluye con label = el código crudo, sin emoji), `prefs` vacío/null devuelve `{counts: [], chips: []}`.
- `tests/account-ui.test.js` (modificar): la función de render debe seguir mostrando el mensaje vacío cuando no hay preferencias; con preferencias, debe llamar a `buildPreferenceSummary` y renderizar el HTML esperado (línea de conteos + botón); el toggle expand/collapse se prueba llamando directamente a la función/handler exportado, no disparando eventos DOM reales (patrón ya usado en este archivo — ver el bloque de comentarios sobre `DOMContentLoaded` en `tests/preferences-ui.test.js`).
