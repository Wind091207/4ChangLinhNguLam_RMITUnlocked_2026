import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestAuth } from '../../../../../lib/auth'
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

  // 1. Only the original submitter (e.g., Dave) can withdraw/recall their own expense
  if (expense.submitterId !== ctx.actor.id) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'WITHDRAW_EXPENSE_BLOCKED',
      targetId: expense.id,
      allowed: false,
      layer: 'DualKey Policy Engine',
      details: `BLOCKED: ${ctx.actor.name} attempted to withdraw ${expense.id}, which was submitted by ${expense.submitterName}. Only the original submitter can withdraw an expense.`,
      httpStatus: 403,
    })
    writeDb(db)
    return NextResponse.json(
      {
        error: `Forbidden (403): Only the original submitter (${expense.submitterName}) can withdraw ${expense.id}.`,
      },
      { status: 403 }
    )
  }

  // 2. Cannot withdraw if already paid or already withdrawn/rejected
  if (expense.status === 'RELEASED_PAID') {
    return NextResponse.json(
      {
        error:
          'Conflict (409): Cannot withdraw an expense after payment has already been released.',
      },
      { status: 409 }
    )
  }
  if (expense.status === 'WITHDRAWN') {
    return NextResponse.json(
      { error: 'Conflict (409): This expense has already been withdrawn.' },
      { status: 409 }
    )
  }
  if (expense.status === 'REJECTED') {
    return NextResponse.json(
      { error: 'Conflict (409): Cannot withdraw an expense that was already rejected.' },
      { status: 409 }
    )
  }

  expense.status = 'WITHDRAWN'
  expense.withdrawnAt = new Date().toISOString()
  expense.withdrawnBy = `${ctx.actor.name} (${ctx.actor.title})`

  appendAudit(db, {
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorRole: 'expense-submitter',
    action: 'WITHDRAW_EXPENSE',
    targetId: expense.id,
    allowed: true,
    layer: 'DualKey Policy Engine',
    details: `${ctx.actor.name} withdrew expense request ${expense.id} ($${expense.amountAud.toLocaleString()} AUD) before disbursement.`,
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

