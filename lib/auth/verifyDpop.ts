import {
  jwtVerify,
  importJWK,
  calculateJwkThumbprint,
  decodeProtectedHeader,
  type JWK,
} from 'jose'

export class DpopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DpopError'
  }
}

export interface JtiStore {
  claim(jti: string, expiresAtMs: number): Promise<boolean>
}

const IAT_SKEW_SECONDS = 300

export class MemoryJtiStore implements JtiStore {
  private seen = new Map<string, number>()
  async claim(jti: string, expiresAtMs: number): Promise<boolean> {
    const now = Date.now()
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k)
    if (this.seen.has(jti)) return false
    this.seen.set(jti, expiresAtMs)
    return true
  }
}

export function requestHtu(
  req: { url: string; headers: { get(name: string): string | null } },
  trustForwardedHeaders = true
): string {
  const url = new URL(req.url)
  if (trustForwardedHeaders) {
    const host = req.headers.get('x-forwarded-host')
    const proto = req.headers.get('x-forwarded-proto')
    if (host) {
      const h = host.split(',')[0].trim()
      const p = proto?.split(',')[0].trim() || url.protocol.replace(':', '')
      return `${p}://${h}${url.pathname}`
    }
  }
  return `${url.origin}${url.pathname}`
}

export interface VerifyDpopOptions {
  jtiStore?: JtiStore
  trustForwardedHeaders?: boolean
  iatSkewSeconds?: number
}

const defaultStore = new MemoryJtiStore()

export async function verifyDpop(
  req: { url: string; method: string; headers: { get(name: string): string | null } },
  accessToken: string,
  claims: { cnf?: { jkt?: string } },
  opts: VerifyDpopOptions = {}
): Promise<void> {
  const jkt = claims.cnf?.jkt
  if (!jkt) {
    throw new DpopError('Access token has no cnf.jkt — not sender-constrained.')
  }

  const authz = req.headers.get('authorization') ?? ''
  if (!/^DPoP /i.test(authz)) {
    throw new DpopError('Sender-constrained token presented without DPoP scheme.')
  }

  const proof = req.headers.get('dpop')
  if (!proof) throw new DpopError('Missing DPoP proof header.')

  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(proof)
  } catch {
    throw new DpopError('DPoP proof is not a compact JWS.')
  }
  if (header.typ !== 'dpop+jwt')
    throw new DpopError(`DPoP proof typ is '${header.typ}', expected 'dpop+jwt'.`)
  const jwk = header.jwk as JWK | undefined
  if (!jwk) throw new DpopError('DPoP proof header has no embedded jwk.')

  let payload: Record<string, unknown>
  try {
    const key = await importJWK(jwk, header.alg)
    ;({ payload } = (await jwtVerify(proof, key)) as {
      payload: Record<string, unknown>
    })
  } catch (e) {
    throw new DpopError(
      `DPoP proof signature invalid: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  const thumb = await calculateJwkThumbprint(jwk, 'sha256')
  if (thumb !== jkt) {
    throw new DpopError('DPoP proof key does not match token cnf.jkt.')
  }

  const expectedAth = base64url(await sha256(accessToken))
  if (payload.ath !== expectedAth) {
    throw new DpopError('DPoP proof ath does not match presented access token.')
  }

  if (
    typeof payload.htm !== 'string' ||
    payload.htm.toUpperCase() !== req.method.toUpperCase()
  ) {
    throw new DpopError(
      `DPoP proof htm '${String(payload.htm)}' does not match ${req.method}.`
    )
  }

  const htu = requestHtu(req, opts.trustForwardedHeaders ?? true)
  if (payload.htu !== htu) {
    throw new DpopError(`DPoP proof htu '${String(payload.htu)}' does not match '${htu}'.`)
  }

  const skew = opts.iatSkewSeconds ?? IAT_SKEW_SECONDS
  const iat = typeof payload.iat === 'number' ? payload.iat : NaN
  if (!Number.isFinite(iat) || Math.abs(Date.now() / 1000 - iat) > skew) {
    throw new DpopError(`DPoP proof iat is outside ±${skew}s window.`)
  }

  const jti = payload.jti
  if (typeof jti !== 'string' || !jti)
    throw new DpopError('DPoP proof has no jti.')
  const store = opts.jtiStore ?? defaultStore
  if (!(await store.claim(jti, Date.now() + skew * 1000))) {
    throw new DpopError('DPoP proof jti already used — replay.')
  }
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
}

function base64url(buf: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

