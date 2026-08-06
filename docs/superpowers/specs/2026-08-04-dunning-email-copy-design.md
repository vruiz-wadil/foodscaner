# Copy diferenciado en email de pago fallido (última oportunidad)

## Contexto

`invoice.payment_failed` (`api/index.js:94-113`) manda siempre el mismo email — "Stripe lo reintentará automáticamente en los próximos días" — sin importar si es el primer intento fallido o el último. Stripe expone `subscription.next_payment_attempt` (timestamp del próximo reintento, o `null`/ausente cuando ya no habrá más reintentos y la cancelación es inminente). Hoy ese campo no se lee.

## Cambio

En el branch `invoice.payment_failed`, después de obtener `subscription` (ya se hace vía `stripeRetrieveSubscription`), leer `subscription.next_payment_attempt` y elegir entre 2 copys:

```js
const isLastAttempt = !subscription.next_payment_attempt;
const emailCopy = isLastAttempt
  ? {
      subject: 'Última oportunidad: tu membresía Premium está por vencer',
      html: `<p>Ya intentamos varias veces cobrar tu membresía y no lo logramos. Este fue el último intento automático.</p><p>Si no actualizas tu método de pago, tu cuenta pasa a plan gratis y pierdes el análisis personalizado y el historial en la nube.</p><p><a href="${process.env.APP_BASE_URL || 'https://yomi.mx'}/account.html">Actualizar método de pago</a></p>`
    }
  : {
      subject: 'No pudimos cobrar tu membresía — lo intentaremos de nuevo',
      html: `<p>Intentamos cobrar tu membresía Premium y no se pudo procesar.</p><p>Tranquilo, no tienes que hacer nada todavía — Stripe reintentará el cobro automáticamente en los próximos días.</p><p>Si tu tarjeta cambió o venció, actualízala ahora para evitar cualquier interrupción:</p><p><a href="${process.env.APP_BASE_URL || 'https://yomi.mx'}/account.html">Actualizar método de pago</a></p>`
    };

await sendMail({ to: user.email, subject: emailCopy.subject, html: emailCopy.html });
```

Sin cambios en el gate de `membershipStatus`/`autoRenew` — sigue sin tocarse acá, la única decisión nueva es qué texto mandar.

## Sin cambios

- `customer.subscription.deleted` (marca `expired`), demás branches del webhook: sin cambios.
- Envoltura try/catch alrededor de `sendMail` (agregada en la fase anterior): se mantiene igual, ahora envuelve la selección de copy también.
