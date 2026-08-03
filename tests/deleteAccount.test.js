import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const requireFn = createRequire(import.meta.url)
const firestoreModule = requireFn('../api/firestore.js')
const stripeClientModule = requireFn('../api/stripeClient.js')

const fireGetUser = vi.fn()
const fireListUserHistory = vi.fn()
const fireDeleteUserHistoryEntry = vi.fn()
const fireDeleteDoc = vi.fn()
const deleteFirebaseAuthUser = vi.fn()
firestoreModule.fireGetUser = fireGetUser
firestoreModule.fireListUserHistory = fireListUserHistory
firestoreModule.fireDeleteUserHistoryEntry = fireDeleteUserHistoryEntry
firestoreModule.fireDeleteDoc = fireDeleteDoc
firestoreModule.deleteFirebaseAuthUser = deleteFirebaseAuthUser

const stripeCancelSubscriptionNow = vi.fn()
stripeClientModule.stripeCancelSubscriptionNow = stripeCancelSubscriptionNow

const { deleteUserAccount, deleteAccountHandler } = await import('../api/index.js')

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}

describe('deleteUserAccount', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); fireListUserHistory.mockReset(); fireDeleteUserHistoryEntry.mockReset()
    fireDeleteDoc.mockReset(); deleteFirebaseAuthUser.mockReset(); stripeCancelSubscriptionNow.mockReset()
    fireDeleteUserHistoryEntry.mockResolvedValue(true)
    fireDeleteDoc.mockResolvedValue(true)
    deleteFirebaseAuthUser.mockResolvedValue(undefined)
  })

  it('returns alreadyGone when the user does not exist, touches nothing else', async () => {
    fireGetUser.mockResolvedValue(null)

    const result = await deleteUserAccount('uid-missing')

    expect(result).toEqual({ alreadyGone: true })
    expect(stripeCancelSubscriptionNow).not.toHaveBeenCalled()
    expect(deleteFirebaseAuthUser).not.toHaveBeenCalled()
  })

  it('cancels Stripe, deletes history entries, phoneIndex, user doc, and Auth user, in that order', async () => {
    const callOrder = []
    fireGetUser.mockResolvedValue({ phoneNumber: '+525512345678', billing: { subscriptionId: 'sub_1' } })
    fireListUserHistory.mockResolvedValue([{ id: 'hist-1' }, { id: 'hist-2' }])
    stripeCancelSubscriptionNow.mockImplementation(async () => { callOrder.push('stripe') })
    fireDeleteUserHistoryEntry.mockImplementation(async () => { callOrder.push('history') })
    fireDeleteDoc.mockImplementation(async (col) => { callOrder.push('doc:' + col) })
    deleteFirebaseAuthUser.mockImplementation(async () => { callOrder.push('auth') })

    const result = await deleteUserAccount('uid-1')

    expect(result).toEqual({ alreadyGone: false })
    expect(stripeCancelSubscriptionNow).toHaveBeenCalledWith('sub_1')
    expect(fireDeleteUserHistoryEntry).toHaveBeenCalledWith('uid-1', 'hist-1')
    expect(fireDeleteUserHistoryEntry).toHaveBeenCalledWith('uid-1', 'hist-2')
    expect(fireDeleteDoc).toHaveBeenCalledWith('phoneIndex', '+525512345678')
    expect(fireDeleteDoc).toHaveBeenCalledWith('users', 'uid-1')
    expect(callOrder).toEqual(['stripe', 'history', 'history', 'doc:phoneIndex', 'doc:users', 'auth'])
  })

  it('skips Stripe cancellation when there is no subscription', async () => {
    fireGetUser.mockResolvedValue({ phoneNumber: null, billing: null })
    fireListUserHistory.mockResolvedValue([])

    await deleteUserAccount('uid-1')

    expect(stripeCancelSubscriptionNow).not.toHaveBeenCalled()
  })

  it('continues deleting data even when Stripe cancellation fails (best-effort)', async () => {
    fireGetUser.mockResolvedValue({ phoneNumber: null, billing: { subscriptionId: 'sub_1' } })
    fireListUserHistory.mockResolvedValue([])
    stripeCancelSubscriptionNow.mockRejectedValue(new Error('Stripe down'))

    const result = await deleteUserAccount('uid-1')

    expect(result).toEqual({ alreadyGone: false })
    expect(fireDeleteDoc).toHaveBeenCalledWith('users', 'uid-1')
    expect(deleteFirebaseAuthUser).toHaveBeenCalledWith('uid-1')
  })
})

describe('DELETE /api/me/account handler', () => {
  beforeEach(() => {
    fireGetUser.mockReset(); fireListUserHistory.mockReset()
    fireGetUser.mockResolvedValue({ phoneNumber: null, billing: null })
    fireListUserHistory.mockResolvedValue([])
  })

  it('deletes the account for req.user.uid (never from query/body) and responds ok', async () => {
    const req = { user: { uid: 'uid-from-token' }, query: { uid: 'uid-from-query' }, body: { uid: 'uid-from-body' } }
    const res = makeRes()

    await deleteAccountHandler(req, res)

    expect(fireGetUser).toHaveBeenCalledWith('uid-from-token')
    expect(res.body).toEqual({ ok: true })
  })

  it('responds 500 on unexpected error', async () => {
    fireGetUser.mockRejectedValue(new Error('boom'))
    const req = { user: { uid: 'uid-1' } }
    const res = makeRes()

    await deleteAccountHandler(req, res)

    expect(res.statusCode).toBe(500)
  })
})
