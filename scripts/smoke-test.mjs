const BASE_URL = process.env.APP_URL || 'http://localhost:3000'

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`SMOKE TEST FAILED: ${msg}`)
  }
}

async function callApi(path, method = 'GET', actor = 'dave', body = undefined) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-dualkey-actor': actor,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function main() {
  console.log('=== DualKey Expense Desk · End-to-End Smoke Verification ===\n')

  // 0. Reset state
  await callApi('/api/governance', 'POST', 'alice', { action: 'reset_demo' })
  console.log('✓ 0. Reset demo state to clean baseline')

  // 1. Alice (Rogue IT Admin) tries to decrypt payee bank details -> 403
  const decAlice = await callApi(
    '/api/expenses/EXP-2026-041/decrypt-payee',
    'POST',
    'alice'
  )
  assert(
    decAlice.status === 403,
    `Expected 403 when Alice decrypts payee, got ${decAlice.status}`
  )
  console.log(
    '✓ 1. Alice (IT Admin) blocked from decrypting E2EE payee bank account (HTTP 403)'
  )

  // 2. Alice tries to self-grant [expense-approver] -> 202 PENDING Change Request
  const escAlice = await callApi('/api/governance', 'POST', 'alice', {
    action: 'escalate_alice',
  })
  assert(
    escAlice.status === 202 && escAlice.data.changeRequest?.status === 'PENDING',
    `Expected 202 PENDING on Alice escalation, got ${escAlice.status}`
  )
  const crId = escAlice.data.changeRequest.id
  console.log(
    `✓ 2. Alice self-promotion intercepted by TideCloak IGA -> Parked as PENDING (${crId}, Live ID: ${escAlice.data.changeRequest.liveTideCloakId})`
  )

  // 3. Alice tries to self-commit her own IGA change request -> 409 Conflict
  const selfCommit = await callApi('/api/governance', 'POST', 'alice', {
    action: 'approve_cr',
    crId,
  })
  assert(
    selfCommit.status === 409,
    `Expected 409 when Alice self-commits IGA CR, got ${selfCommit.status}`
  )
  console.log(
    '✓ 3. Alice blocked from self-committing IGA Change Request (HTTP 409 Four-Eyes Quorum)'
  )

  // 4. Alice tries to approve EXP-2026-041 while CR is still PENDING -> 403 Forbidden
  const appAlice = await callApi(
    '/api/expenses/EXP-2026-041/approve',
    'POST',
    'alice'
  )
  assert(
    appAlice.status === 403,
    `Expected 403 when Alice approves expense, got ${appAlice.status}`
  )
  console.log(
    '✓ 4. Alice blocked from approving $18,500 AUD expense (HTTP 403 Forbidden)'
  )

  // 5. Bob (Finance Director) denies Alice's rogue CR, decrypts payee, and signs Approval 1/2
  const denyCr = await callApi('/api/governance', 'POST', 'bob', {
    action: 'deny_cr',
    crId,
  })
  assert(denyCr.status === 200, `Expected 200 on deny_cr, got ${denyCr.status}`)
  console.log('✓ 5a. Bob denied & cancelled Alice’s rogue IGA Change Request')

  const decBob = await callApi(
    '/api/expenses/EXP-2026-041/decrypt-payee',
    'POST',
    'bob'
  )
  assert(
    decBob.status === 200 && decBob.data.decryptedPayee?.bsb === '063-184',
    `Expected 200 with decrypted BSB for Bob, got ${decBob.status}`
  )
  console.log(
    `✓ 5b. Bob decrypted payee bank coordinates: ${decBob.data.decryptedPayee.bankName} (${decBob.data.decryptedPayee.bsb} / ${decBob.data.decryptedPayee.accountNumber})`
  )

  const appBob1 = await callApi(
    '/api/expenses/EXP-2026-041/approve',
    'POST',
    'bob'
  )
  assert(
    appBob1.status === 200 && appBob1.data.expense.approvals.length === 1,
    `Expected 1 approval after Bob signs, got ${appBob1.status}`
  )
  console.log('✓ 5c. Bob signed Approval 1 of 2 on EXP-2026-041 ($18,500 AUD)')

  // 6. Bob tries to sign 2nd time alone -> 409 Conflict; tries early release -> 412
  const appBob2 = await callApi(
    '/api/expenses/EXP-2026-041/approve',
    'POST',
    'bob'
  )
  assert(
    appBob2.status === 409,
    `Expected 409 on duplicate approval by Bob, got ${appBob2.status}`
  )
  const relEarly = await callApi(
    '/api/expenses/EXP-2026-041/release',
    'POST',
    'bob'
  )
  assert(
    relEarly.status === 412,
    `Expected 412 on early release before 2nd approval, got ${relEarly.status}`
  )
  console.log(
    '✓ 6. Bob blocked from duplicate approval (HTTP 409) and early disbursement (HTTP 412)'
  )

  // 7. Carol (CFO) signs Approval 2 of 2 and releases funds -> 200 OK
  const appCarol = await callApi(
    '/api/expenses/EXP-2026-041/approve',
    'POST',
    'carol'
  )
  assert(
    appCarol.status === 200 &&
      appCarol.data.expense.status === 'APPROVED_READY',
    `Expected APPROVED_READY after Carol signs, got ${appCarol.data.expense?.status}`
  )
  const relCarol = await callApi(
    '/api/expenses/EXP-2026-041/release',
    'POST',
    'carol'
  )
  assert(
    relCarol.status === 200 &&
      relCarol.data.expense.status === 'RELEASED_PAID',
    `Expected RELEASED_PAID after Carol releases, got ${relCarol.status}`
  )
  console.log(
    `✓ 7. Carol signed Approval 2 of 2 & released $18,500 AUD (Ref: ${relCarol.data.txRef})`
  )

  // 8. Restore clean baseline for live demo
  await callApi('/api/governance', 'POST', 'alice', { action: 'reset_demo' })
  console.log(
    '✓ 8. Restored clean baseline state for user live demo.\nALL TESTS PASSED!'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

