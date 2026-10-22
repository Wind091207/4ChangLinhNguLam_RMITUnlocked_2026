import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  AuditEvent,
  ExpenseItem,
  IgaChangeRequestItem,
} from './types'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'dualkey-db.json')
const ENVELOPE_SECRET = 'tidecloak-dualkey-emergent-authority-v1-key-share'

export interface DualKeyDatabase {
  expenses: ExpenseItem[]
  igaChangeRequests: IgaChangeRequestItem[]
  auditEvents: AuditEvent[]
  dynamicRoleGrants: Record<string, string[]>
}

export function sealPayeeDetails(plaintextJson: string): {
  envelope: string
  syntheticOrkCiphertext: string
} {
  const iv = crypto.randomBytes(12)
  const key = crypto.createHash('sha256').update(ENVELOPE_SECRET).digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintextJson, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const envelope = Buffer.concat([iv, tag, encrypted]).toString('base64')
  const syntheticOrkCiphertext = `TIDE_E2EE_ORK_SHARES[tag=payee,alg=XChaCha20-Poly1305]::${encrypted
    .toString('hex')
    .slice(0, 96)}...`
  return { envelope, syntheticOrkCiphertext }
}

export function unsealPayeeDetails(envelope: string): Record<string, any> | null {
  try {
    const raw = Buffer.from(envelope, 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const ciphertext = raw.subarray(28)
    const key = crypto.createHash('sha256').update(ENVELOPE_SECRET).digest()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
    return JSON.parse(decrypted)
  } catch {
    return null
  }
}

export function createInitialSeed(): DualKeyDatabase {
  const solarPayee = sealPayeeDetails(
    JSON.stringify({
      beneficiary: 'Mekong Solar Infrastructure Co., Ltd.',
      bankName: 'Commonwealth Bank of Australia (Regional NGO Escrow)',
      bsb: '063-184',
      accountNumber: '1094-8821-73',
      swiftBic: 'CTBAAU2S',
      paymentReference: 'MEKONG-SOLAR-CLINIC-2026',
      abnTaxId: 'ABN 44 109 882 173',
    })
  )

  const auditPayee = sealPayeeDetails(
    JSON.stringify({
      beneficiary: 'Deloitte Humanitarian Assurance Partners',
      bankName: 'ANZ Institutional Banking Melbourne',
      bsb: '013-006',
      accountNumber: '8372-1904-55',
      swiftBic: 'ANZBAU3M',
      paymentReference: 'NGO-GRANT-AUDIT-FY26',
      abnTaxId: 'ABN 74 490 121 060',
    })
  )

  const waterPayee = sealPayeeDetails(
    JSON.stringify({
      beneficiary: 'AquaPure Medical Logistics Pty Ltd',
      bankName: 'Westpac Social Sector Treasury',
      bsb: '032-099',
      accountNumber: '5540-2198-01',
      swiftBic: 'WPACAU2S',
      paymentReference: 'BATCH-12-WATER-FILTERS',
      abnTaxId: 'ABN 19 602 331 908',
    })
  )

  const now = Date.now()
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString()

  return {
    expenses: [
      {
        id: 'EXP-2026-041',
        title: 'Emergency Solar Microgrid & Cold-Chain Units — Mekong Clinic',
        category: 'Field Medical Infrastructure',
        amountAud: 18500,
        requiresDualControl: true,
        requiredApprovals: 2,
        submitterId: 'dave',
        submitterName: 'Dave Miller',
        submitterTitle: 'Field Operations Lead',
        createdAt: iso(42),
        invoiceRef: 'INV-MKG-2026-098',
        justification:
          'Vaccine cold-chain battery bank and 15kW solar array for rural Mekong delta health post under WHO grant #G-882.',
        payeeName: 'Mekong Solar Infrastructure Co., Ltd.',
        payeeBankCiphertext: solarPayee.syntheticOrkCiphertext,
        payeeBankSealedEnvelope: solarPayee.envelope,
        encryptionTag: 'payee',
        encryptedViaTideOrk: true,
        approvals: [],
        status: 'PENDING_APPROVAL',
      },
      {
        id: 'EXP-2026-039',
        title: 'Annual External Grant & Donor Compliance Audit (FY26)',
        category: 'Governance & Assurance',
        amountAud: 12400,
        requiresDualControl: true,
        requiredApprovals: 2,
        submitterId: 'dave',
        submitterName: 'Dave Miller',
        submitterTitle: 'Field Operations Lead',
        createdAt: iso(115),
        invoiceRef: 'INV-AUD-2026-044',
        justification:
          'Mandatory independent financial verification for DFAT & RMIT Social Impact grant tranche release.',
        payeeName: 'Deloitte Humanitarian Assurance Partners',
        payeeBankCiphertext: auditPayee.syntheticOrkCiphertext,
        payeeBankSealedEnvelope: auditPayee.envelope,
        encryptionTag: 'payee',
        encryptedViaTideOrk: true,
        approvals: [
          {
            actorId: 'bob',
            actorName: 'Bob Chen',
            actorTitle: 'Finance Director · Approver A',
            vuid: 'tide-vuid-bob-9f21a4',
            timestamp: iso(70),
            verificationMethod: 'TideCloak JWT + DPoP + Role [expense-approver]',
          },
        ],
        status: 'PENDING_APPROVAL',
      },
      {
        id: 'EXP-2026-035',
        title: 'Field Water Purification Cartridges (Batch #12 · 400 Units)',
        category: 'Emergency Relief Supplies',
        amountAud: 14200,
        requiresDualControl: true,
        requiredApprovals: 2,
        submitterId: 'dave',
        submitterName: 'Dave Miller',
        submitterTitle: 'Field Operations Lead',
        createdAt: iso(290),
        invoiceRef: 'INV-AQP-2026-012',
        justification:
          'Clean water filtration membranes deployed to 8 flood-affected commune stations.',
        payeeName: 'AquaPure Medical Logistics Pty Ltd',
        payeeBankCiphertext: waterPayee.syntheticOrkCiphertext,
        payeeBankSealedEnvelope: waterPayee.envelope,
        encryptionTag: 'payee',
        encryptedViaTideOrk: true,
        approvals: [
          {
            actorId: 'bob',
            actorName: 'Bob Chen',
            actorTitle: 'Finance Director · Approver A',
            vuid: 'tide-vuid-bob-9f21a4',
            timestamp: iso(240),
            verificationMethod: 'TideCloak JWT + DPoP + Role [expense-approver]',
          },
          {
            actorId: 'carol',
            actorName: 'Carol Nguyen',
            actorTitle: 'CFO & Board Trustee · Approver B',
            vuid: 'tide-vuid-carol-4c88e1',
            timestamp: iso(195),
            verificationMethod: 'TideCloak JWT + DPoP + Role [expense-approver]',
          },
        ],
        status: 'RELEASED_PAID',
        releasedAt: iso(190),
        releasedBy: 'Carol Nguyen (CFO)',
        paymentTxRef: 'TIDE-ESCROW-TX-994821-AUD',
      },
    ],
    igaChangeRequests: [],
    auditEvents: [
      {
        id: 'AUD-1003',
        timestamp: iso(42),
        actorId: 'dave',
        actorName: 'Dave Miller',
        actorRole: 'expense-submitter',
        action: 'SUBMIT_EXPENSE_E2EE',
        targetId: 'EXP-2026-041',
        allowed: true,
        layer: 'TideCloak E2EE Fabric',
        details:
          'Submitted $18,500 AUD claim. Payee bank coordinates sealed client-side under tag [payee]. Database stores ciphertext only.',
        httpStatus: 201,
      },
      {
        id: 'AUD-1002',
        timestamp: iso(70),
        actorId: 'bob',
        actorName: 'Bob Chen',
        actorRole: 'expense-approver',
        action: 'APPROVE_EXPENSE (1/2)',
        targetId: 'EXP-2026-039',
        allowed: true,
        layer: 'DualKey Policy Engine',
        details:
          'Verified TideCloak role [expense-approver]. Recorded 1st of 2 required approvals for $12,400 AUD disbursement.',
        httpStatus: 200,
      },
      {
        id: 'AUD-1001',
        timestamp: iso(320),
        actorId: 'system',
        actorName: 'TideCloak IGA Fabric',
        actorRole: 'tide-realm-admin (Quorum 2/3)',
        action: 'REALM_MULTIADMIN_QUORUM_LOCKED',
        targetId: 'realm:dualkey',
        allowed: true,
        layer: 'TideCloak IGA Quorum',
        details:
          'Realm [dualkey] armed with Quorum-Enforced Governance: floor(3 admins × 0.7) = 2 admin signatures required for any role mutation.',
        httpStatus: 200,
      },
    ],
    dynamicRoleGrants: {},
  }
}

export function readDb(): DualKeyDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial = createInitialSeed()
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8')
    return initial
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8')
    return JSON.parse(raw) as DualKeyDatabase
  } catch {
    const initial = createInitialSeed()
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8')
    return initial
  }
}

export function writeDb(db: DualKeyDatabase): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
}

export function resetDb(): DualKeyDatabase {
  const initial = createInitialSeed()
  writeDb(initial)
  return initial
}

export function appendAudit(
  db: DualKeyDatabase,
  event: Omit<AuditEvent, 'id' | 'timestamp'>
): AuditEvent {
  const entry: AuditEvent = {
    id: `AUD-${1000 + db.auditEvents.length + 1}`,
    timestamp: new Date().toISOString(),
    ...event,
  }
  db.auditEvents.unshift(entry)
  return entry
}

