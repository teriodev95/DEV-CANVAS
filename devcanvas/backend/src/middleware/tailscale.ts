import type { Context, Next } from 'hono'

/**
 * Tailscale authentication middleware.
 *
 * Development mode: allows requests from:
 *   - Tailscale IP range (100.64.0.0/10 — addresses starting with "100.")
 *   - Loopback addresses (127.0.0.1, ::1, localhost)
 *
 * Production mode (commented out below): would call Tailscale's local API
 *   POST /localapi/v0/whois with the remote IP to get the full peer identity,
 *   then enforce ACLs based on tags or login name.
 */

const IS_PROD = process.env.NODE_ENV === 'production'

function getClientIp(c: Context): string {
  // Try common proxy headers first
  const forwarded =
    c.req.header('x-forwarded-for') ??
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip')

  if (forwarded) {
    return (forwarded.split(',')[0] ?? '').trim()
  }

  // Fall back to raw remote address (Bun/Node)
  const raw: string = (c.req.raw as unknown as { socket?: { remoteAddress?: string } })?.socket?.remoteAddress ?? ''
  // Strip IPv6-mapped IPv4 prefix
  return raw.replace(/^::ffff:/, '')
}

function isAllowedDev(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === 'localhost' ||
    ip.startsWith('100.') // Tailscale CGNAT range 100.64.0.0/10
  )
}

/**
 * Production whois check (example — not wired up in dev).
 *
 * async function tailscaleWhois(ip: string): Promise<boolean> {
 *   try {
 *     const res = await fetch('http://localhost:41112/localapi/v0/whois?addr=' + encodeURIComponent(ip))
 *     if (!res.ok) return false
 *     const data = await res.json() as { Node?: { Tags?: string[] }; UserProfile?: { LoginName?: string } }
 *     // Enforce your ACL here, e.g. check for a specific tag or login domain
 *     return !!data.Node
 *   } catch {
 *     return false
 *   }
 * }
 */

export async function tailscaleAuth(c: Context, next: Next) {
  if (IS_PROD) {
    // In production, uncomment and use tailscaleWhois() above.
    // const ip = getClientIp(c)
    // const allowed = await tailscaleWhois(ip)
    // if (!allowed) {
    //   return c.json({ error: 'Unauthorized — not a Tailscale peer' }, 401)
    // }
    await next()
  } else {
    const ip = getClientIp(c)
    if (!isAllowedDev(ip)) {
      console.warn(`[tailscale] Blocked request from ${ip}`)
      return c.json({ error: 'Unauthorized — not in allowed IP range' }, 401)
    }
    await next()
  }
}
