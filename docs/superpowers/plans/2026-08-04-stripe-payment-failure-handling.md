# Stripe Payment Failure Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `invoice.payment_failed` handler that emails the user (no access change — Stripe retries automatically) and extend `customer.subscription.deleted` to mark `membershipStatus: 'expired'` immediately (this event means Stripe already exhausted all retries — it's the real, final cancellation).

**Architecture:** Two new/extended branches inside the existing `stripeWebhookHandler` function in `api/index.js`. No new files, no new dependencies — reuses `fireGetUser`, `firePatchUserFields` (already imported from `./firestore`) and `sendMail` (already imported from `./mailer`).

**Tech Stack:** Express, Vitest.

## Global Constraints

- `invoice.payment_failed` must NEVER touch `membershipStatus` or `autoRenew` — only sends an email. Access stays active while Stripe retries.
- Email failure (missing user, missing email, `sendMail` throwing) must not crash the webhook handler — same defensive `if (uid) await ...` pattern already used by the other branches, wrapped by the handler's existing outer `try/catch` (which already returns 500 on any thrown error inside the branches — this is existing behavior, not something to add).
- `customer.subscription.deleted` must set BOTH `autoRenew: false` AND `membershipStatus: 'expired'` in a single `firePatchUserFields` call (not two separate calls).
- Email subject and body copy, exact: subject `'No pudimos cobrar tu membresía de Yomi'`; body per the spec's HTML string, using `process.env.APP_BASE_URL || 'https://yomi.mx'` for the link (same fallback pattern already used at `api/index.js:1693`).

---

### Task 1: Add `invoice.payment_failed` handler + extend `customer.subscription.deleted`

**Files:**
- Modify: `api/index.js` — `stripeWebhookHandler` function (add a new `else if` branch after `invoice.paid`, and replace the existing `customer.subscription.deleted` branch)
- Test: `tests/stripeWebhook.test.js`

**Interfaces:**
- Consumes: `fireGetUser(uid)` (already imported, returns `{email, ...}` or `null` — see `api/firestore.js:458+`), `sendMail({to, subject, html})` (already imported from `./mailer`), `firePatchUserFields(uid, fields[], values{})` (already imported, already used elsewhere with multiple fields e.g. `api/index.js:2264-2265`).
- Produces: no new exports — `stripeWebhookHandler`'s signature and existing behavior for the other 4 event types is unchanged.

- [ ] **Step 1: Read the current handler and test file in full**

Read `stripeWebhookHandler` in `api/index.js` (currently ~lines 70-106) and `tests/stripeWebhook.test.js` in full before editing — confirm exact current line numbers and the existing mock setup pattern (module-level `vi.fn()` overwrites on `firestoreModule`/`stripeClientModule`, imported once at the top of the test file).

- [ ] **Step 2: Write the failing tests**

In `tests/stripeWebhook.test.js`, first add two new mocked functions at the top of the file, alongside the existing ones:

```js
const fireGetUser = vi.fn()
const sendMail = vi.fn()
firestoreModule.fireGetUser = fireGetUser
const mailerModule = requireFn('../api/mailer.js')
mailerModule.sendMail = sendMail
```

Add `fireGetUser.mockReset(); sendMail.mockReset()` to the existing `beforeEach` block (alongside the other `.mockReset()` calls already there).

Then add these test cases inside the `describe('stripeWebhookHandler', ...)` block, after the existing `'ignores an invoice.paid with no subscription...'` test:

```js
  it('sends a payment-failed email on invoice.payment_failed, without touching membershipStatus', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { parent: { subscription_details: { subscription: 'sub_1' } } } }
    })
    stripeRetrieveSubscription.mockResolvedValue({
      id: 'sub_1', metadata: { firebaseUid: 'uid-1' }
    })
    fireGetUser.mockResolvedValue({ email: 'user@example.com' })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(sendMail).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'No pudimos cobrar tu membresía de Yomi',
      html: expect.stringContaining('account.html')
    })
    expect(firePatchUserFields).not.toHaveBeenCalled()
    expect(res.body).toEqual({ received: true })
  })

  it('does not send an email or throw when the user has no email on invoice.payment_failed', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { parent: { subscription_details: { subscription: 'sub_1' } } } }
    })
    stripeRetrieveSubscription.mockResolvedValue({ id: 'sub_1', metadata: { firebaseUid: 'uid-1' } })
    fireGetUser.mockResolvedValue({ email: null })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(sendMail).not.toHaveBeenCalled()
    expect(res.body).toEqual({ received: true })
  })

  it('ignores an invoice.payment_failed with no subscription in parent.subscription_details', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { parent: { subscription_details: {} } } }
    })
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(stripeRetrieveSubscription).not.toHaveBeenCalled()
    expect(res.body).toEqual({ received: true })
  })
```

Then REPLACE the existing test `'sets autoRenew false on customer.subscription.deleted'` (currently asserts `firePatchUserFields` called with `['autoRenew'], { autoRenew: false }`) with:

```js
  it('sets autoRenew false AND membershipStatus expired on customer.subscription.deleted', async () => {
    constructStripeEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { firebaseUid: 'uid-1' } } }
    })
    firePatchUserFields.mockResolvedValue(true)
    const res = makeRes()

    await stripeWebhookHandler(makeReq(), res)

    expect(firePatchUserFields).toHaveBeenCalledWith(
      'uid-1',
      ['autoRenew', 'membershipStatus'],
      { autoRenew: false, membershipStatus: 'expired' }
    )
  })
```

- [ ] **Step 3: Run the new/changed tests to verify they fail**

Run: `npx vitest run tests/stripeWebhook.test.js`
Expected: FAIL — the `invoice.payment_failed` branch doesn't exist yet (those 3 new tests fail), and the changed `customer.subscription.deleted` test fails because the current code only patches `['autoRenew']`.

- [ ] **Step 4: Add the `invoice.payment_failed` branch**

In `api/index.js`, in `stripeWebhookHandler`, add this new `else if` branch immediately after the existing `invoice.paid` branch (before `customer.subscription.updated`):

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
```

- [ ] **Step 5: Extend the `customer.subscription.deleted` branch**

Replace the current block:

```js
    } else if (event.type === 'customer.subscription.deleted') {
      const uid = obj.metadata && obj.metadata.firebaseUid;
      if (uid) await firePatchUserFields(uid, ['autoRenew'], { autoRenew: false });
    }
```

with:

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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/stripeWebhook.test.js`
Expected: PASS, all tests including the 3 new ones and the changed one.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all pre-existing tests still pass, no regressions. Note: this repo may have a sibling `.claude/worktrees/` directory that causes an unrelated, pre-existing Playwright test-collection failure when vitest globs broadly — that specific failure is not caused by this change, ignore it if present.

- [ ] **Step 8: Commit**

```bash
git add api/index.js tests/stripeWebhook.test.js
git commit -m "feat(stripe): notifica pago fallido por email y marca expired en cancelacion definitiva

invoice.payment_failed ahora envia un correo avisando al usuario, sin
tocar membershipStatus (Stripe reintenta el cobro solo). El corte de
acceso real pasa a ser inmediato en customer.subscription.deleted
(cancelacion definitiva tras agotar reintentos) en vez de depender
solo de la expiracion perezosa por fecha."
```

---

## Self-Review Notes

- Spec coverage: `invoice.payment_failed` handler with email, no access change → Task 1 Step 4. `customer.subscription.deleted` extended to mark `expired` → Task 1 Step 5. Both covered by the same task since they're two small edits to the same function, reviewed together for coherence.
- No placeholders — full code given verbatim for both branches and all 4 test cases (3 new + 1 changed).
- Type/signature consistency: `fireGetUser`, `sendMail`, `firePatchUserFields` are consumed with their existing, already-established signatures — no new exports, no signature changes to `stripeWebhookHandler`.
