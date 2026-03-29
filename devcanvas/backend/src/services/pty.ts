/**
 * Ephemeral PTY service.
 *
 * Uses Bun.spawn with an interactive shell. Each PTY session is a short-lived
 * child process attached to a real pseudo-terminal. Unlike tmux sessions, PTY
 * sessions are not persisted across server restarts.
 *
 * Note: True PTY allocation (openpty/forkpty) requires native bindings.
 * Bun.spawn with `stdio: "inherit"` or piped handles will create a pipe, not
 * a PTY. For a full PTY we would use node-pty or a native module. Here we
 * implement a best-effort interactive subprocess that works for most use cases.
 * When node-pty is available it should be preferred.
 */

import { randomUUID } from 'crypto'

const CLAUDE_ENV_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS']

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !CLAUDE_ENV_KEYS.includes(k)) env[k] = v
  }
  return { ...env, ...extra }
}

/**
 * Detect the user's default shell from $SHELL env, falling back to
 * /bin/zsh on macOS and /bin/bash on everything else.
 */
function getDefaultShell(): string {
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

export interface PtySession {
  id: string
  pid: number
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

interface ActivePty {
  proc: ReturnType<typeof Bun.spawn>
  onData: (chunk: string) => void
  cleanup: () => void
}

const activePtys = new Map<string, ActivePty>()

/**
 * Spawn an ephemeral interactive shell as a PTY-like subprocess.
 *
 * @param sessionId  Logical session ID (used as key in activePtys)
 * @param cols       Initial terminal width
 * @param rows       Initial terminal height
 * @param onData     Called with output chunks from the process
 * @returns          PtySession handle
 */
export function spawnPty(
  sessionId: string,
  cols: number = 220,
  rows: number = 50,
  onData: (chunk: string) => void
): PtySession {
  const shell = getDefaultShell()
  const proc = Bun.spawn([shell, '-i'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: cleanEnv({
      SHELL: shell,
      TERM: 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
    }),
  })

  let stopped = false

  // Stream stdout
  async function readStream(stream: ReadableStream<Uint8Array>, label: string) {
    const reader = stream.getReader()
    try {
      while (!stopped) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.length > 0) {
          onData(new TextDecoder().decode(value))
        }
      }
    } catch (err: any) {
      if (!stopped) {
        console.error(`[pty:${sessionId}] ${label} read error:`, err.message)
      }
    } finally {
      reader.releaseLock()
    }
  }

  readStream(proc.stdout, 'stdout')
  readStream(proc.stderr, 'stderr')

  // Watch for process exit
  proc.exited.then((code) => {
    if (!stopped) {
      stopped = true
      onData(`\r\n[Process exited with code ${code}]\r\n`)
      activePtys.delete(sessionId)
    }
  })

  function write(data: string) {
    if (stopped || !proc.stdin) return
    try {
      const encoded = new TextEncoder().encode(data)
      proc.stdin.write(encoded)
    } catch (err) {
      console.error(`[pty:${sessionId}] write error:`, err)
    }
  }

  function resize(_cols: number, _rows: number) {
    // True resize requires SIGWINCH + ioctl — not easily available without native bindings.
    // We update env vars as a best-effort hint; real PTY resize needs node-pty.
    console.debug(`[pty:${sessionId}] resize to ${_cols}x${_rows} (best-effort)`)
  }

  function kill() {
    stopped = true
    try {
      proc.kill()
    } catch {}
    activePtys.delete(sessionId)
  }

  function cleanup() {
    kill()
  }

  const ptySession: PtySession = {
    id: sessionId,
    pid: proc.pid ?? 0,
    write,
    resize,
    kill,
  }

  activePtys.set(sessionId, { proc, onData, cleanup })

  return ptySession
}

/**
 * Get a live PTY session by ID, if it still exists.
 */
export function getPty(sessionId: string): ActivePty | undefined {
  return activePtys.get(sessionId)
}

/**
 * Kill and remove a PTY session.
 */
export function killPty(sessionId: string): void {
  const pty = activePtys.get(sessionId)
  if (pty) {
    pty.cleanup()
    activePtys.delete(sessionId)
  }
}

/**
 * Spawn an SSH connection as a PTY-like subprocess.
 *
 * Uses `ssh -t -t` to force pseudo-TTY allocation even when stdin is a pipe.
 * The session is tracked in `activePtys` under the same interface as spawnPty.
 */
export function spawnSsh(
  sessionId: string,
  host: string,
  user: string,
  port: number = 22,
  cols: number = 220,
  rows: number = 50,
  onData: (chunk: string) => void
): PtySession {
  // -t -t forces PTY even when stdin is not a terminal
  const args = ['-t', '-t', '-p', String(port), `${user}@${host}`]
  const proc = Bun.spawn(['ssh', ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: cleanEnv({
      TERM: 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
    }),
  })

  let stopped = false

  async function readStream(stream: ReadableStream<Uint8Array>, label: string) {
    const reader = stream.getReader()
    try {
      while (!stopped) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.length > 0) {
          onData(new TextDecoder().decode(value))
        }
      }
    } catch (err: any) {
      if (!stopped) console.error(`[ssh:${sessionId}] ${label} read error:`, err.message)
    } finally {
      reader.releaseLock()
    }
  }

  readStream(proc.stdout, 'stdout')
  readStream(proc.stderr, 'stderr')

  proc.exited.then((code) => {
    if (!stopped) {
      stopped = true
      onData(`\r\n[SSH connection closed (code ${code})]\r\n`)
      activePtys.delete(sessionId)
    }
  })

  function write(data: string) {
    if (stopped || !proc.stdin) return
    try {
      proc.stdin.write(new TextEncoder().encode(data))
    } catch (err) {
      console.error(`[ssh:${sessionId}] write error:`, err)
    }
  }

  function resize(_cols: number, _rows: number) {
    console.debug(`[ssh:${sessionId}] resize to ${_cols}x${_rows} (best-effort)`)
  }

  function kill() {
    stopped = true
    try { proc.kill() } catch {}
    activePtys.delete(sessionId)
  }

  const ptySession: PtySession = {
    id: sessionId,
    pid: proc.pid ?? 0,
    write,
    resize,
    kill,
  }

  activePtys.set(sessionId, { proc, onData, cleanup: kill })
  return ptySession
}

/**
 * List all active PTY session IDs.
 */
export function listActivePtys(): string[] {
  return Array.from(activePtys.keys())
}
