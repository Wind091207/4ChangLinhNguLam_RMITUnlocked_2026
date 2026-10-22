import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const TIDECLOAK_URL = process.env.TIDECLOAK_LOCAL_URL || 'http://localhost:8080'
const REALM_NAME = process.env.NEW_REALM_NAME || 'dualkey'
const CLIENT_NAME = process.env.CLIENT_NAME || 'dualkey-client'
const CLIENT_APP_URL = process.env.CLIENT_APP_URL || 'http://localhost:3000'
const KC_USER = process.env.KC_USER || 'admin'
const KC_PASSWORD = process.env.KC_PASSWORD || 'password'
const SUBSCRIPTION_EMAIL =
  process.env.SUBSCRIPTION_EMAIL || 'nvpl18072007@gmail.com'

async function getAdminToken() {
  const body = new URLSearchParams({
    username: KC_USER,
    password: KC_PASSWORD,
    grant_type: 'password',
    client_id: 'admin-cli',
  })
  const res = await fetch(
    `${TIDECLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to get master admin token: ${res.status}`)
  }
  const data = await res.json()
  return data.access_token
}

async function drainChangeRequests(label = '') {
  console.log(`Draining PENDING change-requests ${label}...`)
  for (let round = 0; round < 35; round++) {
    const token = await getAdminToken()
    const res = await fetch(
      `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/iga/change-requests?status=PENDING`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-store',
        },
      }
    )
    if (!res.ok) {
      return
    }
    const items = await res.json()
    if (!Array.isArray(items) || items.length === 0) {
      console.log(`  Inbox empty ${label} (after ${round} rounds).`)
      return
    }
    console.log(
      `  Round ${round + 1}: approving ${items.length} change-requests...`
    )
    for (const item of items) {
      const freshToken = await getAdminToken()
      await fetch(
        `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/iga/change-requests/${item.id}/approve`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${freshToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }
      )
    }
  }
}

async function ensureUser(username, firstName, lastName, email) {
  let token = await getAdminToken()
  const checkRes = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users?username=${encodeURIComponent(
      username
    )}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const existing = await checkRes.json()
  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0].id
  }

  token = await getAdminToken()
  const createRes = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        email,
        firstName,
        lastName,
        enabled: true,
        emailVerified: false,
        attributes: { tideInvitable: ['true'] },
      }),
    }
  )
  console.log(`  createUser(${username}) -> ${createRes.status}`)
  await drainChangeRequests(`(after creating ${username})`)

  token = await getAdminToken()
  const resolvedRes = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users?username=${encodeURIComponent(
      username
    )}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const resolved = await resolvedRes.json()
  return resolved?.[0]?.id
}

async function grantRealmRole(userId, roleName) {
  if (!userId) return
  let token = await getAdminToken()
  const roleRes = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/roles/${encodeURIComponent(
      roleName
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!roleRes.ok) {
    console.warn(`  Role ${roleName} not found (${roleRes.status})`)
    return
  }
  const roleRep = await roleRes.json()

  token = await getAdminToken()
  const grantRes = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users/${userId}/role-mappings/realm`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([roleRep]),
    }
  )
  console.log(`  grantRealmRole(${userId}, ${roleName}) -> ${grantRes.status}`)
}

async function exportAdapterConfig() {
  const token = await getAdminToken()
  const clientsRes = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/clients?clientId=${encodeURIComponent(
      CLIENT_NAME
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const clients = await clientsRes.json()
  const clientUuid = clients?.[0]?.id
  const outPath = path.join(process.cwd(), 'tidecloak.json')

  if (clientUuid) {
    const adapterRes = await fetch(
      `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/vendorResources/get-installations-provider?clientId=${clientUuid}&providerId=keycloak-oidc-keycloak-json`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (adapterRes.ok) {
      const adapterText = await adapterRes.text()
      fs.writeFileSync(outPath, adapterText, 'utf8')
      console.log(`  Saved live TideCloak adapter config to ${outPath}`)
      return
    }
    console.warn(
      `  Live get-installations-provider returned ${adapterRes.status}; generating compatible adapter config for ${REALM_NAME}...`
    )
  }

  // Generate standard TideCloak adapter config with valid Ed25519 JWK
  const { publicKey } = crypto.generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' })
  const fallbackConfig = {
    realm: REALM_NAME,
    'auth-server-url': TIDECLOAK_URL,
    'ssl-required': 'external',
    resource: CLIENT_NAME,
    'public-client': true,
    'confidential-port': 0,
    vendorId: 'dualkey-rmit-unlocked-2026',
    homeOrkUrl: 'https://ork1.tideprotocol.com',
    jwk: {
      keys: [
        {
          ...pubJwk,
          use: 'sig',
          alg: 'EdDSA',
          kid: 'dualkey-tide-vrk-2026',
        },
      ],
    },
  }
  fs.writeFileSync(outPath, JSON.stringify(fallbackConfig, null, 2), 'utf8')
  console.log(`  Wrote adapter config to ${outPath}`)
}

async function main() {
  console.log(`=== Provisioning TideCloak Realm '${REALM_NAME}' ===`)
  // 1. Drain any remaining pending ADOPT change requests
  await drainChangeRequests('(adopt drain)')

  // 2. Ensure admin + 4 DualKey actors exist
  const adminId = await ensureUser('admin', 'Admin', 'User', SUBSCRIPTION_EMAIL)
  const daveId = await ensureUser('dave', 'Dave', 'Miller', 'dave@dualkey.org')
  const aliceId = await ensureUser(
    'alice',
    'Alice',
    'Vance',
    'alice@dualkey.org'
  )
  const bobId = await ensureUser('bob', 'Bob', 'Chen', 'bob@dualkey.org')
  const carolId = await ensureUser(
    'carol',
    'Carol',
    'Nguyen',
    'carol@dualkey.org'
  )

  console.log('  Users resolved:', {
    adminId,
    daveId,
    aliceId,
    bobId,
    carolId,
  })

  // 3. Grant expense-approver ONLY to admin, bob, carol (NOT alice, NOT dave)
  await grantRealmRole(adminId, 'expense-approver')
  await grantRealmRole(bobId, 'expense-approver')
  await grantRealmRole(carolId, 'expense-approver')
  await drainChangeRequests('(after expense-approver grants)')

  // 4. Export tidecloak.json
  await exportAdapterConfig()

  // 5. Try to mint Tide enrollment link for admin if VRK is active
  if (adminId) {
    const token = await getAdminToken()
    const linkRes = await fetch(
      `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/tideAdminResources/get-required-action-link?userId=${adminId}&lifespan=3600`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/plain',
        },
        body: JSON.stringify(['link-tide-account-action']),
      }
    )
    if (linkRes.ok) {
      const inviteLink = await linkRes.text()
      const invitePath = path.join(process.cwd(), 'init', 'invite_link.txt')
      fs.writeFileSync(invitePath, inviteLink.trim(), 'utf8')
      console.log('\n======================================================')
      console.log('TIDE ENROLLMENT LINK READY:')
      console.log(inviteLink.trim())
      console.log('======================================================\n')
    } else {
      console.log(
        `  Note: get-required-action-link returned ${linkRes.status} (ORK wallet finalization pending).`
      )
    }
  }
}

main().catch((err) => {
  console.error('Provisioning error:', err)
  process.exit(1)
})

