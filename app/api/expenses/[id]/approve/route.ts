import { NextRequest, NextResponse } from 'next/server'
import { hasEffectiveRole, resolveRequestAuth } from '../../../../../lib/auth'
import { appendAudit, readDb, writeDb } from '../../../../../lib/store'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params
  const ctx = await resolveRequestAuth(req)
  const db = readDb()

  const expense = db.expenses.find((e) => e.id === id)
  if (!expense) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }

  // 1. Verify TideCloak role [expense-approver]
  if (!hasEffectiveRole(ctx, 'expense-approver')) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'APPROVE_EXPENSE_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'TideCloak JWT/RBAC',
      details: `BLOCKED: ${ctx.actor.name} (${ctx.actor.title}) attempted to approve ${expense.id} ($${expense.amountAud.toLocaleString()} AUD) without [expense-approver] role. Any pending IGA role request has NOT reached 2/3 quorum.`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error: `Forbidden (403): ${ctx.actor.name} does not hold the [expense-approver] role. Unilateral admin privilege does not grant financial approval authority.`,
      },
      { status: 403 }
    )
  }

  // 2. Prevent submitter from approving their own expense
  if (expense.submitterId === ctx.actor.id) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'SELF_APPROVAL_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'DualKey Policy Engine',
      details: `BLOCKED: Submitter ${ctx.actor.name} attempted to approve their own expense ${expense.id}.`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error:
          'Forbidden (403): Separation of duties prevents a submitter from approving their own expense.',
      },
      { status: 403 }
    )
  }

  // 3. Cannot approve if already paid, rejected, or withdrawn
  if (
    expense.status === 'RELEASED_PAID' ||
    expense.status === 'REJECTED' ||
    expense.status === 'WITHDRAWN'
  ) {
    return NextResponse.json(
      {
        error: `Conflict (409): Cannot approve ${expense.id} because its status is ${expense.status}.`,
      },
      { status: 409 }
    )
  }

  // 4. Prevent duplicate approval by the same approver (Four-Eyes Principle)
  if (expense.approvals.some((a) => a.actorId === ctx.actor.id)) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: 'expense-approver',
      action: 'DUPLICATE_APPROVAL_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'DualKey Policy Engine',
      details: `Four-Eyes Enforcement: ${ctx.actor.name} already signed 1st approval on ${expense.id}. A distinct second [expense-approver] is required.`,
      httpStatus: 409,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error: `Conflict (409): Four-Eyes Rule — ${ctx.actor.name} has already approved ${expense.id}. A second distinct approver holding [expense-approver] must co-sign.`,
      },
      { status: 409 }
    )
  }

  expense.approvals.push({
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorTitle: ctx.actor.title,
    vuid: ctx.vuid || `tide-vuid-${ctx.actor.username}`,
    timestamp: new Date().toISOString(),
    verificationMethod: ctx.tideJwtVerified
      ? 'Live TideCloak JWT + DPoP + Role [expense-approver]'
      : 'TideCloak Role-Bound Session [expense-approver]',
  })

  const count = expense.approvals.length
  const reqCount = expense.requiredApprovals
  if (count >= reqCount) {
    expense.status = 'APPROVED_READY'
  }

  appendAudit(db, {
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorRole: 'expense-approver',
    action: `APPROVE_EXPENSE (${count}/${reqCount})`,
    targetId: expense.id,
    allowed: true,
    layer: 'DualKey Policy Engine',
    details: `${ctx.actor.name} recorded cryptographic approval ${count} of ${reqCount} for ${expense.id} ($${expense.amountAud.toLocaleString()} AUD). ${
      expense.status === 'APPROVED_READY'
        ? 'Dual-control threshold satisfied — ready for payment release.'
        : 'Awaiting 2nd distinct approver.'
    }`,
    httpStatus: 200,
  })

  writeDb(db)
  return NextResponse.json({
    expense: {
      ...expense,
      payeeBankSealedEnvelope: '[PROTECTED_ENVELOPE_OMITTED]',
    },
  })
}
