/**
 * Persistent tmux control-mode client.
 *
 * Instead of spawning `tmux send-keys` per keystroke (fork + exec = ~10ms),
 * this holds a single long-lived connection to the tmux server via
 * `tmux -C attach-session`. Commands go through stdin as plain text lines —
 * keystroke delivery drops to ~0.1ms.
 *
 * Protocol:
 *   → we write:   `send-keys -t "session" -l "data"\n`
 *   ← tmux sends: `%begin …\n%end …\n`  (we drain and discard)
 *
 * The client auto-reconnects if tmux exits or restarts.
 */

import { cleanEnv } from './tmux'

// Internal anchor session — the control client attaches to this.
// It is hidden from the user and never killed by us.
const ANCHOR = '__dc_ctrl'
const RECONNECT_MS = 1500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a string as a double-quoted tmux command argument.
 * Only `"` and `\` need escaping; raw bytes (ESC, etc.) pass through as-is,
 * which is what we want for terminal escape sequences like arrow keys.
 */
function quote(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if      (c === '"')  out += '\\"'
    else if (c === '\\') out += '\\\\'
    else                 out += c
  }
  return out + '"'
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

class TmuxControlClient {
  private proc:      ReturnType<typeof Bun.spawn> | null = null
  private connected: boolean = false

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.ensureAnchor()

    this.proc = Bun.spawn(
      ['tmux', '-C', 'attach-session', '-t', ANCHOR],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: cleanEnv() }
    )

    this.connected = true
    this.drainStdout()

    this.proc.exited.then(() => {
      this.proc      = null
      this.connected = false
      console.log('[tmux-ctrl] disconnected — reconnecting in', RECONNECT_MS, 'ms')
      setTimeout(() => this.start().catch(console.error), RECONNECT_MS)
    })

    console.log('[tmux-ctrl] connected')
  }

  stop(): void {
    this.connected = false
    this.proc?.kill()
    this.proc = null
  }

  get isConnected(): boolean {
    return this.connected
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  /**
   * Send keystrokes to a tmux session.
   * Fire-and-forget, sub-millisecond.
   * Returns false if the control client is not ready (caller should fall back).
   */
  sendKeys(target: string, data: string): boolean {
    if (!this.connected || !this.proc?.stdin || typeof this.proc.stdin === 'number') return false
    try {
      this.proc.stdin.write(`send-keys -t ${quote(target)} -l ${quote(data)}\n`)
      return true
    } catch (err) {
      console.error('[tmux-ctrl] write error:', err)
      this.connected = false
      return false
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Ensure the anchor session exists. Idempotent — silently ignores
   * "session already exists" errors.
   */
  private async ensureAnchor(): Promise<void> {
    const proc = Bun.spawn(
      ['tmux', 'new-session', '-d', '-s', ANCHOR],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', env: cleanEnv() }
    )
    await proc.exited // non-zero exit just means the session already exists
  }

  /**
   * Drain tmux stdout to prevent pipe backpressure.
   * We don't need %begin/%end responses for send-keys, so we discard them.
   */
  private drainStdout(): void {
    const stdout = this.proc?.stdout
    if (!stdout || typeof stdout === 'number') return

    ;(async () => {
      const reader = stdout.getReader()
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } catch {
        // proc exited — handled by the exited promise above
      } finally {
        reader.releaseLock()
      }
    })()
  }
}

// Singleton — one control connection per server process.
export const tmuxControl = new TmuxControlClient()
