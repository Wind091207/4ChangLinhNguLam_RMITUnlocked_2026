'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import { ACTOR_LIST, DEMO_ACTORS } from '../lib/actors'
import {
  ActorId,
  AuditEvent,
  DemoActor,
  ExpenseItem,
  IgaChangeRequestItem,
} from '../lib/types'

/* ────────────────────────────────────────────────────────────
   Presentation helpers
   ──────────────────────────────────────────────────────────── */

type Outcome = 'allowed' | 'denied' | 'held' | 'info'

/** A single, human-readable decision shown in the "Why" panel. */
interface Decision {
  outcome: Outcome
  actorId: string
  actorName: string
  action: string
  reason: string
  missing?: string[]
  whoCan?: string[]
  enforcedBy?: string
  httpStatus?: number
  serverMessage?: string
  at: string
}

type ReasonKey =
  | 'no_approver'
  | 'no_reject'
  | 'no_release'
  | 'self_approval'
  | 'duplicate'
  | 'no_decrypt'
  | 'under_threshold'
  | 'not_admin'
  | 'quorum_held'
  | 'self_commit'
  | 'no_submitter'
  | 'not_submitter_withdraw'

const PERSONA_STYLE: Record<ActorId, { color: string; short: string }> = {
  dave: { color: '#4cc3f5', short: 'Submitter' },
  alice: { color: '#ff8a5c', short: 'IT Admin · no finance rights' },
  bob: { color: '#3ee0a1', short: 'Approver · Finance' },
  carol: { color: '#b18cff', short: 'Approver · CFO' },
}

const ROLE_LABEL: Record<string, string> = {
  'expense-approver': 'expense-approver',
  '_tide_payee.selfdecrypt': 'payee decrypt key',
  'tide-realm-admin': 'tide-realm-admin',
  'expense-submitter': 'expense-submitter',
}

function firstName(name: string): string {
  return name.split(' ')[0]
}

function holders(role: string, exclude?: string[]): string[] {
  return ACTOR_LIST.filter(
    (a) => a.roles.includes(role) && !(exclude || []).includes(a.id)
  ).map((a) => firstName(a.name))
}

/** Plain-language explanation for every refusal / hold the server can return. */
function explain(key: ReasonKey, ctx: { actorId?: string; detail?: string } = {}) {
  switch (key) {
    case 'no_approver':
      return {
        reason:
          'Only people holding the expense-approver role can approve. Being an IT admin does not grant financial authority.',
        missing: ['expense-approver'],
        whoCan: holders('expense-approver'),
        enforcedBy: 'TideCloak role check (server)',
      }
    case 'no_reject':
      return {
        reason:
          'Only designated approvers holding the expense-approver role can reject an expense request.',
        missing: ['expense-approver'],
        whoCan: holders('expense-approver'),
        enforcedBy: 'TideCloak role check (server)',
      }
    case 'no_release':
      return {
        reason: 'Only approvers can release funds.',
        missing: ['expense-approver'],
        whoCan: holders('expense-approver'),
        enforcedBy: 'TideCloak role check (server)',
      }
    case 'self_approval':
      return {
        reason: 'Separation of duties — whoever submits an expense cannot approve it.',
        whoCan: holders('expense-approver', ctx.actorId ? [ctx.actorId] : []),
        enforcedBy: 'DualKey policy',
      }
    case 'duplicate':
      return {
        reason: 'Four-eyes rule — you already signed. A different approver must give the second signature.',
        whoCan: holders('expense-approver', ctx.actorId ? [ctx.actorId] : []),
        enforcedBy: 'DualKey policy',
      }
    case 'no_decrypt':
      return {
        reason:
          'Bank details are end-to-end encrypted to approvers only. Without the key, even full database access shows ciphertext.',
        missing: ['expense-approver', '_tide_payee.selfdecrypt'],
        whoCan: holders('_tide_payee.selfdecrypt'),
        enforcedBy: 'TideCloak E2EE (tag: payee)',
      }
    case 'under_threshold':
      return {
        reason: ctx.detail || 'Payments of $10,000 or more need 2 distinct approvals before release.',
        enforcedBy: 'DualKey policy',
      }
    case 'not_admin':
      return {
        reason: 'Only realm administrators can propose or review role changes.',
        missing: ['tide-realm-admin'],
        whoCan: holders('tide-realm-admin'),
        enforcedBy: 'TideCloak IGA',
      }
    case 'quorum_held':
      return {
        reason:
          'Role changes need 2 of 3 admins to sign. The request is parked and the role is NOT active until a second admin co-signs.',
        whoCan: holders('tide-realm-admin', ['alice']),
        enforcedBy: 'TideCloak IGA quorum (2 of 3)',
      }
    case 'self_commit':
      return {
        reason: 'You already provided the first signature. A second, different admin has to co-sign.',
        whoCan: holders('tide-realm-admin', ctx.actorId ? [ctx.actorId] : []),
        enforcedBy: 'TideCloak IGA quorum (2 of 3)',
      }
    case 'no_submitter':
      return {
        reason: 'Only people with the expense-submitter role can create expenses.',
        missing: ['expense-submitter'],
        whoCan: holders('expense-submitter'),
        enforcedBy: 'TideCloak role check (server)',
      }
    case 'not_submitter_withdraw':
      return {
        reason:
          'Only the original submitter who created this expense request can withdraw (recall) it before payment release.',
        whoCan: [ctx.detail || 'Dave'],
        enforcedBy: 'DualKey policy (Submitter ownership)',
      }
  }
}

/** Translate a raw audit event into short human text + an outcome. */
function describeAudit(ev: AuditEvent): { outcome: Outcome; text: string; reason?: string } {
  const a = ev.action
  const target = ev.targetId && !ev.targetId.startsWith('realm:') ? ev.targetId : ''
  const outcome: Outcome = ev.httpStatus === 202 ? 'held' : ev.allowed ? 'allowed' : 'denied'
  const t = (s: string) => (target ? `${s} ${target}` : s)
  const r = (k: ReasonKey) => explain(k, { actorId: ev.actorId }).reason

  if (a.startsWith('SUBMIT_EXPENSE_E2EE')) return { outcome, text: t('submitted') }
  if (a.startsWith('SUBMIT_EXPENSE_DENIED')) return { outcome, text: 'tried to submit an expense', reason: r('no_submitter') }
  if (a.startsWith('APPROVE_EXPENSE_BLOCKED')) return { outcome, text: t('tried to approve'), reason: 'Missing expense-approver role.' }
  if (a.startsWith('APPROVE_EXPENSE')) return { outcome, text: t(`approved (${a.match(/\((.*)\)/)?.[1] || ''})`) }
  if (a.startsWith('SELF_APPROVAL_BLOCKED')) return { outcome, text: t('tried to approve own'), reason: 'Submitter cannot approve own expense.' }
  if (a.startsWith('DUPLICATE_APPROVAL_BLOCKED')) return { outcome, text: t('tried to sign twice on'), reason: 'Four-eyes: needs a different approver.' }
  if (a.startsWith('DECRYPT_PAYEE_REFUSED')) return { outcome, text: t('tried to reveal payee of'), reason: 'No payee decrypt key (approvers only).' }
  if (a.startsWith('DECRYPT_PAYEE_AUTHORIZED')) return { outcome, text: t('revealed payee of') }
  if (a.startsWith('RELEASE_PAYMENT_BLOCKED')) return { outcome, text: t('tried to release'), reason: 'Missing expense-approver role.' }
  if (a.startsWith('RELEASE_UNDER_THRESHOLD_BLOCKED')) return { outcome, text: t('tried to release early'), reason: 'Needs 2/2 approvals first.' }
  if (a.startsWith('RELEASE_PAYMENT_DISBURSED')) return { outcome, text: t('released payment for') }
  if (a.startsWith('REJECT_EXPENSE_BLOCKED')) return { outcome, text: t('tried to reject'), reason: 'Missing expense-approver role.' }
  if (a.startsWith('SELF_REJECT_BLOCKED')) return { outcome, text: t('tried to reject own'), reason: 'Submitters must use Withdraw instead.' }
  if (a.startsWith('REJECT_EXPENSE')) return { outcome, text: t('rejected expense') }
  if (a.startsWith('WITHDRAW_EXPENSE_BLOCKED')) return { outcome, text: t('tried to withdraw'), reason: 'Only the original submitter can withdraw.' }
  if (a.startsWith('WITHDRAW_EXPENSE')) return { outcome, text: t('withdrew expense') }
  if (a.startsWith('IGA_MUTATION_FORBIDDEN')) return { outcome, text: 'tried to change roles', reason: 'Not a realm admin.' }
  if (a.startsWith('IGA_ROLE_ESCALATION_PARKED')) return { outcome, text: 'tried to grant herself expense-approver', reason: 'needs 2 of 3 admins to sign — role not active.' }
  if (a.startsWith('IGA_SELF_COMMIT_BLOCKED')) return { outcome, text: 'tried to self-approve a role change', reason: 'Second signature must be another admin.' }
  if (a.startsWith('IGA_QUORUM_SIGNED')) return { outcome, text: 'co-signed a role change — quorum met' }
  if (a.startsWith('IGA_CHANGE_REQUEST_DENIED')) return { outcome, text: 'rejected a role change request' }
  if (a.startsWith('REALM_MULTIADMIN_QUORUM_LOCKED')) return { outcome, text: 'armed 2-of-3 admin quorum on realm' }
  return { outcome, text: a.toLowerCase().replace(/_/g, ' ') }
}

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

function money(n: number): string {
  return `$${n.toLocaleString('en-AU')} AUD`
}

function expenseStatus(e: ExpenseItem): { label: string; tone: 'hold' | 'ok' | 'info' | 'deny' } {
  if (e.status === 'RELEASED_PAID') return { label: 'Paid', tone: 'ok' }
  if (e.status === 'REJECTED') return { label: 'Rejected by approver', tone: 'deny' }
  if (e.status === 'WITHDRAWN') return { label: 'Withdrawn by submitter', tone: 'deny' }
  if (e.status === 'APPROVED_READY') return { label: 'Ready to release', tone: 'info' }
  const n = e.approvals.length
  return {
    label: n === 0 ? `Awaiting approvals · 0/${e.requiredApprovals}` : `Needs 2nd approver · ${n}/${e.requiredApprovals}`,
    tone: 'hold',
  }
}

/* ────────────────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────────────────── */

export default function DualKeyWorkspace() {
  const {
    authenticated: tideAuthenticated,
    login: tideLogin,
    logout: tideLogout,
    token: tideToken,
    getValueFromIdToken,
    doEncrypt,
  } = useTideCloak()

  const [activeActorId, setActiveActorId] = useState<ActorId>('dave')
  const [actorData, setActorData] = useState<DemoActor>(DEMO_ACTORS.dave)
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const [igaRequests, setIgaRequests] = useState<IgaChangeRequestItem[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [tideConnected, setTideConnected] = useState(true)
  const [decryptedPayees, setDecryptedPayees] = useState<Record<string, Record<string, any>>>({})
  const [openId, setOpenId] = useState<string | null>('EXP-2026-041')
  const [showDb, setShowDb] = useState(false)
  const [showSubmit, setShowSubmit] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [logFilter, setLogFilter] = useState<'all' | 'denied'>('all')

  // New-expense form (prefilled for a smooth demo)
  const [form, setForm] = useState({
    title: 'Emergency Solar Microgrid & Cold-Chain Units — Phase 2',
    category: 'Field Medical Infrastructure',
    amount: '22000',
    invoice: 'INV-MKG-2026-105',
    payeeName: 'Mekong Solar Infrastructure Co., Ltd.',
    bankName: 'Commonwealth Bank of Australia (NGO Escrow)',
    bsb: '063-184',
    account: '1094-8821-73',
    swift: 'CTBAAU2S',
    justification: 'Cold-chain vaccine storage & 20kW hybrid solar inverter for rural health clinic.',
  })
  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const authHeaders = useCallback(
    (overrideActor?: ActorId): Record<string, string> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-dualkey-actor': overrideActor || activeActorId,
      }
      if (tideToken) headers['Authorization'] = `Bearer ${tideToken}`
      return headers
    },
    [activeActorId, tideToken]
  )

  const refreshAll = useCallback(
    async (overrideActor?: ActorId) => {
      try {
        const [expRes, govRes] = await Promise.all([
          fetch('/api/expenses', { headers: authHeaders(overrideActor), cache: 'no-store' }),
          fetch('/api/governance', { headers: authHeaders(overrideActor), cache: 'no-store' }),
        ])
        if (expRes.ok) {
          const data = await expRes.json()
          setActorData(data.actor)
          setExpenses(data.expenses || [])
          setAuditEvents(data.auditEvents || [])
        }
        if (govRes.ok) {
          const gov = await govRes.json()
          setIgaRequests(gov.changeRequests || [])
          if (gov.liveTideCloak) setTideConnected(Boolean(gov.liveTideCloak.connected))
        }
      } catch (err) {
        console.error('Failed to refresh DualKey state:', err)
      }
    },
    [authHeaders]
  )

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  const me = actorData
  const decide = (d: Omit<Decision, 'actorId' | 'actorName' | 'at'>, actor: DemoActor = me) =>
    setDecision({ ...d, actorId: actor.id, actorName: actor.name, at: new Date().toISOString() })

  const deny = (action: string, key: ReasonKey, status: number, serverMessage?: string, detail?: string) =>
    decide({
      outcome: 'denied',
      action,
      httpStatus: status,
      serverMessage,
      ...explain(key, { actorId: me.id, detail }),
    })

  /* ── Actions ── */

  const switchActor = async (id: ActorId) => {
    setActiveActorId(id)
    if (!DEMO_ACTORS[id].canDecryptPayee) setDecryptedPayees({})
    await refreshAll(id)
  }

  const run = async (key: string, fn: () => Promise<void>, refreshAs?: ActorId) => {
    setBusy(key)
    try {
      await fn()
      await refreshAll(refreshAs)
    } finally {
      setBusy(null)
    }
  }

  const approve = (exp: ExpenseItem) =>
    run(`approve-${exp.id}`, async () => {
      const res = await fetch(`/api/expenses/${exp.id}/approve`, { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (res.ok) {
        const n = data.expense.approvals.length
        const req = data.expense.requiredApprovals
        decide({
          outcome: 'allowed',
          action: `Approved ${exp.id} (${n}/${req})`,
          reason: n >= req ? 'Both signatures collected — the payment can now be released.' : 'First signature recorded. A different approver must co-sign.',
          enforcedBy: 'TideCloak role check + DualKey policy',
          httpStatus: res.status,
        })
      } else {
        const msg: string = data.error || ''
        const key: ReasonKey = res.status === 409 ? 'duplicate' : /separation/i.test(msg) ? 'self_approval' : 'no_approver'
        deny(`Approve ${exp.id}`, key, res.status, msg)
      }
    })

  const reveal = (exp: ExpenseItem) =>
    run(`decrypt-${exp.id}`, async () => {
      const res = await fetch(`/api/expenses/${exp.id}/decrypt-payee`, { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (res.ok && data.decryptedPayee) {
        setDecryptedPayees((p) => ({ ...p, [exp.id]: data.decryptedPayee }))
        decide({
          outcome: 'allowed',
          action: `Revealed payee of ${exp.id}`,
          reason: 'Holds expense-approver and the payee decrypt key, so the bank details were unsealed for this session only.',
          enforcedBy: 'TideCloak E2EE (tag: payee)',
          httpStatus: 200,
        })
      } else {
        deny(`Reveal payee of ${exp.id}`, 'no_decrypt', res.status, data.error)
      }
    })

  const release = (exp: ExpenseItem) =>
    run(`release-${exp.id}`, async () => {
      const res = await fetch(`/api/expenses/${exp.id}/release`, { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (res.ok) {
        decide({
          outcome: 'allowed',
          action: `Released ${money(exp.amountAud)}`,
          reason: `Two independent approvals verified. Settlement reference ${data.txRef}.`,
          enforcedBy: 'DualKey policy',
          httpStatus: 200,
        })
      } else if (res.status === 412) {
        deny(`Release ${exp.id}`, 'under_threshold', 412, data.error,
          `Needs ${exp.requiredApprovals} distinct approvals first — currently ${exp.approvals.length}/${exp.requiredApprovals}.`)
      } else if (res.status === 409) {
        decide({ outcome: 'info', action: `Release ${exp.id}`, reason: 'This payment was already released.', httpStatus: 409 })
      } else {
        deny(`Release ${exp.id}`, 'no_release', res.status, data.error)
      }
    })

  const rejectExpense = (exp: ExpenseItem) =>
    run(`reject-${exp.id}`, async () => {
      const res = await fetch(`/api/expenses/${exp.id}/reject`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          reason: `Declined by ${me.name} (${me.title}) during financial review.`,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        decide({
          outcome: 'allowed',
          action: `Rejected ${exp.id}`,
          reason: `${me.name} declined this expense request. It is now closed and cannot be approved or paid.`,
          enforcedBy: 'TideCloak role check + DualKey policy',
          httpStatus: 200,
        })
      } else if (res.status === 403) {
        const msg: string = data.error || ''
        deny(
          `Reject ${exp.id}`,
          /separation/i.test(msg) ? 'self_approval' : 'no_reject',
          403,
          msg
        )
      } else {
        decide({
          outcome: 'info',
          action: `Reject ${exp.id}`,
          reason: data.error || 'This expense cannot be rejected.',
          httpStatus: res.status,
        })
      }
    })

  const withdrawExpense = (exp: ExpenseItem) =>
    run(`withdraw-${exp.id}`, async () => {
      const res = await fetch(`/api/expenses/${exp.id}/withdraw`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const data = await res.json()
      if (res.ok) {
        decide({
          outcome: 'allowed',
          action: `Withdrew ${exp.id} (Thu hồi đơn)`,
          reason: `${me.name} recalled this expense request before disbursement. It is now closed.`,
          enforcedBy: 'DualKey policy (Submitter ownership)',
          httpStatus: 200,
        })
      } else if (res.status === 403) {
        deny(
          `Withdraw ${exp.id}`,
          'not_submitter_withdraw',
          403,
          data.error,
          firstName(exp.submitterName)
        )
      } else {
        decide({
          outcome: 'info',
          action: `Withdraw ${exp.id}`,
          reason: data.error || 'This expense cannot be withdrawn.',
          httpStatus: res.status,
        })
      }
    })

  const submitExpense = (e: React.FormEvent) => {
    e.preventDefault()
    run('create', async () => {
      let clientOrkCiphertext: string | null = null
      if (tideAuthenticated && typeof doEncrypt === 'function') {
        try {
          const enc = await doEncrypt([
            { data: JSON.stringify({ bsb: form.bsb, accountNumber: form.account, bankName: form.bankName }), tags: ['payee'] },
          ])
          if (Array.isArray(enc) && enc[0]) clientOrkCiphertext = String(enc[0])
        } catch {
          // fall back to server envelope seal
        }
      }
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          title: form.title,
          category: form.category,
          amountAud: Number(form.amount),
          invoiceRef: form.invoice,
          justification: form.justification,
          payeeName: form.payeeName,
          bankName: form.bankName,
          bsb: form.bsb,
          accountNumber: form.account,
          swiftBic: form.swift,
          clientOrkCiphertext,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setShowSubmit(false)
        setOpenId(data.expense.id)
        decide({
          outcome: 'allowed',
          action: `Submitted ${data.expense.id} · ${money(Number(form.amount))}`,
          reason: 'Bank details were sealed under the payee tag. The server stores ciphertext only.',
          enforcedBy: 'TideCloak E2EE (tag: payee)',
          httpStatus: 201,
        })
      } else if (res.status === 403) {
        setShowSubmit(false)
        deny('Submit a new expense', 'no_submitter', 403, data.error)
      } else {
        decide({ outcome: 'info', action: 'Submit a new expense', reason: data.error || 'Please check the form.', httpStatus: res.status })
      }
    })
  }

  const escalateAlice = () =>
    run('escalate', async () => {
      if (activeActorId !== 'alice') await switchActor('alice')
      const res = await fetch('/api/governance', {
        method: 'POST',
        headers: authHeaders('alice'),
        body: JSON.stringify({
          action: 'escalate_alice',
          reason: 'Unilateral IT Admin escalation: attempting to grant myself [expense-approver] to approve EXP-2026-041.',
        }),
      })
      const data = await res.json()
      if (res.status === 202) {
        decide(
          {
            outcome: 'held',
            action: 'Grant myself expense-approver',
            httpStatus: 202,
            serverMessage: data.message,
            ...explain('quorum_held'),
          },
          DEMO_ACTORS.alice
        )
      } else {
        decide(
          { outcome: 'denied', action: 'Grant myself expense-approver', httpStatus: res.status, serverMessage: data.error, ...explain('not_admin') },
          DEMO_ACTORS.alice
        )
      }
    }, 'alice')

  const signCr = (cr: IgaChangeRequestItem) =>
    run(`sign-${cr.id}`, async () => {
      const res = await fetch('/api/governance', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'approve_cr', crId: cr.id }),
      })
      const data = await res.json()
      if (res.ok) {
        decide({
          outcome: 'allowed',
          action: `Co-signed ${cr.id}`,
          reason: `Quorum reached (2 of 3). ${cr.targetDisplayName} now holds ${cr.roleName}.`,
          enforcedBy: 'TideCloak IGA quorum (2 of 3)',
          httpStatus: 200,
        })
      } else if (res.status === 403) {
        deny(`Co-sign ${cr.id}`, 'not_admin', 403, data.error)
      } else if (/already signed/i.test(data.error || '')) {
        deny(`Approve role change ${cr.id}`, 'self_commit', res.status, data.error)
      } else {
        decide({ outcome: 'info', action: `Co-sign ${cr.id}`, reason: data.error || 'Request is closed.', httpStatus: res.status })
      }
    })

  const denyCr = (cr: IgaChangeRequestItem) =>
    run(`deny-${cr.id}`, async () => {
      const res = await fetch('/api/governance', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'deny_cr',
          crId: cr.id,
          reason: `Rejected by ${me.name}: Unilateral IT Admin self-promotion violates Treasury separation of duties.`,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        decide({
          outcome: 'allowed',
          action: `Rejected ${cr.id}`,
          reason: `${cr.targetDisplayName} will not receive ${cr.roleName}. The request is closed on TideCloak.`,
          enforcedBy: 'TideCloak IGA',
          httpStatus: 200,
        })
      } else {
        deny(`Reject ${cr.id}`, 'not_admin', res.status, data.error)
      }
    })

  const resetDemo = () =>
    run('reset', async () => {
      await fetch('/api/governance', {
        method: 'POST',
        headers: authHeaders('alice'),
        body: JSON.stringify({ action: 'reset_demo' }),
      })
      setDecryptedPayees({})
      setActiveActorId('dave')
      setOpenId('EXP-2026-041')
      setDecision(null)
    }, 'dave')

  /* ── Derived ── */

  const stats = useMemo(() => {
    const awaiting = expenses.filter((e) => e.status === 'PENDING_APPROVAL').length
    const ready = expenses.filter((e) => e.status === 'APPROVED_READY').length
    const pendingRoles = igaRequests.filter((r) => r.status === 'PENDING').length
    const blocked = auditEvents.filter((e) => !e.allowed && e.httpStatus !== 202).length
    return { awaiting, ready, pendingRoles, blocked }
  }, [expenses, igaRequests, auditEvents])

  const log = useMemo(
    () => auditEvents.filter((e) => (logFilter === 'denied' ? !e.allowed : true)),
    [auditEvents, logFilter]
  )

  const isAdmin = me.roles.includes('tide-realm-admin')
  const persona = PERSONA_STYLE[me.id] || PERSONA_STYLE.dave

  /* ────────────────────────────────────────────────────────── */

  return (
    <div className="app">
      {/* ── Top bar ── */}
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <div className="brand-orb" />
            <div>
              <div className="brand-name">DualKey</div>
              <div className="brand-sub">Expense Desk · built with TideCloak</div>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="status-pill" title="Live connection to the local TideCloak realm">
              <span className={`dot ${tideConnected ? '' : 'warn'}`} />
              <span>
                TideCloak <span className="hide-sm">· realm dualkey · </span>quorum 2 of 3
              </span>
            </span>
            <button className="btn ghost sm" onClick={() => setShowDb(true)} title="See exactly what the server stores">
              View raw database
            </button>
            <button className="btn ghost sm" onClick={resetDemo} disabled={busy === 'reset'}>
              Reset
            </button>
            {tideAuthenticated ? (
              <button className="btn ok sm" onClick={() => tideLogout()}>
                {getValueFromIdToken?.('preferred_username') || 'admin'} · Sign out
              </button>
            ) : (
              <button className="btn sm" onClick={() => tideLogin()}>
                Sign in with TideCloak
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="container">
        {/* ── Persona switcher ── */}
        <section className="persona-bar">
          <div className="label">Acting as</div>
          <div className="persona-row">
            {ACTOR_LIST.map((a) => {
              const s = PERSONA_STYLE[a.id]
              return (
                <button
                  key={a.id}
                  className={`persona ${activeActorId === a.id ? 'active' : ''}`}
                  style={{ ['--p-color' as any]: s.color }}
                  onClick={() => switchActor(a.id)}
                >
                  <span className="avatar">{a.avatarInitials}</span>
                  <span style={{ minWidth: 0 }}>
                    <div className="persona-name">{a.name}</div>
                    <div className="persona-role">{s.short}</div>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="caps">
            <span className="label" style={{ marginRight: 4 }}>
              {firstName(me.name)} can
            </span>
            <Cap ok={me.canSubmit}>Submit expenses</Cap>
            <Cap ok={me.canDecryptPayee}>Reveal bank details</Cap>
            <Cap ok={me.canApprove}>Approve & release</Cap>
            <Cap ok={isAdmin}>Review role changes</Cap>
          </div>
        </section>

        {/* ── Status counters ── */}
        <section className="stats">
          <Stat tone="hold" value={stats.awaiting} label="Awaiting approval" />
          <Stat tone="info" value={stats.ready} label="Ready to release" />
          <Stat tone="hold" value={stats.pendingRoles} label="Role changes held for quorum" />
          <Stat tone="deny" value={stats.blocked} label="Attempts blocked" />
        </section>

        <div className="main">
          {/* ═════════════ LEFT: request status board ═════════════ */}
          <div className="stack">
            <section className="panel">
              <div className="panel-head" style={{ paddingBottom: igaRequests.length === 0 ? 16 : 12 }}>
                <div>
                  <div className="panel-title">Role change requests · TideCloak IGA</div>
                  <div className="panel-sub">Any role grant needs 2 of 3 admins — a lone admin cannot self-promote</div>
                </div>
                <button className="btn hold sm" onClick={escalateAlice} disabled={busy === 'escalate'} title="Red-team: Alice tries to give herself approval rights">
                  ⚡ Simulate: Alice grants herself approver
                </button>
              </div>
              {igaRequests.length > 0 && (
                <div className="panel-body">
                  {igaRequests.map((cr) => (
                    <RoleRequestCard
                      key={cr.id}
                      cr={cr}
                      me={me}
                      busy={busy}
                      onSign={() => signCr(cr)}
                      onDeny={() => denyCr(cr)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-title">Expense requests</div>
                  <div className="panel-sub">≥ $10,000 needs two different approvers</div>
                </div>
                <button className="btn primary sm" onClick={() => setShowSubmit(true)}>
                  + New expense
                </button>
              </div>
              <div className="panel-body">
                {expenses.length === 0 && <div className="empty">No expenses yet.</div>}
                {expenses.map((exp) => (
                  <ExpenseCard
                    key={exp.id}
                    exp={exp}
                    me={me}
                    open={openId === exp.id}
                    onToggle={() => setOpenId(openId === exp.id ? null : exp.id)}
                    decrypted={decryptedPayees[exp.id]}
                    busy={busy}
                    onReveal={() => reveal(exp)}
                    onApprove={() => approve(exp)}
                    onRelease={() => release(exp)}
                    onReject={() => rejectExpense(exp)}
                    onWithdraw={() => withdrawExpense(exp)}
                  />
                ))}
              </div>
            </section>
          </div>

          {/* ═════════════ RIGHT: decision + activity ═════════════ */}
          <aside className="sticky-col">
            <DecisionCard decision={decision} persona={persona} />

            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-title">Activity</div>
                  <div className="panel-sub">Every attempt, allowed or refused</div>
                </div>
                <div className="seg">
                  <button className={logFilter === 'all' ? 'on' : ''} onClick={() => setLogFilter('all')}>
                    All
                  </button>
                  <button className={logFilter === 'denied' ? 'on' : ''} onClick={() => setLogFilter('denied')}>
                    Refused
                  </button>
                </div>
              </div>
              <div className="log">
                {log.length === 0 && <div className="empty">Nothing here yet.</div>}
                {log.map((ev) => {
                  const d = describeAudit(ev)
                  return (
                    <div className="log-item" key={ev.id}>
                      <span className={`log-icon ${d.outcome}`}>
                        {d.outcome === 'allowed' ? '✓' : d.outcome === 'held' ? '❙❙' : '✕'}
                      </span>
                      <div>
                        <div className="log-line">
                          <strong>{firstName(ev.actorName)}</strong> {d.text}
                        </div>
                        {d.reason && (
                          <div className={`log-reason ${d.outcome === 'held' ? 'hold' : ''}`}>
                            {d.outcome === 'held' ? 'On hold — ' : 'Refused: '}
                            {d.reason}
                          </div>
                        )}
                        <div className="log-time">
                          {timeAgo(ev.timestamp)} · HTTP {ev.httpStatus}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* ── New expense modal ── */}
      {showSubmit && (
        <div className="overlay" onClick={() => setShowSubmit(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitExpense}>
            <div className="modal-head">
              <div>
                <div className="panel-title">New expense</div>
                <div className="panel-sub">
                  Submitting as {me.name}
                  {!me.canSubmit && ' — this persona has no submit right, the server will refuse'}
                </div>
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setShowSubmit(false)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>What is it for?</label>
                <input className="input" value={form.title} onChange={setField('title')} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Amount (AUD)</label>
                  <input className="input" type="number" min="1" value={form.amount} onChange={setField('amount')} />
                </div>
                <div className="field">
                  <label>Invoice</label>
                  <input className="input" value={form.invoice} onChange={setField('invoice')} />
                </div>
                <div className="field">
                  <label>Category</label>
                  <input className="input" value={form.category} onChange={setField('category')} />
                </div>
              </div>
              <div className="field">
                <label>Payee</label>
                <input className="input" value={form.payeeName} onChange={setField('payeeName')} />
              </div>

              <div className="sealed-box">
                <div className="sealed-title">🔒 Bank details — encrypted before they leave this screen (tag: payee)</div>
                <div className="field">
                  <label>Bank</label>
                  <input className="input" value={form.bankName} onChange={setField('bankName')} />
                </div>
                <div className="grid-3">
                  <div className="field">
                    <label>BSB</label>
                    <input className="input" value={form.bsb} onChange={setField('bsb')} />
                  </div>
                  <div className="field">
                    <label>Account</label>
                    <input className="input" value={form.account} onChange={setField('account')} />
                  </div>
                  <div className="field">
                    <label>SWIFT</label>
                    <input className="input" value={form.swift} onChange={setField('swift')} />
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Justification</label>
                <textarea className="input" value={form.justification} onChange={setField('justification')} />
              </div>
              <button className="btn primary block" type="submit" disabled={busy === 'create'}>
                {busy === 'create' ? 'Sealing…' : 'Seal & submit'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Raw database modal ── */}
      {showDb && (
        <div className="overlay" onClick={() => setShowDb(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="panel-title">Raw server database</div>
                <div className="panel-sub">
                  What an attacker with full server or database access sees — bank details are ciphertext only.
                </div>
              </div>
              <button className="btn ghost sm" onClick={() => setShowDb(false)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <pre className="raw">
                {JSON.stringify(
                  expenses.map((e) => ({
                    id: e.id,
                    amountAud: e.amountAud,
                    payeeName: e.payeeName,
                    encryptionTag: e.encryptionTag,
                    payeeBankCiphertext: e.payeeBankCiphertext,
                    status: e.status,
                    approvals: e.approvals.length,
                  })),
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────────────────────── */

function Cap({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`cap ${ok ? 'yes' : 'no'}`}>
      {ok ? '✓' : '✕'} {children}
    </span>
  )
}

function Stat({ tone, value, label }: { tone: string; value: number; label: string }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function ExpenseCard(props: {
  exp: ExpenseItem
  me: DemoActor
  open: boolean
  onToggle: () => void
  decrypted?: Record<string, any>
  busy: string | null
  onReveal: () => void
  onApprove: () => void
  onRelease: () => void
  onReject: () => void
  onWithdraw: () => void
}) {
  const { exp, me, open, onToggle, decrypted, busy } = props
  const st = expenseStatus(exp)
  const paid = exp.status === 'RELEASED_PAID'
  const rejected = exp.status === 'REJECTED'
  const withdrawn = exp.status === 'WITHDRAWN'
  const closed = paid || rejected || withdrawn
  const signedByMe = exp.approvals.some((a) => a.actorId === me.id)
  const isSubmitter = exp.submitterId === me.id
  const enough = exp.approvals.length >= exp.requiredApprovals

  // Pre-emptive hints: tell the user *before* clicking why something will be refused.
  const revealHint = me.canDecryptPayee ? '' : 'Approvers only — will be refused'
  const approveHint = !me.canApprove
    ? 'Needs expense-approver role'
    : isSubmitter
    ? 'You submitted this'
    : signedByMe
    ? 'You already signed'
    : enough
    ? 'Already fully approved'
    : ''
  const releaseHint = !me.canApprove
    ? 'Needs expense-approver role'
    : !enough
    ? `Needs ${exp.requiredApprovals}/${exp.requiredApprovals} approvals`
    : ''
  const rejectHint = !me.canApprove
    ? 'Needs expense-approver role'
    : isSubmitter
    ? 'Submitter should use Withdraw'
    : ''
  const withdrawHint = !isSubmitter
    ? `Only submitter (${firstName(exp.submitterName)}) can withdraw`
    : ''

  const steps = [
    { label: 'Submitted', who: firstName(exp.submitterName), done: true },
    ...Array.from({ length: exp.requiredApprovals }, (_, i) => ({
      label: `Approval ${i + 1}`,
      who: exp.approvals[i] ? firstName(exp.approvals[i].actorName) : '',
      done: Boolean(exp.approvals[i]),
    })),
    { label: 'Released', who: paid ? '✓' : '', done: paid },
  ]
  const currentIdx = steps.findIndex((s) => !s.done)

  return (
    <div className={`req ${open ? 'open' : ''}`}>
      <div className="req-row" onClick={onToggle}>
        <div style={{ minWidth: 0 }}>
          <div className="req-title">{exp.title}</div>
          <div className="req-meta">
            {exp.id} · by {exp.submitterName} · {timeAgo(exp.createdAt)}
          </div>
        </div>
        <div className="req-right">
          <div className="amount">{money(exp.amountAud)}</div>
          <span className={`pill ${st.tone}`}>{st.label}</span>
        </div>
      </div>

      <div className="steps">
        {steps.map((s, i) => (
          <div key={i} className={`step ${s.done ? 'done' : i === currentIdx ? 'current' : ''}`}>
            <span className="step-dot">{s.done ? '✓' : i + 1}</span>
            <span className="step-label">{s.label}</span>
            <span className="step-who">{s.who || (i === currentIdx ? 'waiting' : '')}</span>
          </div>
        ))}
      </div>

      {open && (
        <div className="detail">
          <dl className="kv">
            <dt>Payee</dt>
            <dd>{exp.payeeName}</dd>
            <dt>Invoice</dt>
            <dd>{exp.invoiceRef}</dd>
            <dt>Why</dt>
            <dd>{exp.justification}</dd>
            {paid && (
              <>
                <dt>Settlement</dt>
                <dd>
                  <code>{exp.paymentTxRef}</code> by {exp.releasedBy}
                </dd>
              </>
            )}
            {rejected && (
              <>
                <dt>Rejected by</dt>
                <dd style={{ color: 'var(--deny)' }}>
                  {exp.rejectedBy} — {exp.rejectionReason}
                </dd>
              </>
            )}
            {withdrawn && (
              <>
                <dt>Withdrawn by</dt>
                <dd style={{ color: 'var(--hold)' }}>
                  {exp.withdrawnBy} (recalled by submitter before disbursement)
                </dd>
              </>
            )}
          </dl>

          <div className={`vault ${decrypted ? 'open' : ''}`}>
            <div className="vault-head">
              <span>{decrypted ? '🔓 Bank details (visible to you only)' : '🔒 Bank details — end-to-end encrypted'}</span>
              <span className="code">tag: {exp.encryptionTag}</span>
            </div>
            {decrypted ? (
              <div className="plain">
                <div>
                  <b>Bank</b>
                  <span>{decrypted.bankName}</span>
                </div>
                <div>
                  <b>SWIFT</b>
                  <span>{decrypted.swiftBic}</span>
                </div>
                <div>
                  <b>BSB</b>
                  <span>{decrypted.bsb}</span>
                </div>
                <div>
                  <b>Account</b>
                  <span>{decrypted.accountNumber}</span>
                </div>
              </div>
            ) : (
              <div className="cipher">{exp.payeeBankCiphertext.slice(0, 120)}…</div>
            )}
          </div>

          <div className="actions">
            <ActionButton
              label={decrypted ? 'Revealed' : 'Reveal bank details'}
              hint={revealHint}
              tone="default"
              disabled={Boolean(decrypted) || busy === `decrypt-${exp.id}`}
              onClick={props.onReveal}
            />
            <ActionButton
              label={`Approve${exp.approvals.length < exp.requiredApprovals ? ` (${exp.approvals.length + 1} of ${exp.requiredApprovals})` : ''}`}
              hint={closed ? '' : approveHint}
              tone="ok"
              disabled={closed || busy === `approve-${exp.id}`}
              onClick={props.onApprove}
            />
            <ActionButton
              label={paid ? 'Paid' : 'Release payment'}
              hint={closed ? '' : releaseHint}
              tone="primary"
              disabled={closed || busy === `release-${exp.id}`}
              onClick={props.onRelease}
            />
          </div>
          <div className="actions" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 8 }}>
            <ActionButton
              label={rejected ? 'Rejected' : 'Reject expense (Approver)'}
              hint={closed ? '' : rejectHint}
              tone="danger"
              disabled={closed || busy === `reject-${exp.id}`}
              onClick={props.onReject}
            />
            <ActionButton
              label={withdrawn ? 'Withdrawn' : `Withdraw request (Thu hồi · ${firstName(exp.submitterName)})`}
              hint={closed ? '' : withdrawHint}
              tone="hold"
              disabled={closed || busy === `withdraw-${exp.id}`}
              onClick={props.onWithdraw}
            />
          </div>
          <div className="footnote">
            Dashed buttons will be refused for {firstName(me.name)} — you can still try them; the server checks and explains why.
          </div>
        </div>
      )}
    </div>
  )
}

function ActionButton({
  label,
  hint,
  tone,
  disabled,
  onClick,
}: {
  label: string
  hint: string
  tone: 'default' | 'ok' | 'primary' | 'danger' | 'hold'
  disabled?: boolean
  onClick: () => void
}) {
  const locked = Boolean(hint)
  const cls = locked ? 'locked' : tone === 'default' ? '' : tone
  return (
    <div className="action-cell">
      <button className={`btn block ${cls}`} disabled={disabled} onClick={onClick}>
        {locked && '🔒 '}
        {label}
      </button>
      <span className={`hint ${locked ? 'warn' : ''}`}>{hint}</span>
    </div>
  )
}

function RoleRequestCard({
  cr,
  me,
  busy,
  onSign,
  onDeny,
}: {
  cr: IgaChangeRequestItem
  me: DemoActor
  busy: string | null
  onSign: () => void
  onDeny: () => void
}) {
  const pending = cr.status === 'PENDING'
  const isAdmin = me.roles.includes('tide-realm-admin')
  const alreadySigned = cr.approvals.some((a) => a.adminId === me.id)
  const signs = cr.approvals.length
  const pill =
    cr.status === 'PENDING'
      ? { tone: 'hold', label: `Held for quorum · ${signs}/${cr.requiredQuorum}` }
      : cr.status === 'APPROVED_COMMITTED'
      ? { tone: 'ok', label: 'Approved · role active' }
      : { tone: 'deny', label: 'Rejected' }

  const signHint = !isAdmin ? 'Admins only' : alreadySigned ? 'You already signed — needs another admin' : ''

  return (
    <div className="req open" style={{ marginBottom: 10 }}>
      <div className="req-row" style={{ cursor: 'default' }}>
        <div style={{ minWidth: 0 }}>
          <div className="req-title">
            Give <strong>{cr.targetDisplayName}</strong> the <code>{cr.roleName}</code> role
          </div>
          <div className="req-meta">
            {cr.id} · requested by {cr.requestedByName} · {timeAgo(cr.createdAt)}
            {cr.liveTideCloakId && ' · live on TideCloak'}
          </div>
        </div>
        <div className="req-right">
          <span className="quorum" title="Admin signatures">
            {Array.from({ length: cr.requiredQuorum }, (_, i) => (
              <span key={i} className={`qdot ${i < signs ? 'on' : ''} ${cr.status === 'APPROVED_COMMITTED' ? 'ok' : ''}`} />
            ))}
          </span>
          <div>
            <span className={`pill ${pill.tone}`}>{pill.label}</span>
          </div>
        </div>
      </div>
      <div className="detail">
        <dl className="kv">
          <dt>Reason given</dt>
          <dd>{cr.reason}</dd>
          <dt>Signed by</dt>
          <dd>{cr.approvals.map((a) => a.adminName).join(', ') || '—'}</dd>
          {cr.deniedBy && (
            <>
              <dt>Rejected by</dt>
              <dd>
                {cr.deniedBy.adminName} — {cr.deniedBy.reason}
              </dd>
            </>
          )}
        </dl>
        {pending && (
          <div className="actions" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <ActionButton
              label="Co-sign (2nd admin)"
              hint={signHint}
              tone="ok"
              disabled={busy === `sign-${cr.id}`}
              onClick={onSign}
            />
            <div className="action-cell">
              <button className={`btn block ${isAdmin ? 'danger' : 'locked'}`} disabled={busy === `deny-${cr.id}`} onClick={onDeny}>
                {!isAdmin && '🔒 '}Reject request
              </button>
              <span className={`hint ${isAdmin ? '' : 'warn'}`}>{isAdmin ? '' : 'Admins only'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DecisionCard({ decision, persona }: { decision: Decision | null; persona: { color: string } }) {
  if (!decision) {
    return (
      <section className="decision info">
        <div className="verdict">Decision panel</div>
        <div className="decision-action">Pick a persona and try an action</div>
        <div className="why-text" style={{ color: 'var(--text-2)', fontSize: 13 }}>
          Every result lands here in plain words: <b style={{ color: 'var(--ok)' }}>allowed</b>,{' '}
          <b style={{ color: 'var(--hold)' }}>held for quorum</b> or <b style={{ color: 'var(--deny)' }}>refused</b> — with
          the exact permission that was missing and who can do it instead.
        </div>
      </section>
    )
  }

  const verdict =
    decision.outcome === 'allowed'
      ? '✓ Allowed'
      : decision.outcome === 'held'
      ? '❙❙ Held for quorum'
      : decision.outcome === 'denied'
      ? '✕ Refused'
      : 'ℹ Info'
  const actorStyle = PERSONA_STYLE[decision.actorId as ActorId] || persona
  const initials = DEMO_ACTORS[decision.actorId as ActorId]?.avatarInitials || '?'

  return (
    <section className={`decision ${decision.outcome}`} aria-live="polite">
      <div className="decision-top">
        <span className="verdict">{verdict}</span>
        <span className="panel-sub">{decision.httpStatus ? `HTTP ${decision.httpStatus}` : ''}</span>
      </div>
      <div className="decision-action">{decision.action}</div>
      <div className="decision-actor">
        <span className="avatar sm" style={{ ['--p-color' as any]: actorStyle.color }}>
          {initials}
        </span>
        {decision.actorName} · {timeAgo(decision.at)}
      </div>

      <div className="why">
        <div className="why-label">{decision.outcome === 'denied' ? 'Why it was refused' : decision.outcome === 'held' ? 'Why it is on hold' : 'What happened'}</div>
        <div className="why-text">{decision.reason}</div>
      </div>

      <dl className="facts">
        {decision.missing && decision.missing.length > 0 && (
          <>
            <dt>Missing permission</dt>
            <dd>
              {decision.missing.map((m) => (
                <span key={m} className="code deny" style={{ marginRight: 6 }}>
                  {ROLE_LABEL[m] || m}
                </span>
              ))}
            </dd>
          </>
        )}
        {decision.whoCan && decision.whoCan.length > 0 && decision.outcome !== 'allowed' && (
          <>
            <dt>Who can do this</dt>
            <dd>{decision.whoCan.join(', ')}</dd>
          </>
        )}
        {decision.enforcedBy && (
          <>
            <dt>Enforced by</dt>
            <dd>{decision.enforcedBy}</dd>
          </>
        )}
      </dl>

      {decision.serverMessage && <div className="server-msg">server › {decision.serverMessage}</div>}
    </section>
  )
}
