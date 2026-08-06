# Migrar autenticación por teléfono de Firebase Phone Auth a Twilio Verify

## Contexto / motivación

Firebase Phone Auth en plan gratuito (Spark) limita a 10 SMS/día — insuficiente para uso real. Se reemplaza el mecanismo de envío/verificación de código por Twilio Verify (cuenta y Verify Service ya existen: Account SID, Auth Token, Verify Service SID disponibles).

Email/contraseña y Google **no cambian** — siguen 100% en Firebase Auth. Firebase Auth sigue siendo el único sistema de sesión/identidad de la app: un login por teléfono verificado con Twilio termina, igual que hoy, en una sesión Firebase normal (ID token), para que todo el backend/Firestore existente (`requireUser`, `optionalUser`, `fireUpsertUser`, gate de OCR, App Check) siga funcionando sin tocarlo.

No hay usuarios reales de teléfono que migrar — el feature nunca llegó a producción con tráfico real.

## Arquitectura

**Puente Twilio → Firebase**: en vez de que el cliente llame `signInWithPhoneNumber` (Firebase) directo, el cliente llama 2 endpoints nuevos del propio backend, que hablan con Twilio Verify por REST (`fetch` plano, Basic Auth, sin SDK de Twilio — consistente con que el resto del backend evita SDKs pesados). Al aprobar Twilio el código, el backend firma él mismo un Firebase **custom token** (JWT RS256, `crypto.createSign`, mismo patrón manual que ya usa `api/auth.js` para verificar — nunca se agrega `firebase-admin`) y el cliente lo intercambia con `signInWithCustomToken`.

**Esquema de UID determinístico**: `uid = "phone:" + <teléfono E.164>` (ej. `phone:+5215512345678`). Mismo teléfono siempre mapea al mismo UID — no hace falta ninguna llamada a Identity Toolkit para buscar/crear usuario.

### Flujo de envío

```
auth-ui.js
  → POST /api/auth/phone/send { phone: "+5215512345678" }
  → backend: fetch Twilio Verify "Verifications" (Basic Auth SID:Token, Channel=sms)
  → respuesta: { status: "pending" }
```

### Flujo de verificación

```
auth-ui.js
  → POST /api/auth/phone/verify { phone, code }
  → backend: fetch Twilio Verify "VerificationCheck"
  → si status !== "approved": 401, error mapeado
  → si "approved":
      1. uid = "phone:" + phone
      2. Firestore users/{uid} existe? → isNewUser
      3. firma customToken (iss/sub = email de service account,
         aud = Identity Toolkit fijo, uid, iat/exp ≤ 1h)
      4. responde { customToken, isNewUser }
  → cliente: signInWithCustomToken(firebaseAuth, customToken)
  → onAuthStateChanged normal → mismo setAutoSyncSuppressed/consent-gate/
    syncUserProfile() que ya existe hoy, sin cambios
```

## Corrección necesaria: derivar `phoneNumber` del `uid`, no del claim del ID token

El gate de OCR (`api/index.js`) exige `req.user.emailVerified || req.user.phoneNumber` para desbloquear OCR gratis. Hoy `phoneNumber` sale del claim `phone_number` del ID token, que solo existe cuando el login fue con Firebase Phone Auth nativo. Con custom token ese claim no aparece — y meterlo como claim transitorio del custom token (`claims: { phone_number }`) tampoco sirve: esos claims transitorios NO sobreviven al refresh silencioso del SDK (~1h después), porque el refresh usa el endpoint de `securetoken.googleapis.com` directo, sin volver a pasar por nuestro custom token.

Fix: como el `uid` es determinístico y estable en cualquier token (inicial o refrescado), se deriva el teléfono del propio `uid` cuando el claim no viene. **Actualizado tras revisión del plan**: esto se centraliza en un solo lugar, `verifyFirebaseIdToken` (`api/auth.js`), del que `requireUser` y `optionalUser` ya obtienen `phoneNumber` — no hace falta duplicar la derivación en ambos middlewares:

```js
const phoneNumber = payload.phone_number || (payload.sub.startsWith('phone:') ? payload.sub.slice(6) : null);
```

Cero llamadas nuevas, cero fragilidad de refresh.

## Manejo de errores

| Caso | Respuesta |
|---|---|
| Teléfono inválido / Twilio rechaza el envío | 400, "Número de teléfono inválido" |
| Error de cuenta Twilio (saldo, suspendida, etc.) | 502, log server-side con detalle; cliente ve "No se pudo enviar el código, intenta más tarde" |
| Código incorrecto o expirado (`status !== "approved"`) | 401, "Código incorrecto o expirado" |
| Falla firma de custom token (env var mal puesta) | 500, log server-side; cliente ve error genérico de auth |
| `isNewUser`: Firestore inaccesible/ambiguo | Trata como usuario nuevo (falla hacia mostrar el consent), mismo criterio ya aplicado en la ronda de fixes anterior |

Twilio Verify ya limita reintentos de código (5 por verificación) y expira el código por su cuenta — no se reimplementa nada de eso. No se agrega rate-limit propio adicional (decisión explícita: confiar solo en la protección anti-abuso de Twilio).

## Qué se elimina

- `firebase-init.js`: imports/re-exports de `RecaptchaVerifier`, `signInWithPhoneNumber`, `getAdditionalUserInfo`.
- `auth.html`: `<div id="recaptcha-container"></div>`.
- `auth-ui.js`: toda la lógica de invisible-reCAPTCHA/RecaptchaVerifier init.

## Qué se agrega

- `firebase-init.js`: re-export de `signInWithCustomToken`.
- Backend: nuevo módulo `api/phoneAuth.js` (Twilio Verify + firma de custom token) + `POST /api/auth/phone/send`, `POST /api/auth/phone/verify` en `api/index.js`.
- `verifyFirebaseIdToken` (`api/auth.js`): derivación de `phoneNumber` desde `uid` cuando falta el claim — `requireUser`/`optionalUser` la heredan gratis, sin tocarlos.
- Nuevas env vars: solo `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. **Actualizado tras revisión del plan**: NO se necesita ninguna credencial nueva de Firebase — `FIREBASE_SERVICE_ACCOUNT_KEY` ya existe (usada por `api/firestore.js` para Firestore) y ya tiene permiso de firmar tokens para este proyecto; se reutiliza tal cual. Cero pasos manuales nuevos en Firebase Console.

## Qué NO cambia

`country-codes.js`, `setView()` y sus 4 estados de UI, el consent-gate (términos/edad), `authClient.js` (`setAutoSyncSuppressed`), `fireUpsertUser`, CSP (Twilio se llama servidor-a-servidor — nunca desde el browser, cero entradas CSP nuevas), App Check (capa ortogonal, sigue aplicando igual a email/Google).

## Testing

- Backend: mock de `fetch` global simulando Twilio Verify (aprobado/rechazado/error de cuenta); verifica llamadas correctas (Basic Auth, endpoints, payload); verifica estructura/claims del custom token firmado; verifica rama `isNewUser` contra mock de Firestore.
- `requireUser`/`optionalUser`: test de derivación de `phoneNumber` desde `uid` cuando el claim no viene en el token.
- `firebase-init.js`: quitar mocks de `RecaptchaVerifier`/`signInWithPhoneNumber`/`getAdditionalUserInfo`; agregar mock + assert de `signInWithCustomToken`.
- `auth-ui.js`: reemplazar tests de `RecaptchaVerifier`/`signInWithPhoneNumber` por mocks de `fetch` a los 2 endpoints nuevos + mock de `signInWithCustomToken`.
- **Límite real**: SMS real no se puede probar en CI. Smoke-test manual con teléfono real requerido antes de merge — no se finge esta cobertura.
