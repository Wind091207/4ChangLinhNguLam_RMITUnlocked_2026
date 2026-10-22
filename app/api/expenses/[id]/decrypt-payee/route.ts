import { NextRequest, NextResponse } from 'next/server'
import { hasEffectiveRole, resolveRequestAuth } from '../../../../../lib/auth'
import {
  appendAudit,
  readDb,
  unsealPayeeDetails,
  writeDb,
} from '../../../../../lib/store'

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

  const canDecrypt =
    hasEffectiveRole(ctx, 'expense-approver') &&
    hasEffectiveRole(ctx, '_tide_payee.selfdecrypt')

  if (!canDecrypt) {
    appendAudit(db, {
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      actorRole: ctx.effectiveRoles.join(', '),
      action: 'DECRYPT_PAYEE_REFUSED',
      targetId: expense.id,
      allowed: false,
      layer: 'TideCloak E2EE Fabric',
      details: `REFUSED: ${ctx.actor.name} (${ctx.actor.title}) requested decryption of payee bank coordinates for ${expense.id}. Tide ORK key-share release denied: caller lacks [expense-approver] & [_tide_payee.selfdecrypt]. Raw database dump yields ciphertext only.`,
      httpStatus: 403,
    })
    writeDb(db)

    return NextResponse.json(
      {
        error: `Decryption Refused by Tide Fabric (403): ${ctx.actor.name} lacks [expense-approver] & [_tide_payee.selfdecrypt]. Even with full database access, payee coordinates remain unreadable ciphertext.`,
        ciphertextOnly: expense.payeeBankCiphertext,
      },
      { status: 403 }
    )
  }

  const decrypted = unsealPayeeDetails(expense.payeeBankSealedEnvelope)
  if (!decrypted) {
    return NextResponse.json(
      { error: 'Failed to unseal payee envelope' },
      { status: 500 }
    )
  }

  appendAudit(db, {
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorRole: 'expense-approver + _tide_payee.selfdecrypt',
    action: 'DECRYPT_PAYEE_AUTHORIZED',
    targetId: expense.id,
    allowed: true,
    layer: 'TideCloak E2EE Fabric',
    details: `${ctx.actor.name} unsealed payee banking coordinates (${decrypted.bankName} · Acc ${decrypted.accountNumber}) for ${expense.id} via Tide E2EE role-bound key release.`,
    httpStatus: 200,
  })
  writeDb(db)

  return NextResponse.json({
    expenseId: expense.id,
    decryptedPayee: decrypted,
    decryptedBy: ctx.actor.name,
    decryptedAt: new Date().toISOString(),
  })
}
