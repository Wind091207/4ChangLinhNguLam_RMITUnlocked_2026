export type ActorId = 'dave' | 'alice' | 'bob' | 'carol'

export interface DemoActor {
  id: ActorId
  username: string
  name: string
  title: string
  department: string
  email: string
  isAdmin: boolean
  adminIndex?: string
  roles: string[]
  canSubmit: boolean
  canApprove: boolean
  canDecryptPayee: boolean
  accentColor: string
  avatarInitials: string
  summary: string
}

export interface ExpenseApproval {
  actorId: string
  actorName: string
  actorTitle: string
  vuid?: string
  timestamp: string
  verificationMethod: string
}

export interface AuditEvent {
  id: string
  timestamp: string
  actorId: string
  actorName: string
  actorRole: string
  action: string
  targetId?: string
  allowed: boolean
  layer:
    | 'TideCloak IGA Quorum'
    | 'TideCloak E2EE Fabric'
    | 'TideCloak JWT/RBAC'
    | 'DualKey Policy Engine'
  details: string
  httpStatus: number
}

export interface ExpenseItem {
  id: string
  title: string
  category: string
  amountAud: number
  requiresDualControl: boolean
  requiredApprovals: number
  submitterId: string
  submitterName: string
  submitterTitle: string
  createdAt: string
  invoiceRef: string
  justification: string
  payeeName: string
  payeeBankCiphertext: string
  payeeBankSealedEnvelope: string
  encryptionTag: string
  encryptedViaTideOrk: boolean
  approvals: ExpenseApproval[]
  status:
    | 'PENDING_APPROVAL'
    | 'APPROVED_READY'
    | 'RELEASED_PAID'
    | 'REJECTED'
    | 'WITHDRAWN'
  releasedAt?: string
  releasedBy?: string
  paymentTxRef?: string
  rejectedAt?: string
  rejectedBy?: string
  rejectionReason?: string
  withdrawnAt?: string
  withdrawnBy?: string
}

export interface IgaApprovalEntry {
  adminId: string
  adminName: string
  timestamp: string
  source: string
}

export interface IgaChangeRequestItem {
  id: string
  liveTideCloakId?: string
  actionType: 'GRANT_ROLE' | 'REVOKE_ROLE' | 'POLICY_UPDATE'
  targetUsername: string
  targetDisplayName: string
  roleName: string
  requestedById: string
  requestedByName: string
  reason: string
  createdAt: string
  status: 'PENDING' | 'APPROVED_COMMITTED' | 'DENIED_BLOCKED'
  approvals: IgaApprovalEntry[]
  deniedBy?: {
    adminId: string
    adminName: string
    timestamp: string
    reason: string
  }
  requiredQuorum: number
  totalAdmins: number
  rawTideCloakPayload?: Record<string, any>
}

