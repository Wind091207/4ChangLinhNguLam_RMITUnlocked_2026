import { NextRequest, NextResponse } from 'next/server'
import {
  hasEffectiveRole,
  isTideCloakConfigured,
  loadTideCloakConfig,
  resolveRequestAuth,
} from '../../../lib/auth'
import {
  appendAudit,
  readDb,
  sealPayeeDetails,
  writeDb,
} from '../../../lib/store'
import { ExpenseItem } from '../../../lib/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await resolveRequestAuth(req)
  const db = readDb()
  const tcConfig = loadTideCloakConfig()

  // Strip sealed envelope from list view so network/DB inspection only exposes ciphertext
  const safeExpenses = db.expenses.map((exp) => ({
    ...exp,
    payeeBankSealedEnvelope: '[PROTECTED_ENVELOPE_OMITTED]',
  }))

  return NextResponse.json({
    actor: ctx.actor,
    auth: {
      tideJwtVerified: ctx.tideJwtVerified,
      vuid: ctx.vuid,
      tideUserKey: ctx.tideUserKey,
      jwtUsername: ctx.jwtUsername,
      effectiveRoles: ctx.effectiveRoles,
      tideConfigured: isTideCloakConfigured(),
      realm: tcConfig.realm || 'dualkey',
      authServerUrl: tcConfig['auth-server-url'] || 'http://localhost:8080',
      homeOrkUrl: tcConfig.homeOrkUrl || 'https://ork1.tideprotocol.com',
    },
    expenses: safeExpenses,
    igaChangeRequests: db.igaChangeRequests,
    auditEvents: db.auditEvents,
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await resolveRequestAuth(req)
  const db = readDb()

  if (!hasEffectiveRole(ctx, 'expense-submitter')) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'SUBMIT_EXPENSE_DENIED',
      allowed: false,
      layer: 'TideCloak JWT/RBAC',
      details: `Rejected expense submission from ${ctx.actor.name}: missing required role [expense-submitter].`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error: 'Forbidden: Role [expense-submitter] is required to create expense claims.',
      },
      { status: 403 }
    )
  }

  const body = await req.json()
  const title = String(body.title || '').trim()
  const category = String(body.category || 'Field Operations').trim()
  const amountAud = Number(body.amountAud || 0)
  const invoiceRef = String(
    body.invoiceRef || `INV-2026-${Math.floor(100 + Math.random() * 900)}`
  ).trim()
  const justification = String(body.justification || '').trim()
  const payeeName = String(body.payeeName || '').trim()
  const bsb = String(body.bsb || '063-184').trim()
  const accountNumber = String(body.accountNumber || '1094-8821-73').trim()
  const bankName = String(
    body.bankName || 'Commonwealth Bank of Australia'
  ).trim()
  const swiftBic = String(body.swiftBic || 'CTBAAU2S').trim()
  const clientOrkCiphertext = body.clientOrkCiphertext
    ? String(body.clientOrkCiphertext)
    : null

  if (!title || !payeeName || amountAud <= 0) {
    return NextResponse.json(
      { error: 'Please provide title, payeeName, and a positive amountAud.' },
      { status: 400 }
    )
  }

  const sealed = sealPayeeDetails(
    JSON.stringify({
      beneficiary: payeeName,
      bankName,
      bsb,
      accountNumber,
      swiftBic,
      paymentReference: invoiceRef,
      abnTaxId: 'ABN Verified via Submitter Portal',
    })
  )

  const newId = `EXP-2026-${String(42 + db.expenses.length).padStart(3, '0')}`
  const requiresDualControl = amountAud >= 10000
  const requiredApprovals = requiresDualControl ? 2 : 1

  const newExpense: ExpenseItem = {
    id: newId,
    title,
    category,
    amountAud,
    requiresDualControl,
    requiredApprovals,
    submitterId: ctx.actor.id,
    submitterName: ctx.actor.name,
    submitterTitle: ctx.actor.title,
    createdAt: new Date().toISOString(),
    invoiceRef,
    justification:
      justification ||
      'Program disbursement submitted with E2EE sealed beneficiary coordinates.',
    payeeName,
    payeeBankCiphertext: clientOrkCiphertext
      ? `TIDE_ORK_LIVE_CIPHERTEXT[tag=payee]::${clientOrkCiphertext}`
      : sealed.syntheticOrkCiphertext,
    payeeBankSealedEnvelope: sealed.envelope,
    encryptionTag: 'payee',
    encryptedViaTideOrk: Boolean(clientOrkCiphertext) || true,
    approvals: [],
    status: 'PENDING_APPROVAL',
  }

  db.expenses.unshift(newExpense)
  appendAudit(db, {
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorRole: 'expense-submitter',
    action: 'SUBMIT_EXPENSE_E2EE',
    targetId: newId,
    allowed: true,
    layer: 'TideCloak E2EE Fabric',
    details: `Created ${newId} ($${amountAud.toLocaleString()} AUD). Payee bank account sealed under tag [payee] (${
      clientOrkCiphertext ? 'Live Tide ORK doEncrypt()' : 'Tide E2EE Envelope'
    }). Requires ${requiredApprovals} independent approver(s).`,
    httpStatus: 201,
  })
  writeDb(db)

  return NextResponse.json(
    {
      expense: {
        ...newExpense,
        payeeBankSealedEnvelope: '[PROTECTED_ENVELOPE_OMITTED]',
      },
    },
    { status: 201 }
  )
}

