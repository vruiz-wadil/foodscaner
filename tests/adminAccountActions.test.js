import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
const firePatchUserFields = vi.fn()
const fireListUserHistory = vi.fn()
const fireDeleteUserHistoryEntry = vi.fn()
const fireDeleteDoc = vi.fn()
const deleteFirebaseAuthUser = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.firePatchUserFields = firePatchUserFields
firestoreModule.fireListUserHistory = fireListUserHistory
firestoreModule.fireDeleteUserHistoryEntry = fireDeleteUserHistoryEntry
firestoreModule.fireDeleteDoc = fireDeleteDoc
firestoreModule.deleteFirebaseAuthUser = deleteFirebaseAuthUser

const stripeCancelSubscriptionNow = vi.fn()
stripeClientModule.stripeCancelSubscriptionNow = stripeCancelSubscriptionNow

// adminDeleteAccountHandler llama a la función real deleteUserAccount (ya
// cubierta por tests/deleteAccount.test.js) — acá alcanza con mockear sus
// dependencias de firestore, mismo patrón que ese archivo (no se puede
// mockear deleteUserAccount vía module.exports self-reference: requireFn y
// el dynamic import de api/index.js son instancias de módulo separadas bajo
// Vitest, por lo que mutar el exports obtenido con requireFn no afecta a la
// versión importada dinámicamente).
const { adminCancelSubscriptionHandler, adminDeleteAccountHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('adminCancelSubscriptionHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); firePatchUserFields.mockReset(); stripeCancelSubscriptionNow.mockReset()
  })

  it('responds 404 when the user does not exist', async () => {
    fireGetUser.mockResolvedValue(null)
    const req = { params: { uid: 'uid-missing' } }
    const res = makeRes()

    await adminCancelSubscriptionHandler(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('responds 409 when the user has no subscription', async () => {
    fireGetUser.mockResolvedValue({ billing: null })
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await adminCancelSubscriptionHandler(req, res)

    expect(res.statusCode).toBe(409)
  })

  it('cancels the subscription now and clears autoRenew', async () => {
    fireGetUser.mockResolvedValue({ billing: { subscriptionId: 'sub_1' } })
    firePatchUserFields.mockResolvedValue(true)
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await adminCancelSubscriptionHandler(req, res)

    expect(stripeCancelSubscriptionNow).toHaveBeenCalledWith('sub_1')
    expect(firePatchUserFields).toHaveBeenCalledWith('uid-1', ['autoRenew'], { autoRenew: false })
    expect(res.body).toEqual({ ok: true })
  })
})

describe('adminDeleteAccountHandler', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); fireListUserHistory.mockReset(); fireDeleteUserHistoryEntry.mockReset()
    fireDeleteDoc.mockReset(); deleteFirebaseAuthUser.mockReset(); stripeCancelSubscriptionNow.mockReset()
    fireDeleteUserHistoryEntry.mockResolvedValue(true)
    fireDeleteDoc.mockResolvedValue(true)
    deleteFirebaseAuthUser.mockResolvedValue(undefined)
  })

  it('deletes the account for the uid in the URL param', async () => {
    fireGetUser.mockResolvedValue({ phoneNumber: null, billing: null })
    fireListUserHistory.mockResolvedValue([])
    const req = { params: { uid: 'uid-target' } }
    const res = makeRes()

    await adminDeleteAccountHandler(req, res)

    expect(fireGetUser).toHaveBeenCalledWith('uid-target')
    expect(fireDeleteDoc).toHaveBeenCalledWith('users', 'uid-target')
    expect(res.body).toEqual({ ok: true })
  })

  it('responds 500 on unexpected error', async () => {
    fireGetUser.mockRejectedValue(new Error('boom'))
    const req = { params: { uid: 'uid-1' } }
    const res = makeRes()

    await adminDeleteAccountHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
