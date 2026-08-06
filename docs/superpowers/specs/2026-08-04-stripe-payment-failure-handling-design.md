# Manejo de pago fallido y cancelación real de suscripción

## Contexto

`stripeWebhookHandler` (`api/index.js:70-106`) hoy maneja 4 eventos de Stripe (`checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`), pero tiene 2 huecos identificados en auditoría previa a mover Stripe a modo Live:

1. **`invoice.payment_failed` no se escucha.** Cuando falla un cobro de renovación, Stripe reintenta automáticamente (dunning) durante varios días antes de cancelar la suscripción de verdad — pero hoy Yomi no le avisa nada al usuario mientras tanto. Se entera solo si intenta usar la app después de que la membresía ya venció por fecha (expiración perezosa en `requireActiveMembership`).
2. **`customer.subscription.deleted` no marca `membershipStatus`.** Solo apaga `autoRenew` (`api/index.js:97-99`). Este evento es la cancelación DEFINITIVA de Stripe (después de agotar todos los reintentos) — hoy Yomi sigue dependiendo de la expiración perezosa por fecha en vez de reaccionar de inmediato al evento.

Decisión tomada: no cortar acceso en el primer fallo de cobro (Stripe reintenta solo, cortar de inmediato penalizaría a quien paga bien 2-3 días después) — solo avisar por email. El corte real de acceso pasa a ser inmediato únicamente cuando Stripe confirma la cancelación definitiva (`customer.subscription.deleted`).

## Cambio

### 1. Nuevo handler para `invoice.payment_failed`

Nueva rama en `stripeWebhookHandler` (`api/index.js`, junto a las 4 existentes), después de `invoice.paid`:

```js
} else if (event.type === 'invoice.payment_failed') {
  const invoiceSubscriptionId = obj.parent?.subscription_details?.subscription;
  if (invoiceSubscriptionId) {
    const subscription = await stripeRetrieveSubscription(invoiceSubscriptionId);
    const uid = subscription.metadata && subscription.metadata.firebaseUid;
    if (uid) {
      const user = await fireGetUser(uid);
      if (user && user.email) {
        await sendMail({
          to: user.email,
          subject: 'No pudimos cobrar tu membresía de Yomi',
          html: `<p>No pudimos procesar el cobro de tu membresía Premium. Stripe lo reintentará automáticamente en los próximos días.</p><p>Si el problema persiste, actualiza tu método de pago desde tu cuenta:</p><p><a href="${process.env.APP_BASE_URL || 'https://yomi.mx'}/account.html">Actualizar método de pago</a></p>`
        });
      }
    }
  }
}
```

Mismo patrón de lectura que `invoice.paid` (`obj.parent?.subscription_details?.subscription` para sacar el id de suscripción — API version "basil"). `membershipStatus` NO se toca acá — el acceso sigue activo mientras Stripe reintenta.

Falla silenciosa si `user`/`user.email` no existen (no revienta el webhook por un dato faltante — mismo criterio defensivo que el resto del handler, `if (uid) await ...`).

### 2. Extender `customer.subscription.deleted` para marcar `expired` de inmediato

Reemplaza el bloque actual (`api/index.js:97-99`):

```js
} else if (event.type === 'customer.subscription.deleted') {
  const uid = obj.metadata && obj.metadata.firebaseUid;
  if (uid) await firePatchUserFields(uid, ['autoRenew'], { autoRenew: false });
}
```

por:

```js
} else if (event.type === 'customer.subscription.deleted') {
  const uid = obj.metadata && obj.metadata.firebaseUid;
  if (uid) {
    await firePatchUserFields(uid, ['autoRenew', 'membershipStatus'], {
      autoRenew: false,
      membershipStatus: 'expired'
    });
  }
}
```

`firePatchUserFields` ya soporta actualizar múltiples campos en una llamada (usado así en otros lugares del archivo, ej. `api/index.js:2264-2265`) — no requiere cambios en `firestore.js`.

## Sin cambios

- `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`: sin cambios.
- Expiración perezosa por fecha (`requireActiveMembership` chequeando `currentPeriodEnd`): se mantiene como red de seguridad para el caso donde `customer.subscription.deleted` no llegara por algún motivo (ej. webhook caído momentáneamente) — no se reemplaza, se complementa.
- `mailer.js`/`sendMail()`: sin cambios, se reusa tal cual existe hoy.
- Checklist de paso a Stripe Live (rotar env vars, crear producto en modo Live, reconfigurar webhook): sin cambios — este spec solo agrega `invoice.payment_failed` a la lista de eventos a suscribir en el webhook de Live, que de por sí ya iba a incluir los 4 eventos existentes.
