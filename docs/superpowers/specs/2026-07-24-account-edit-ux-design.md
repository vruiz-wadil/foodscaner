# Rediseño UX de edición de datos en "Mi cuenta"

## Problema

`account-ui.js` implementa la edición de datos (nombre, teléfono, correo, contraseña) detrás de un botón "Editar mis datos" que despliega 4 `<form>` apilados, cada uno con su propio botón "Guardar X" visible al mismo tiempo. El usuario ve hasta 4 botones primarios simultáneos, formulario largo, poco claro cuál guarda qué.

## Objetivo

Reducir a un patrón donde:
- Los datos simples (nombre, teléfono cuando el login es email) se editan inline, un campo a la vez, sin formulario expandido.
- Los cambios sensibles/multi-paso (correo, teléfono cuando el login es SMS, contraseña) usan un modal dedicado — ya lo requieren por naturaleza (reautenticación o código de verificación), así que aislarlos en modal no pierde nada y limpia la pantalla principal.
- La sección de datos queda siempre visible (sin toggle "Editar mis datos") porque ya no es una lista de formularios, son solo filas de texto.

## Diseño

### Estructura visual (siempre visible en la pantalla de cuenta, sin toggle)

```
┌ Nombre ──────────────────── ✏️ ┐
│ Valeria Ruiz                    │
├ Teléfono ──────────────────✏️ ┤
│ +52 55 1234 5678                │
├ Correo ─────────────────── ✏️ ┤
│ valeria@example.com             │
├──────────────────────────────── ┤
│ Cambiar contraseña (link)       │
└──────────────────────────────── ┘
```

### Edición inline (nombre; teléfono solo si el usuario tiene login por correo)

Click en ✏️ de esa fila → la fila cambia a: `<input>` + ✔️ (guardar) + ✖️ (cancelar), reemplazando el texto. Solo una fila puede estar en edición a la vez — abrir otra cierra la anterior sin guardar.

- ✔️ llama al mismo endpoint que hoy (`PUT /api/me/profile` con `displayName` o `phone`), re-renderiza la fila con el valor nuevo.
- ✖️ descarta el input y vuelve a mostrar el valor guardado, sin llamar al backend.
- Error de guardado: mensaje inline debajo de la fila (mismo estilo `role="alert"` que ya existe), el input permanece editable para reintentar.

### Modal (correo, teléfono vía SMS, contraseña)

Un componente modal genérico reutilizable, reemplaza el patrón actual de mostrar/ocultar `<form>` completos:

- **Correo**: abre modal con "Correo nuevo" + "Confirma tu contraseña actual" + botón "Guardar". Misma lógica de `submitEmailEdit` (reauth → `verifyBeforeUpdateEmail`), mismo mensaje de éxito ("Revisa tu correo nuevo..."). El modal se cierra solo si el usuario lo cierra manualmente tras ver el mensaje de éxito (no hay redirect, el cambio real ocurre cuando confirma el link del correo).
- **Teléfono (login SMS, sin correo)**: abre modal con el flujo de 2 pasos ya existente — nuevo número + "Enviar código", luego código + "Confirmar cambio". Misma lógica de `submitPhoneSendCode`/`submitPhoneChangeConfirm`.
- **Contraseña**: fila "Cambiar contraseña" es un link/botón texto (no una fila de dato, es una acción). Abre modal con actual/nueva/confirmar + botón "Guardar". Misma lógica de `submitPasswordEdit`.

Todos los modales: overlay oscuro + tarjeta centrada, botón X o click fuera para cerrar, Escape para cerrar. Un solo modal abierto a la vez.

## Qué NO cambia

- Ningún endpoint de backend (`/api/me/profile`, `/api/me/phone/change`, `/api/auth/phone/send`) cambia — es un rediseño de interacción sobre el frontend existente.
- La lógica de `hasPasswordProvider()` sigue gatillando si "Correo"/"Contraseña" se muestran (ya lo hacen hoy).
- Los mensajes de error/éxito por campo mantienen el texto actual, solo cambia dónde/cómo se muestran (inline bajo la fila vs. dentro del modal).

## Archivos afectados

- `account-ui.js`: reescribir `renderAccountHub` (quitar toggle, filas + pencils) y las funciones `submit*` para operar contra el nuevo DOM (inputs inline por fila, modales). Añadir un helper modal genérico (`openModal(contentHtml)` / `closeModal()`).
- CSS (`styles.css` o `home.css`, el que ya tenga los estilos de `.row-card`/`.form-field`): estilos nuevos para fila-editable-inline y modal genérico.
- Tests existentes de `account-ui` (si existen) se actualizan al nuevo DOM.

## Fuera de alcance

- No se añade edición de foto de perfil, ni nuevos campos.
- No se cambia el flujo de renovación de membresía (`btn-renew-membership`), sigue igual, fuera de la sección "Mis datos".
