import { NextRequest, NextResponse } from 'next/server'
import { hasEffectiveRole, resolveRequestAuth } from '../../../lib/auth'
import { appendAudit, readDb, resetDb, writeDb } from '../../../lib/store'
import { IgaChangeRequestItem } from '../../../lib/types'

const TIDECLOAK_URL = process.env.TIDECLOAK_LOCAL_URL || 'http://localhost:8080'
const REALM_NAME = process.env.NEW_REALM_NAME || 'dualkey'

async function getTideMasterToken(): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      username: process.env.KC_USER || 'admin',
      password: process.env.KC_PASSWORD || 'password',
      grant_type: 'password',
      client_id: 'admin-cli',
    })
    const res = await fetch(
      `${TIDECLOAK_URL}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(3000),
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.access_token || null
  } catch {
    return null
  }
}

async function fetchLiveTideCloakIgaStatus(): Promise<{
  connected: boolean
  pendingRequests: any[]
  aliceActiveRoles: string[]
}> {
  const token = await getTideMasterToken()
  if (!token) {
    return { connected: false, pendingRequests: [], aliceActiveRoles: ['appUser'] }
  }
  try {
    const [crRes, userRes] = await Promise.all([
      fetch(
        `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/iga/change-requests?status=PENDING`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' },
          signal: AbortSignal.timeout(3000),
        }
      ),
      fetch(
        `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users?username=alice&exact=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        }
      ),
    ])

    const pendingRequests = crRes.ok ? await crRes.json() : []
    let aliceActiveRoles: string[] = ['appUser']

    if (userRes.ok) {
      const users = await userRes.json()
      const aliceId = users?.[0]?.id
      if (aliceId) {
        const rolesRes = await fetch(
          `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users/${aliceId}/role-mappings/realm`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(3000),
          }
        )
        if (rolesRes.ok) {
          const roles = await rolesRes.json()
          aliceActiveRoles = Array.isArray(roles)
            ? roles.map((r: any) => r.name)
            : ['appUser']
        }
      }
    }

    return {
      connected: true,
      pendingRequests: Array.isArray(pendingRequests) ? pendingRequests : [],
      aliceActiveRoles,
    }
  } catch {
    return { connected: false, pendingRequests: [], aliceActiveRoles: ['appUser'] }
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await resolveRequestAuth(req)
  const db = readDb()
  const live = await fetchLiveTideCloakIgaStatus()

  return NextResponse.json({
    actor: ctx.actor,
    quorumPolicy: {
      formula: 'max(1, floor(TotalAdmins × 0.7))',
      totalAdmins: 3,
      requiredApprovals: 2,
      admins: [
        { id: 'alice', name: 'Alice Vance', role: 'IT & Infrastructure Admin (1/3)' },
        { id: 'bob', name: 'Bob Chen', role: 'Finance Director · Admin (2/3)' },
        { id: 'carol', name: 'Carol Nguyen', role: 'CFO & Trustee · Admin (3/3)' },
      ],
    },
    liveTideCloak: live,
    changeRequests: db.igaChangeRequests,
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await resolveRequestAuth(req)
  const body = await req.json()
  const action = String(body.action || '')

  if (action === 'reset_demo') {
    // Also clean up any pending CRs on TideCloak if connected
    const token = await getTideMasterToken()
    if (token) {
      try {
        const crRes = await fetch(
          `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/iga/change-requests?status=PENDING`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (crRes.ok) {
          const list = await crRes.json()
          if (Array.isArray(list)) {
            for (const item of list) {
              await fetch(
                `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/iga/change-requests/${item.id}/deny`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: '{}',
                }
              )
            }
          }
        }
      } catch {
        // ignore cleanup error
      }
    }
    const fresh = resetDb()
    return NextResponse.json({
      message: 'Demo scenario reset to clean initial state.',
      db: fresh,
    })
  }

  const db = readDb()

  // Verify caller has tide-realm-admin for governance actions
  if (!hasEffectiveRole(ctx, 'tide-realm-admin')) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'IGA_MUTATION_FORBIDDEN',
      allowed: false,
      layer: 'TideCloak IGA Quorum',
      details: `Rejected governance mutation from ${ctx.actor.name}: caller lacks [tide-realm-admin] client role on realm-management.`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error:
          'Forbidden (403): Only administrators holding [tide-realm-admin] can propose or review IGA change requests.',
      },
      { status: 403 }
    )
  }

  // Action 1: Alice attempts unilateral self-promotion to [expense-approver]
  if (action === 'escalate_alice') {
    const existingPending = db.igaChangeRequests.find(
      (cr) =>
        cr.targetUsername === 'alice' &&
        cr.roleName === 'expense-approver' &&
        cr.status === 'PENDING'
    )
    if (existingPending) {
      return NextResponse.json(
        {
          changeRequest: existingPending,
          message:
            'Change request is already parked as PENDING (1/2 admin approvals). Role [expense-approver] is NOT active.',
        },
        { status: 202 }
      )
    }

    // Trigger REAL role assignment on local TideCloak server -> parks as HTTP 202 PENDING IGA CR!
    let liveCrId: string | undefined
    let livePayload: Record<string, any> | undefined
    const token = await getTideMasterToken()
    if (token) {
      try {
        const [uRes, rRes] = await Promise.all([
          fetch(
            `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users?username=alice&exact=true`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
          fetch(
            `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/roles/expense-approver`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
        ])
        if (uRes.ok && rRes.ok) {
          const users = await uRes.json()
          const roleRep = await rRes.json()
          const aliceId = users?.[0]?.id
          if (aliceId && roleRep?.id) {
            await fetch(
              `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/users/${aliceId}/role-mappings/realm`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify([roleRep]),
              }
            )
            const crListRes = await fetch(
              `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/iga/change-requests?status=PENDING`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            if (crListRes.ok) {
              const crList = await crListRes.json()
              if (Array.isArray(crList) && crList.length > 0) {
                liveCrId = crList[0].id
                livePayload = crList[0]
              }
            }
          }
        }
      } catch {
        // fallback if offline
      }
    }

    const newCr: IgaChangeRequestItem = {
      id: `IGA-CR-${202601 + db.igaChangeRequests.length}`,
      liveTideCloakId:
        liveCrId || `tc-iga-${Math.random().toString(16).slice(2, 10)}`,
      actionType: 'GRANT_ROLE',
      targetUsername: 'alice',
      targetDisplayName: 'Alice Vance (IT Admin)',
      roleName: 'expense-approver',
      requestedById: ctx.actor.id,
      requestedByName: ctx.actor.name,
      reason:
        body.reason ||
        'Emergency IT override: self-assigning [expense-approver] role to authorize pending disbursement.',
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      approvals: [
        {
          adminId: ctx.actor.id,
          adminName: `${ctx.actor.name} (${ctx.actor.adminIndex || 'Admin 1/3'})`,
          timestamp: new Date().toISOString(),
          source: 'Initiating Admin Signature (1 of 2 required)',
        },
      ],
      requiredQuorum: 2,
      totalAdmins: 3,
      rawTideCloakPayload: livePayload,
    }

    db.igaChangeRequests.unshift(newCr)
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: 'tide-realm-admin (1/3)',
      action: 'IGA_ROLE_ESCALATION_PARKED',
      targetId: newCr.id,
      allowed: false,
      layer: 'TideCloak IGA Quorum',
      details: `INTERCEPTED (HTTP 202): ${ctx.actor.name} attempted to grant [expense-approver] to [alice]. TideCloak IGA parked mutation as Draft Change Request ${newCr.id} (Live ID: ${newCr.liveTideCloakId}). Status: PENDING (1/2 signatures). Role is NOT active.`,
      httpStatus: 202,
    })
    writeDb(db)

    return NextResponse.json(
      {
        changeRequest: newCr,
        message:
          'Intercepted by TideCloak IGA! Role assignment parked as PENDING Change Request (1 of 2 required admin signatures). Alice still does NOT have [expense-approver].',
      },
      { status: 202 }
    )
  }

  // Action 2: An admin attempts to approve/sign a PENDING IGA Change Request
  if (action === 'approve_cr') {
    const crId = String(body.crId || '')
    const cr = db.igaChangeRequests.find((item) => item.id === crId)
    if (!cr) {
      return NextResponse.json(
        { error: 'Change request not found' },
        { status: 404 }
      )
    }
    if (cr.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Change request is already ${cr.status}` },
        { status: 409 }
      )
    }

    // Four-Eyes Quorum Enforcement (AP-G03): Same admin cannot sign twice!
    if (cr.approvals.some((a) => a.adminId === ctx.actor.id)) {
      appendAudit(db, {
        actorId: ctx.actor.id,
        actorName: ctx.actor.name,
        actorRole: 'tide-realm-admin (1/3)',
        action: 'IGA_SELF_COMMIT_BLOCKED (409)',
        targetId: cr.id,
        allowed: false,
        layer: 'TideCloak IGA Quorum',
        details: `BLOCKED (HTTP 409 Conflict / Precondition 412): ${ctx.actor.name} attempted to sign & commit ${cr.id} alone. TideCloak IGA enforces Four-Eyes Quorum (2 of 3 distinct admins required). One admin cannot count twice toward the threshold.`,
        httpStatus: 409,
      })
      writeDb(db)
      return NextResponse.json(
        {
          error: `Quorum Conflict (409 / 412): ${ctx.actor.name} has already signed ${cr.id} (1/${cr.requiredQuorum}). TideCloak IGA prohibits a single admin from self-committing role changes. A second distinct admin (Bob Chen or Carol Nguyen) must co-sign in the Tide Enclave.`,
        },
        { status: 409 }
      )
    }

    cr.approvals.push({
      adminId: ctx.actor.id,
      adminName: `${ctx.actor.name} (${ctx.actor.adminIndex || 'Admin'})`,
      timestamp: new Date().toISOString(),
      source: 'Tide Enclave Co-Signature (Quorum Satisfied)',
    })

    if (cr.approvals.length >= cr.requiredQuorum) {
      cr.status = 'APPROVED_COMMITTED'
      const current = db.dynamicRoleGrants[cr.targetUsername] || []
      db.dynamicRoleGrants[cr.targetUsername] = Array.from(
        new Set([...current, cr.roleName])
      )
    }

    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: 'tide-realm-admin',
      action: `IGA_QUORUM_SIGNED (${cr.approvals.length}/${cr.requiredQuorum})`,
      targetId: cr.id,
      allowed: true,
      layer: 'TideCloak IGA Quorum',
      details: `${ctx.actor.name} co-signed ${cr.id}. Quorum ${cr.approvals.length}/${cr.requiredQuorum} reached; change request committed.`,
      httpStatus: 200,
    })
    writeDb(db)
    return NextResponse.json({ changeRequest: cr })
  }

  // Action 3: Deny / Reject a rogue IGA Change Request
  if (action === 'deny_cr') {
    const crId = String(body.crId || '')
    const cr = db.igaChangeRequests.find((item) => item.id === crId)
    if (!cr) {
      return NextResponse.json(
        { error: 'Change request not found' },
        { status: 404 }
      )
    }

    cr.status = 'DENIED_BLOCKED'
    cr.deniedBy = {
      adminId: ctx.actor.id,
      adminName: ctx.actor.name,
      timestamp: new Date().toISOString(),
      reason:
        body.reason ||
        'Rejected by Finance/CFO Governance: IT administrators are not permitted to hold [expense-approver].',
    }

    // Also deny on live TideCloak if present
    if (cr.liveTideCloakId) {
      const token = await getTideMasterToken()
      if (token) {
        try {
          await fetch(
            `${TIDECLOAK_URL}/admin/realms/${REALM_NAME}/iga/change-requests/${cr.liveTideCloakId}/deny`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: '{}',
            }
          )
        } catch {
          // ignore
        }
      }
    }

    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: 'tide-realm-admin',
      action: 'IGA_CHANGE_REQUEST_DENIED',
      targetId: cr.id,
      allowed: true,
      layer: 'TideCloak IGA Quorum',
      details: `${ctx.actor.name} rejected and cancelled rogue role escalation ${cr.id} (target: ${cr.targetUsername} -> ${cr.roleName}).`,
      httpStatus: 200,
    })
    writeDb(db)
    return NextResponse.json({ changeRequest: cr })
  }

  return NextResponse.json({ error: 'Unknown governance action' }, { status: 400 })
}

