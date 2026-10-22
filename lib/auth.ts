import { NextRequest } from 'next/server'
import { verifyTideCloakToken } from '@tidecloak/nextjs/server'
import fs from 'fs'
import path from 'path'
import { DEMO_ACTORS, getActor } from './actors'
import { verifyDpop } from './auth/verifyDpop'
import { readDb } from './store'
import { ActorId, DemoActor } from './types'

export function loadTideCloakConfig(): Record<string, any> {
  try {
    const p = path.join(process.cwd(), 'tidecloak.json')
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    }
  } catch {
    // fallback to empty config
  }
  return {}
}

export function isTideCloakConfigured(): boolean {
  const cfg = loadTideCloakConfig()
  return Boolean(cfg && cfg.realm && cfg['auth-server-url'])
}

export interface RequestAuthContext {
  authenticated: boolean
  tideJwtVerified: boolean
  vuid: string | null
  tideUserKey: string | null
  jwtUsername: string | null
  jwtRoles: string[]
  actor: DemoActor
  effectiveRoles: string[]
}

export async function resolveRequestAuth(
  req: NextRequest
): Promise<RequestAuthContext> {
  const cfg = loadTideCloakConfig()
  const authHeader = req.headers.get('authorization')
  const actorHeader = req.headers.get('x-dualkey-actor') as ActorId | null

  let tideJwtVerified = false
  let vuid: string | null = null
  let tideUserKey: string | null = null
  let jwtUsername: string | null = null
  let jwtRoles: string[] = []

  if (authHeader && /^(Bearer|DPoP) /i.test(authHeader)) {
    const token = authHeader.replace(/^(Bearer|DPoP)\s+/i, '').trim()
    if (token && token !== 'null' && token !== 'undefined') {
      try {
        if (cfg && cfg.realm) {
          const payload = (await verifyTideCloakToken(cfg, token)) as Record<
            string,
            any
          > | null
          if (payload) {
            if (payload.cnf?.jkt && req.headers.get('dpop')) {
              await verifyDpop(req, token, payload)
            }
            tideJwtVerified = true
            vuid = payload.vuid || payload.sub || null
            tideUserKey = payload.tideuserkey || null
            jwtUsername = payload.preferred_username || null
            const realmRoles: string[] = payload.realm_access?.roles || []
            const clientKey = cfg.resource || 'dualkey-client'
            const clientRoles: string[] =
              payload.resource_access?.[clientKey]?.roles || []
            const rmRoles: string[] =
              payload.resource_access?.['realm-management']?.roles || []
            jwtRoles = Array.from(
              new Set([...realmRoles, ...clientRoles, ...rmRoles])
            )
          }
        }
      } catch {
        // JWT verification failed
      }
    }
  }

  // Resolve active actor (from header or JWT username)
  let actor = getActor(actorHeader)
  if (!actorHeader && jwtUsername && jwtUsername in DEMO_ACTORS) {
    actor = DEMO_ACTORS[jwtUsername as ActorId]
  }

  // Merge base actor roles with any dynamically quorum-committed roles from DB
  const db = readDb()
  const dynamicGrants = db.dynamicRoleGrants[actor.username] || []
  const effectiveRoles = Array.from(
    new Set([...actor.roles, ...dynamicGrants])
  )

  return {
    authenticated: true,
    tideJwtVerified,
    vuid: vuid || `tide-vuid-${actor.username}`,
    tideUserKey:
      tideUserKey || `tide-ork-pubkey-${actor.username}-ed25519`,
    jwtUsername,
    jwtRoles,
    actor: {
      ...actor,
      roles: effectiveRoles,
      canApprove: effectiveRoles.includes('expense-approver'),
      canDecryptPayee: effectiveRoles.includes('expense-approver'),
      canSubmit: effectiveRoles.includes('expense-submitter'),
    },
    effectiveRoles,
  }
}

export function hasEffectiveRole(
  ctx: RequestAuthContext,
  role: string
): boolean {
  return ctx.effectiveRoles.includes(role)
}

