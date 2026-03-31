import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getDefaultWorkingDirectory, resolveWorkingDirectory } from './working-dir'

const FIFO_DIR = path.join(os.tmpdir(), 'devcanvas-fifos')
const INTERNAL_SESSION_NAMES = new Set(['__dc_ctrl'])
const USER_HOME = os.homedir()

// Ensure FIFO directory exists
try {
  fs.mkdirSync(FIFO_DIR, { recursive: true })
} catch {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Env vars that indicate we're inside a Claude Code session.
// Strip them so spawned shells/tmux sessions start clean.
const CLAUDE_ENV_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS']
let resolvedUserPath: string | undefined

function getDefaultShell(): string {
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

function getUserLoginPath(): string {
  if (resolvedUserPath !== undefined) return resolvedUserPath

  try {
    const shell = getDefaultShell()
    const result = Bun.spawnSync([shell, '-l', '-c', 'echo $PATH'], {
      stdout: 'pipe',
      stderr: 'ignore',
      cwd: USER_HOME,
    })
    const nextPath = result.stdout.toString().trim()
    if (nextPath && nextPath.includes('/')) {
      resolvedUserPath = nextPath
      return nextPath
    }
  } catch {}

  resolvedUserPath = process.env.PATH ?? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  return resolvedUserPath
}

export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !CLAUDE_ENV_KEYS.includes(k)) env[k] = v
  }
  env.PATH = getUserLoginPath()
  env.HOME = USER_HOME
  return env
}

async function run(
  cmd: string,
  args: string[],
  opts: { stdin?: string; ignoreError?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdin: opts.stdin !== undefined ? Buffer.from(opts.stdin) : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: cleanEnv(),
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } catch (err) {
    if (opts.ignoreError) return { stdout: '', stderr: String(err), exitCode: 1 }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new detached tmux session.
 * Returns the session name (same as input — tmux uses names as identifiers).
 */
export async function createSession(name: string, workingDir?: string | null): Promise<string> {
  const launchDir = resolveWorkingDirectory(workingDir ?? getDefaultWorkingDirectory())
  const { exitCode, stderr } = await run('tmux', [
    'new-session',
    '-d',
    '-s', name,
    '-c', launchDir,
    '-x', '220',
    '-y', '50',
    '/bin/bash',     // always plain bash — never inherit $SHELL from backend env
  ])

  if (exitCode !== 0) {
    throw new Error(`tmux new-session failed: ${stderr}`)
  }

  return name
}

export async function hasSession(name: string): Promise<boolean> {
  const { exitCode } = await run('tmux', ['has-session', '-t', name], { ignoreError: true })
  return exitCode === 0
}

/**
 * List all active tmux session names.
 */
export async function listSessions(): Promise<string[]> {
  const { stdout, exitCode } = await run(
    'tmux',
    ['list-sessions', '-F', '#{session_name}'],
    { ignoreError: true }
  )

  if (exitCode !== 0 || !stdout) return []
  return stdout
    .split('\n')
    .filter(Boolean)
    .filter((name) => !INTERNAL_SESSION_NAMES.has(name))
}

/**
 * Send input to a tmux session.
 *
 * For interactive typing (≤ 64 bytes) we use `send-keys -t name -l data`
 * which is a single subprocess call.
 * For larger payloads (paste) we fall back to load-buffer → paste-buffer
 * which handles arbitrary binary data more safely.
 */
export async function sendInput(name: string, data: string): Promise<void> {
  if (data.length <= 64) {
    // Fast path: one subprocess instead of two
    const { exitCode, stderr } = await run(
      'tmux', ['send-keys', '-t', name, '-l', data],
      { ignoreError: true }
    )
    if (exitCode !== 0) {
      console.error(`[tmux] send-keys failed: ${stderr}`)
    }
    return
  }

  // Slow path for large pastes: load-buffer + paste-buffer
  const load = await run('tmux', ['load-buffer', '-'], { stdin: data, ignoreError: true })
  if (load.exitCode !== 0) {
    console.error(`[tmux] load-buffer failed: ${load.stderr}`)
    return
  }
  const paste = await run('tmux', ['paste-buffer', '-t', name, '-d'], { ignoreError: true })
  if (paste.exitCode !== 0) {
    console.error(`[tmux] paste-buffer failed: ${paste.stderr}`)
  }
}

/**
 * Resize a tmux session window.
 */
export async function resizeSession(name: string, cols: number, rows: number): Promise<void> {
  await run(
    'tmux',
    ['resize-window', '-t', name, '-x', String(cols), '-y', String(rows)],
    { ignoreError: true }
  )
}

/**
 * Capture the current visible screen of a tmux pane/session, preserving
 * formatting escapes where possible so the frontend can resync after reconnect.
 */
export async function capturePane(name: string): Promise<string> {
  const { stdout, exitCode } = await run(
    'tmux',
    ['capture-pane', '-p', '-e', '-t', name],
    { ignoreError: true }
  )

  if (exitCode !== 0) return ''
  return stdout
}

export async function getSessionWorkingDirectory(name: string): Promise<string | null> {
  const { stdout, exitCode } = await run(
    'tmux',
    ['display-message', '-p', '-t', name, '#{pane_current_path}'],
    { ignoreError: true }
  )

  if (exitCode !== 0 || !stdout) return null
  return resolveWorkingDirectory(stdout)
}

/**
 * Kill a tmux session.
 */
export async function killSession(name: string): Promise<void> {
  await run('tmux', ['kill-session', '-t', name], { ignoreError: true })
}

/**
 * Stream output from a tmux session via a FIFO pipe.
 *
 * Creates a named pipe, attaches `tmux pipe-pane` to append output to it,
 * then reads from the pipe in a polling loop (Bun streams on FIFOs can be
 * tricky, so we use fs.read with O_NONBLOCK instead).
 *
 * Returns a cleanup function that stops the stream.
 */
export function startStreaming(
  sessionId: string,
  sessionName: string,
  onData: (chunk: string) => void,
  onWorkingDirChange?: (workingDir: string) => void
): () => void {
  const fifoPath = path.join(FIFO_DIR, `${sessionId}.fifo`)
  let stopped = false
  let cleanedUp = false

  // Remove stale FIFO if it exists
  try { fs.unlinkSync(fifoPath) } catch {}

  let fd: number | null = null
  let intervalId: ReturnType<typeof setInterval> | null = null
  let cwdIntervalId: ReturnType<typeof setInterval> | null = null
  let lastWorkingDir = ''

  function cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    stopped = true

    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (cwdIntervalId !== null) {
      clearInterval(cwdIntervalId)
      cwdIntervalId = null
    }

    // Stop tmux pipe-pane
    run('tmux', ['pipe-pane', '-t', sessionName], { ignoreError: true }).catch(() => {})

    if (fd !== null) {
      try { fs.closeSync(fd) } catch {}
      fd = null
    }

    try { fs.unlinkSync(fifoPath) } catch {}
  }

  // Run setup asynchronously so we don't block the caller
  ;(async () => {
    try {
      const syncWorkingDir = async () => {
        if (!onWorkingDirChange || stopped) return
        const nextWorkingDir = await getSessionWorkingDirectory(sessionName)
        if (!nextWorkingDir || nextWorkingDir === lastWorkingDir) return
        lastWorkingDir = nextWorkingDir
        onWorkingDirChange(nextWorkingDir)
      }

      void syncWorkingDir()
      cwdIntervalId = setInterval(() => {
        void syncWorkingDir()
      }, 2500)

      // Clear any stale pipe-pane left behind by a previous app process.
      // tmux keeps pipe-pane attached even if our old FIFO consumer died.
      await run('tmux', ['pipe-pane', '-t', sessionName], { ignoreError: true })

      // Create FIFO
      const mkfifo = await run('mkfifo', [fifoPath], { ignoreError: true })
      if (mkfifo.exitCode !== 0) {
        console.error(`[tmux] mkfifo failed: ${mkfifo.stderr}`)
        return
      }

      if (stopped) return

      // Attach tmux pipe-pane to write output to FIFO.
      // `-O` connects pane output to the shell command stdin.
      const pipe = await run(
        'tmux',
        ['pipe-pane', '-t', sessionName, '-O', `cat >> ${fifoPath}`],
        { ignoreError: true }
      )

      if (pipe.exitCode !== 0) {
        console.error(`[tmux] pipe-pane failed: ${pipe.stderr}`)
        return
      }

      if (stopped) return

      // Open FIFO for non-blocking reading
      // We must open it O_RDONLY | O_NONBLOCK to avoid blocking until a writer exists
      fd = fs.openSync(fifoPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)

      const bufSize = 65536
      const readBuf = Buffer.allocUnsafe(bufSize)
      let pendingChunk = ''
      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      function flush() {
        if (pendingChunk) {
          const toSend = pendingChunk
          pendingChunk = ''
          onData(toSend)
        }
        debounceTimer = null
      }

      // Poll the FIFO every 20ms
      intervalId = setInterval(() => {
        if (stopped || fd === null) return

        try {
          const bytesRead = fs.readSync(fd, readBuf, 0, bufSize, null)
          if (bytesRead > 0) {
            const chunk = readBuf.subarray(0, bytesRead).toString('utf8')
            pendingChunk += chunk

            // Debounce: flush after 20ms of inactivity
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(flush, 20)
          }
        } catch (err: any) {
          // EAGAIN means no data yet — normal for non-blocking FIFO
          if (err.code !== 'EAGAIN' && err.code !== 'EWOULDBLOCK') {
            console.error(`[tmux] FIFO read error: ${err.message}`)
          }
        }
      }, 20)
    } catch (err) {
      console.error(`[tmux] startStreaming error:`, err)
    }
  })()

  return cleanup
}

/**
 * Check whether tmux is available on the system.
 */
export async function isTmuxAvailable(): Promise<boolean> {
  const { exitCode } = await run('tmux', ['-V'], { ignoreError: true })
  return exitCode === 0
}
