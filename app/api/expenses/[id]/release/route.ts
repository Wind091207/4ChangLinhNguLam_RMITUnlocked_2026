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

  if (!hasEffectiveRole(ctx, 'expense-approver')) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'RELEASE_PAYMENT_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'TideCloak JWT/RBAC',
      details: `BLOCKED: ${ctx.actor.name} attempted to release funds for ${expense.id} without [expense-approver] role.`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error: `Forbidden (403): Only designated approvers holding [expense-approver] can release funds.`,
      },
      { status: 403 }
    )
  }

  if (expense.status === 'RELEASED_PAID') {
    return NextResponse.json(
      { error: 'Payment has already been released.' },
      { status: 409 }
    )
  }

  if (expense.approvals.length < expense.requiredApprovals) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: 'expense-approver',
      action: 'RELEASE_UNDER_THRESHOLD_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'DualKey Policy Engine',
      details: `BLOCKED: Attempted to release $${expense.amountAud.toLocaleString()} AUD on ${expense.id} with only ${expense.approvals.length}/${expense.requiredApprovals} approvals.`,
      httpStatus: 412,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error: `Precondition Failed (412): High-value expense ($${expense.amountAud.toLocaleString()} AUD) requires ${expense.requiredApprovals} distinct approvals before disbursement (currently ${expense.approvals.length}/${expense.requiredApprovals}).`,
      },
      { status: 412 }
    )
  }

  const txRef = `TIDE-ESCROW-TX-${Math.floor(100000 + Math.random() * 900000)}-AUD`
  expense.status = 'RELEASED_PAID'
  expense.releasedAt = new Date().toISOString()
  expense.releasedBy = `${ctx.actor.name} (${ctx.actor.title})`
  expense.paymentTxRef = txRef

  appendAudit(db, {
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorRole: 'expense-approver',
    action: 'RELEASE_PAYMENT_DISBURSED',
    targetId: expense.id,
    allowed: true,
    layer: 'DualKey Policy Engine',
    details: `Disbursed $${expense.amountAud.toLocaleString()} AUD to ${expense.payeeName} after verifying ${expense.approvals.length}/${expense.requiredApprovals} quorum-protected approvals. Settlement ref: ${txRef}.`,
    httpStatus: 200,
  })
  writeDb(db)

  return NextResponse.json({
    expense: {
      ...expense,
      payeeBankSealedEnvelope: '[PROTECTED_ENVELOPE_OMITTED]',
    },
    txRef,
  })
}
