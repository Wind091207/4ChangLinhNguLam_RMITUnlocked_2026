import { ActorId, DemoActor } from './types'

export const DEMO_ACTORS: Record<ActorId, DemoActor> = {
  dave: {
    id: 'dave',
    username: 'dave',
    name: 'Dave Miller',
    title: 'Field Operations Lead',
    department: 'Humanitarian & Field Programs',
    email: 'dave@dualkey.org',
    isAdmin: false,
    roles: ['appUser', 'expense-submitter', '_tide_payee.selfencrypt'],
    canSubmit: true,
    canApprove: false,
    canDecryptPayee: false,
    accentColor: '#0284c7',
    avatarInitials: 'DM',
    summary:
      'Submits expense requests & seals payee bank details client-side via TideCloak E2EE. Cannot approve expenses.',
  },
  alice: {
    id: 'alice',
    username: 'alice',
    name: 'Alice Vance',
    title: 'Head of IT & Realm Admin (1/3)',
    department: 'IT Infrastructure & DevOps',
    email: 'alice@dualkey.org',
    isAdmin: true,
    adminIndex: 'Admin 1 of 3',
    roles: ['tide-realm-admin', 'appUser'],
    canSubmit: false,
    canApprove: false,
    canDecryptPayee: false,
    accentColor: '#dc2626',
    avatarInitials: 'AV',
    summary:
      'Controls servers, database & IT Admin console, but lacks expense-approver. Cannot self-promote without 2-of-3 IGA Quorum.',
  },
  bob: {
    id: 'bob',
    username: 'bob',
    name: 'Bob Chen',
    title: 'Finance Director · Approver A',
    department: 'Finance & Treasury (Admin 2/3)',
    email: 'bob@dualkey.org',
    isAdmin: true,
    adminIndex: 'Admin 2 of 3',
    roles: [
      'tide-realm-admin',
      'expense-approver',
      'expense-submitter',
      '_tide_payee.selfencrypt',
      '_tide_payee.selfdecrypt',
    ],
    canSubmit: true,
    canApprove: true,
    canDecryptPayee: true,
    accentColor: '#059669',
    avatarInitials: 'BC',
    summary:
      'Quorum-authorized Finance Approver (1st key). Can decrypt payee bank coordinates and sign 1st expense approval.',
  },
  carol: {
    id: 'carol',
    username: 'carol',
    name: 'Carol Nguyen',
    title: 'CFO & Board Trustee · Approver B',
    department: 'Executive Governance (Admin 3/3)',
    email: 'carol@dualkey.org',
    isAdmin: true,
    adminIndex: 'Admin 3 of 3',
    roles: [
      'tide-realm-admin',
      'expense-approver',
      'expense-submitter',
      '_tide_payee.selfencrypt',
      '_tide_payee.selfdecrypt',
    ],
    canSubmit: true,
    canApprove: true,
    canDecryptPayee: true,
    accentColor: '#7c3aed',
    avatarInitials: 'CN',
    summary:
      'Quorum-authorized CFO Approver (2nd key). Co-signs expenses >= $10,000 AUD and governs IGA role change requests.',
  },
}

export const ACTOR_LIST: DemoActor[] = [
  DEMO_ACTORS.dave,
  DEMO_ACTORS.alice,
  DEMO_ACTORS.bob,
  DEMO_ACTORS.carol,
]

export function getActor(id?: string | null): DemoActor {
  if (id && id in DEMO_ACTORS) {
    return DEMO_ACTORS[id as ActorId]
  }
  return DEMO_ACTORS.dave
}

