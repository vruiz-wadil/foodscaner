// Wrapper delgado sobre la API REST de Stripe (mismo patrón que api/phoneAuth.js
// para Twilio) — sin agregar el SDK npm `stripe`, todo vía fetch +
// application/x-www-form-urlencoded.
const crypto = require('crypto');

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

// Versión de la API fijada explícitamente. Es la default actual de la cuenta,
// pero pinnearla evita que un bump del lado de Stripe cambie la forma de las
// respuestas sin avisar (p. ej. current_period_end movió de Subscription a
// subscription.items.data[0], e Invoice.subscription a
// invoice.parent.subscription_details.subscription en "basil").
const STRIPE_API_VERSION = '2026-06-24.dahlia';

function stripeAuthHeader() {
  const key = process.env.STRIPE_SECRET_KEY;
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

async function stripeRequest(method, path, params) {
  let url = `${STRIPE_API_BASE}${path}`;
  const opts = {
    method,
    headers: { Authorization: stripeAuthHeader(), 'Stripe-Version': STRIPE_API_VERSION },
    signal: AbortSignal.timeout(10000)
  };
  if (params && method === 'GET') {
    url += `?${new URLSearchParams(params).toString()}`;
  } else if (params) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params);
  }
  const resp = await fetch(url, opts);
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Stripe API error (status ${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

async function stripeCreateCustomer({ email, uid }) {
  return stripeRequest('POST', '/customers', { email, 'metadata[firebaseUid]': uid });
}

async function stripeCreateCheckoutSession({ customerId, priceId, uid, successUrl, cancelUrl }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: uid,
    'subscription_data[metadata][firebaseUid]': uid,
    success_url: successUrl,
    cancel_url: cancelUrl
  });
}

async function stripeRetrieveCheckoutSession(sessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

async function stripeRetrieveSubscription(subscriptionId) {
  return stripeRequest('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

async function stripeUpdateSubscription(subscriptionId, { cancelAtPeriodEnd }) {
  return stripeRequest('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    cancel_at_period_end: cancelAtPeriodEnd ? 'true' : 'false'
  });
}

const WEBHOOK_TOLERANCE_SECONDS = 300;

function constructStripeEvent(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader) throw new Error('Falta el header Stripe-Signature');
  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error('Header Stripe-Signature malformado');

  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
    throw new Error('Firma de webhook inválida');
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Timestamp del webhook fuera de tolerancia');
  }

  return JSON.parse(rawBody.toString('utf8'));
}

module.exports = {
  stripeCreateCustomer, stripeCreateCheckoutSession, stripeRetrieveCheckoutSession,
  stripeRetrieveSubscription, stripeUpdateSubscription, constructStripeEvent
};
