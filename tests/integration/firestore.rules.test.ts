import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const PROJECT_ID = 'hisab-rules-test'
const rules = readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8')

describe('Firestore security rules', () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules, host: '127.0.0.1', port: 8080 },
    })
  }, 180_000)

  afterAll(async () => {
    await testEnv?.cleanup()
  })

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'users/admin1'), {
        phoneE164: '+919800000001',
        authEmail: '918000000001@users.hisab.internal',
        displayName: 'Admin',
        role: 'admin',
        status: 'active',
        permissions: {},
        language: 'en',
        mustChangePassword: false,
        createdBy: 'bootstrap',
      })
      await setDoc(doc(db, 'users/staff1'), {
        phoneE164: '+919800000002',
        authEmail: '918000000002@users.hisab.internal',
        displayName: 'Staff',
        role: 'staff',
        status: 'active',
        permissions: { 'customers.view': true },
        language: 'en',
        mustChangePassword: false,
        createdBy: 'admin1',
      })
      await setDoc(doc(db, 'settings/agency'), {
        name: 'Miragpur Indane Gas Agency',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      })
      await setDoc(doc(db, 'settings/bootstrap'), {
        uid: 'admin1',
        phoneE164: '+919800000001',
      })
      await setDoc(doc(db, 'transactions/tx1'), {
        type: 'godown_sale',
        status: 'posted',
        approval: 'not_required',
      })
      await setDoc(doc(db, 'transactions/tx_pending'), {
        type: 'expense',
        status: 'pending_approval',
        approval: 'pending',
        createdBy: 'staff1',
      })
      await setDoc(doc(db, 'financialLedger/fl1'), { amountPaise: 100, transactionId: 'tx1' })
      await setDoc(doc(db, 'financialBalances/cash'), { balancePaise: 100 })
      await setDoc(doc(db, 'inventoryLedger/il1'), { quantityDelta: -1, transactionId: 'tx1' })
      await setDoc(doc(db, 'inventoryBalances/godown_filled'), { quantity: 10 })
      await setDoc(doc(db, 'obligations/ob1'), { kind: 'money', outstanding: 5000 })
      await setDoc(doc(db, 'auditLogs/a1'), { action: 'test', actorUid: 'admin1' })
      await setDoc(doc(db, 'locations/godown1'), { name: 'Main Godown', kind: 'godown', active: true })
      await setDoc(doc(db, 'products/cyl1'), { name: '14.2 kg', code: 'DOM142', kind: 'cylinder', unit: 'cylinder', active: true })
      await setDoc(doc(db, 'priceRules/pr1'), { productId: 'cyl1', label: 'Refill', amountPaise: 110000, active: true })
    })
  })

  describe('unauthenticated access', () => {
    it('denies reads and writes across protected collections', async () => {
      const anon = testEnv.unauthenticatedContext()
      const db = anon.firestore()
      await assertFails(getDoc(doc(db, 'users/admin1')))
      await assertFails(getDoc(doc(db, 'settings/agency')))
      await assertFails(getDoc(doc(db, 'transactions/tx1')))
      await assertFails(getDoc(doc(db, 'financialLedger/fl1')))
      await assertFails(getDoc(doc(db, 'auditLogs/a1')))
      await assertFails(setDoc(doc(db, 'users/hacker'), { role: 'admin' }))
      await assertFails(setDoc(doc(db, 'transactions/tx_hack'), { type: 'godown_sale' }))
    })
  })

  describe('users and roles', () => {
    it('allows staff to read own profile and denies reading another user', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      await assertSucceeds(getDoc(doc(staff.firestore(), 'users/staff1')))
      await assertFails(getDoc(doc(staff.firestore(), 'users/admin1')))
    })

    it('allows admin to list users and denies staff listing', async () => {
      const admin = testEnv.authenticatedContext('admin1', { role: 'admin' })
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      await assertSucceeds(getDocs(collection(admin.firestore(), 'users')))
      await assertFails(getDocs(collection(staff.firestore(), 'users')))
    })

    it('denies staff creating user documents or elevating role via profile edits', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      const db = staff.firestore()
      await assertFails(
        setDoc(doc(db, 'users/new_admin'), {
          phoneE164: '+919800000099',
          role: 'admin',
          status: 'active',
          language: 'en',
        }),
      )
      await assertFails(
        updateDoc(doc(db, 'users/staff1'), {
          role: 'admin',
        }),
      )
      await assertFails(
        updateDoc(doc(db, 'users/staff1'), {
          permissions: { 'customers.view': true, 'godown.create': true },
        }),
      )
      await assertFails(
        updateDoc(doc(db, 'users/staff1'), {
          phoneE164: '+919800000099',
        }),
      )

      // Same-value writes are not "affected"; force a real mustChangePassword flip.
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'users/staff1'), { mustChangePassword: true })
      })
      await assertFails(
        updateDoc(doc(db, 'users/staff1'), {
          mustChangePassword: false,
          language: 'hi',
        }),
      )
    })

    it('allows language-only self updates for staff', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      await assertSucceeds(
        updateDoc(doc(staff.firestore(), 'users/staff1'), {
          language: 'hi',
          updatedAt: new Date(),
        }),
      )
    })

    it('denies staff editing their own permissions document fields', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      await assertFails(
        updateDoc(doc(staff.firestore(), 'users/staff1'), {
          permissions: { 'customers.view': true, 'godown.create': true },
        }),
      )
    })

    it('ignores forged role claims that are not admin for privileged reads', async () => {
      // Token without admin claim cannot read audit logs even if Firestore profile says admin.
      const forged = testEnv.authenticatedContext('admin1', { role: 'staff' })
      await assertFails(getDoc(doc(forged.firestore(), 'auditLogs/a1')))
    })
  })

  describe('settings', () => {
    it('allows signed-in agency users to read agency settings only', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      await assertSucceeds(getDoc(doc(staff.firestore(), 'settings/agency')))
      await assertFails(getDoc(doc(staff.firestore(), 'settings/bootstrap')))
      await assertFails(updateDoc(doc(staff.firestore(), 'settings/agency'), { name: 'Hacked' }))
    })

    it('allows staff to read locations/products but denies client writes and staff price reads', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      const admin = testEnv.authenticatedContext('admin1', { role: 'admin' })
      await assertSucceeds(getDoc(doc(staff.firestore(), 'locations/godown1')))
      await assertSucceeds(getDoc(doc(staff.firestore(), 'products/cyl1')))
      await assertFails(getDoc(doc(staff.firestore(), 'priceRules/pr1')))
      await assertSucceeds(getDoc(doc(admin.firestore(), 'priceRules/pr1')))
      await assertFails(setDoc(doc(staff.firestore(), 'locations/hack'), { name: 'X', kind: 'godown' }))
      await assertFails(setDoc(doc(admin.firestore(), 'products/hack'), { name: 'X', code: 'X', kind: 'cylinder' }))
    })
  })

  describe('transactions, ledgers, approvals', () => {
    it('denies all client writes to transactions including approval mutations', async () => {
      const admin = testEnv.authenticatedContext('admin1', { role: 'admin' })
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })

      await assertFails(setDoc(doc(admin.firestore(), 'transactions/tx2'), { type: 'godown_sale', approval: 'not_required' }))
      await assertFails(
        updateDoc(doc(staff.firestore(), 'transactions/tx_pending'), {
          approval: 'approved',
          status: 'posted',
        }),
      )
      await assertFails(
        updateDoc(doc(admin.firestore(), 'transactions/tx_pending'), {
          approval: 'approved',
          status: 'posted',
        }),
      )
      await assertFails(setDoc(doc(staff.firestore(), 'transactions/tx_godown'), { type: 'godown_sale', approval: 'not_required' }))
    })

    it('allows staff to read transactions but not financial ledgers', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      await assertSucceeds(getDoc(doc(staff.firestore(), 'transactions/tx1')))
      await assertFails(getDoc(doc(staff.firestore(), 'financialLedger/fl1')))
      await assertFails(getDoc(doc(staff.firestore(), 'financialBalances/cash')))
    })

    it('denies client writes to financial, inventory, obligations, and audit collections', async () => {
      const staff = testEnv.authenticatedContext('staff1', { role: 'staff' })
      const admin = testEnv.authenticatedContext('admin1', { role: 'admin' })
      const staffDb = staff.firestore()
      const adminDb = admin.firestore()

      await assertFails(setDoc(doc(staffDb, 'financialLedger/fl2'), { amountPaise: 1 }))
      await assertFails(updateDoc(doc(adminDb, 'financialBalances/cash'), { balancePaise: 999 }))
      await assertFails(setDoc(doc(staffDb, 'inventoryLedger/il2'), { quantityDelta: 1 }))
      await assertFails(updateDoc(doc(staffDb, 'inventoryBalances/godown_filled'), { quantity: 0 }))
      await assertFails(setDoc(doc(staffDb, 'obligations/ob2'), { kind: 'money' }))
      await assertFails(setDoc(doc(staffDb, 'auditLogs/a2'), { action: 'spoof' }))
      await assertFails(setDoc(doc(adminDb, 'auditLogs/a3'), { action: 'spoof' }))
    })

    it('allows admin to read audit and financial records', async () => {
      const admin = testEnv.authenticatedContext('admin1', { role: 'admin' })
      await assertSucceeds(getDoc(doc(admin.firestore(), 'auditLogs/a1')))
      await assertSucceeds(getDoc(doc(admin.firestore(), 'financialLedger/fl1')))
      await assertSucceeds(getDoc(doc(admin.firestore(), 'financialBalances/cash')))
    })
  })

  describe('unmatched paths', () => {
    it('denies reads and writes to unknown collections', async () => {
      const admin = testEnv.authenticatedContext('admin1', { role: 'admin' })
      const db = admin.firestore()
      await assertFails(getDoc(doc(db, 'customers/c1')))
      await assertFails(setDoc(doc(db, 'customers/c1'), { name: 'X' }))
      await assertFails(getDoc(doc(db, 'approvalRequests/tx1')))
      await assertFails(setDoc(doc(db, 'idempotencyRecords/k1'), { transactionId: 'tx1' }))
      await assertFails(getDoc(doc(db, 'secretVault/item1')))
    })
  })
})
