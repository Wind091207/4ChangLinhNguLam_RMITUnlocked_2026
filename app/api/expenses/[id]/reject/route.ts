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

  let reason = ''
  try {
    const body = await req.json()
    reason = String(body.reason || '').trim()
  } catch {
    // optional body
  }

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
      action: 'REJECT_EXPENSE_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'TideCloak JWT/RBAC',
      details: `BLOCKED: ${ctx.actor.name} (${ctx.actor.title}) attempted to reject ${expense.id} without [expense-approver] role.`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error: `Forbidden (403): ${ctx.actor.name} does not hold the [expense-approver] role. Only designated approvers can reject an expense request.`,
      },
      { status: 403 }
    )
  }

  // 2. Prevent submitter from rejecting their own expense (they should use Withdraw instead)
  if (expense.submitterId === ctx.actor.id) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'SELF_REJECT_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'DualKey Policy Engine',
      details: `BLOCKED: Submitter ${ctx.actor.name} attempted to reject their own expense ${expense.id}. Submitters must use Withdraw instead.`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error:
          'Forbidden (403): Separation of duties — the submitter cannot act as an approver/rejector on their own expense (use Withdraw instead).',
      },
      { status: 403 }
    )
  }

  // 3. Cannot reject if already paid, rejected, or withdrawn
  if (expense.status === 'RELEASED_PAID') {
    return NextResponse.json(
      { error: 'Conflict (409): Cannot reject an expense that has already been paid.' },
      { status: 409 }
    )
  }
  if (expense.status === 'REJECTED') {
    return NextResponse.json(
      { error: 'Conflict (409): This expense has already been rejected.' },
      { status: 409 }
    )
  }
  if (expense.status === 'WITHDRAWN') {
    return NextResponse.json(
      { error: 'Conflict (409): This expense was already withdrawn by the submitter.' },
      { status: 409 }
    )
  }

  const finalReason =
    reason ||
    `Rejected by ${ctx.actor.name} (${ctx.actor.title}) during financial review.`

  expense.status = 'REJECTED'
  expense.rejectedAt = new Date().toISOString()
  expense.rejectedBy = `${ctx.actor.name} (${ctx.actor.title})`
  expense.rejectionReason = finalReason

  appendAudit(db, {
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorRole: 'expense-approver',
    action: 'REJECT_EXPENSE',
    targetId: expense.id,
    allowed: true,
    layer: 'DualKey Policy Engine',
    details: `${ctx.actor.name} rejected ${expense.id} ($${expense.amountAud.toLocaleString()} AUD). Reason: ${finalReason}`,
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

