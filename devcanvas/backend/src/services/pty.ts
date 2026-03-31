/**
 * Ephemeral PTY service.
 *
 * Local "pty" sessions need a real pseudo-terminal or shells on macOS will
 * not echo interactive input correctly. Bun pipes alone are not enough, so we
 * launch the shell through a tiny Python bridge that allocates a PTY with the
 * standard library `pty` module and forwards bytes between the PTY and our
 * websocket transport.
 */

import { existsSync } from 'fs'
import { homedir } from 'os'
import { Buffer } from 'buffer'
import type { ResolvedSshTarget } from './ssh'
import { getSshControlPath, makeRemoteDurableShellCommand, makeSshTargetString } from './ssh'
import { consumeOsc7Output, getShellLaunchConfig } from './shell-integration'
import {
  getDefaultWorkingDirectory,
  readLocalProcessWorkingDirectory,
  resolveWorkingDirectory,
} from './working-dir'

const CLAUDE_ENV_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS']
const USER_HOME = homedir()
const FALLBACK_PTY_MESSAGE =
  '\r\n[Warning] python3 was not found. Falling back to a non-PTY shell; interactive echo may be degraded.\r\n'
const BRIDGE_CHILD_PID_PREFIX = '\x1fDEVCANVAS_CHILD_PID:'
const BRIDGE_CHILD_PID_SUFFIX = '\x1f'
const PYTHON_PTY_BRIDGE = String.raw`
import base64, fcntl, json, os, pty, select, signal, struct, sys, termios

shell = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SHELL", "/bin/zsh")
cols = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.environ.get("COLUMNS", "220"))
rows = int(sys.argv[3]) if len(sys.argv) > 3 else int(os.environ.get("LINES", "50"))

child_pid = None
stdin_buffer = bytearray()

def set_winsize(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass

def apply_resize(fd, cols, rows):
    cols = max(1, cols)
    rows = max(1, rows)
    set_winsize(fd, cols, rows)
    if child_pid:
        try:
            os.kill(child_pid, signal.SIGWINCH)
        except OSError:
            pass

def forward_signal(signum, _frame):
    global child_pid
    if child_pid:
        try:
            os.kill(child_pid, signum)
        except OSError:
            pass
    raise SystemExit(128 + signum)

for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(sig, forward_signal)

shell_args_raw = os.environ.get("DEVCANVAS_SHELL_ARGS_JSON", "")
try:
    shell_args = json.loads(shell_args_raw) if shell_args_raw else [shell, "-i"]
except Exception:
    shell_args = [shell, "-i"]
if not isinstance(shell_args, list) or len(shell_args) == 0:
    shell_args = [shell, "-i"]

child_pid, fd = pty.fork()

if child_pid == 0:
    os.execvpe(shell, shell_args, os.environ)

os.write(2, f"\x1fDEVCANVAS_CHILD_PID:{child_pid}\x1f".encode())
apply_resize(fd, cols, rows)
os.set_blocking(fd, False)
stdin_fd = sys.stdin.fileno()
stdout_fd = sys.stdout.fileno()

while True:
    readable, _, _ = select.select([fd, stdin_fd], [], [])
    if fd in readable:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b""
        if not data:
            break
        os.write(stdout_fd, data)
    if stdin_fd in readable:
        try:
            data = os.read(stdin_fd, 65536)
        except OSError:
            data = b""
        if not data:
            break
        stdin_buffer.extend(data)
        while True:
            newline_index = stdin_buffer.find(b"\n")
            if newline_index == -1:
                break
            line = bytes(stdin_buffer[:newline_index])
            del stdin_buffer[:newline_index + 1]
            if line.startswith(b"D:"):
                try:
                    decoded = base64.b64decode(line[2:], validate=True)
                except Exception:
                    continue
                if decoded:
                    os.write(fd, decoded)
            elif line.startswith(b"R:"):
                try:
                    _, next_cols, next_rows = line.decode("ascii").split(":")
                    apply_resize(fd, int(next_cols), int(next_rows))
                except Exception:
                    continue

_, status = os.waitpid(child_pid, 0)
raise SystemExit(os.waitstatus_to_exitcode(status))
`

let resolvedPython3: string | null | undefined
let resolvedUserPath: string | undefined

/**
 * Get the user's full PATH from their login shell.
 * This is critical when running as a Tauri sidecar because the sidecar
 * inherits a minimal PATH that lacks homebrew, nvm, etc.
 */
function getUserLoginPath(): string {
  if (resolvedUserPath !== undefined) return resolvedUserPath

  try {
    const shell = getDefaultShell()
    const result = Bun.spawnSync([shell, '-l', '-c', 'echo $PATH'], {
      stdout: 'pipe',
      stderr: 'ignore',
      cwd: USER_HOME,
    })
    const path = result.stdout.toString().trim()
    if (path && path.includes('/')) {
      resolvedUserPath = path
      return path
    }
  } catch {}

  resolvedUserPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  return resolvedUserPath
}

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !CLAUDE_ENV_KEYS.includes(k)) env[k] = v
  }
  env.PATH = getUserLoginPath()
  env.HOME = USER_HOME
  return { ...env, ...extra }
}

/**
 * Detect the user's default shell from $SHELL env, falling back to
 * /bin/zsh on macOS and /bin/bash on everything else.
 */
function getDefaultShell(): string {
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

function getPython3(): string | null {
  if (resolvedPython3 !== undefined) return resolvedPython3

  const candidates = [
    process.env.PYTHON3,
    process.env.PYTHON,
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    try {
      if (candidate.includes('/')) {
        if (existsSync(candidate)) {
          resolvedPython3 = candidate
          return candidate
        }
        continue
      }

      const proc = Bun.spawnSync([candidate, '--version'], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
      if (proc.exitCode === 0) {
        resolvedPython3 = candidate
        return candidate
      }
    } catch {}
  }

  resolvedPython3 = null
  return null
}

function spawnPipeShell(shell: string, cols: number, rows: number, workingDir: string) {
  const launch = getShellLaunchConfig(shell)
  return Bun.spawn(launch.args, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: workingDir,
    env: cleanEnv({
      SHELL: shell,
      TERM: 'xterm-256color',
      PWD: workingDir,
      COLUMNS: String(cols),
      LINES: String(rows),
      ...launch.env,
    }),
  })
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
  resize: (cols: number, rows: number) => void
  cleanup: () => void
}

const activePtys = new Map<string, ActivePty>()

function encodePtyInput(data: string): Uint8Array {
  return new TextEncoder().encode(`D:${Buffer.from(data, 'utf8').toString('base64')}\n`)
}

function encodePtyResize(cols: number, rows: number): Uint8Array {
  const nextCols = Math.max(1, Math.floor(cols))
  const nextRows = Math.max(1, Math.floor(rows))
  return new TextEncoder().encode(`R:${nextCols}:${nextRows}\n`)
}

function extractTrackedChildPid(
  input: string,
  onPid: (pid: number) => void
): { visibleText: string; pendingText: string } {
  let text = input
  text = text.replace(
    /\x1fDEVCANVAS_CHILD_PID:(\d+)\x1f/g,
    (_match, pidText: string) => {
      const nextPid = Number(pidText)
      if (Number.isFinite(nextPid) && nextPid > 0) onPid(nextPid)
      return ''
    }
  )

  const markerStart = text.lastIndexOf(BRIDGE_CHILD_PID_PREFIX)
  if (markerStart !== -1 && text.indexOf(BRIDGE_CHILD_PID_SUFFIX, markerStart + BRIDGE_CHILD_PID_PREFIX.length) === -1) {
    return {
      visibleText: text.slice(0, markerStart),
      pendingText: text.slice(markerStart),
    }
  }

  for (let suffixLength = BRIDGE_CHILD_PID_PREFIX.length - 1; suffixLength > 0; suffixLength -= 1) {
    const suffix = text.slice(-suffixLength)
    if (BRIDGE_CHILD_PID_PREFIX.startsWith(suffix)) {
      return {
        visibleText: text.slice(0, -suffixLength),
        pendingText: suffix,
      }
    }
  }

  return { visibleText: text, pendingText: '' }
}

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
  onData: (chunk: string) => void,
  options: {
    workingDir?: string | null
    onWorkingDirChange?: (workingDir: string) => void
  } = {}
): PtySession {
  const shell = getDefaultShell()
  const python3 = getPython3()
  const launchDir = resolveWorkingDirectory(options.workingDir ?? getDefaultWorkingDirectory())
  const launch = getShellLaunchConfig(shell)
  const proc = python3
    ? Bun.spawn([python3, '-u', '-c', PYTHON_PTY_BRIDGE, shell, String(cols), String(rows)], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: launchDir,
        env: cleanEnv({
          SHELL: shell,
          PWD: launchDir,
          TERM: 'xterm-256color',
          COLUMNS: String(cols),
          LINES: String(rows),
          DEVCANVAS_SHELL_ARGS_JSON: JSON.stringify(launch.args),
          ...launch.env,
        }),
      })
    : spawnPipeShell(shell, cols, rows, launchDir)

  let stopped = false
  let lastWorkingDir = launchDir
  let trackedProcessPid = proc.pid ?? 0
  let cwdRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let cwdPollInterval: ReturnType<typeof setInterval> | null = null
  let stderrBuffer = ''
  let stdoutBuffer = ''

  const syncWorkingDir = async () => {
    if (stopped) return
    const nextWorkingDir = await readLocalProcessWorkingDirectory(trackedProcessPid)
    if (!nextWorkingDir || nextWorkingDir === lastWorkingDir) return
    lastWorkingDir = nextWorkingDir
    options.onWorkingDirChange?.(nextWorkingDir)
  }

  const scheduleWorkingDirRefresh = (delay = 650) => {
    if (cwdRefreshTimer) clearTimeout(cwdRefreshTimer)
    cwdRefreshTimer = setTimeout(() => {
      cwdRefreshTimer = null
      void syncWorkingDir()
    }, delay)
  }

  options.onWorkingDirChange?.(launchDir)
  scheduleWorkingDirRefresh(250)
  cwdPollInterval = setInterval(() => {
    void syncWorkingDir()
  }, 3000)

  // Stream stdout
  async function readStream(stream: ReadableStream<Uint8Array>, label: 'stdout' | 'stderr') {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (!stopped) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.length > 0) {
          const text = decoder.decode(value, { stream: true })
          if (!text) continue

          if (label === 'stderr') {
            const { visibleText, pendingText } = extractTrackedChildPid(stderrBuffer + text, (nextPid) => {
              trackedProcessPid = nextPid
              void syncWorkingDir()
            })
            stderrBuffer = pendingText
            if (visibleText.trim()) {
              console.warn(`[pty:${sessionId}] bridge stderr: ${visibleText.trimEnd()}`)
            }
            continue
          }

          const { visibleText, pendingText } = consumeOsc7Output(stdoutBuffer + text, (nextWorkingDir) => {
            if (nextWorkingDir === lastWorkingDir) return
            lastWorkingDir = nextWorkingDir
            options.onWorkingDirChange?.(nextWorkingDir)
          })
          stdoutBuffer = pendingText
          if (visibleText) onData(visibleText)
        }
      }
    } catch (err: any) {
      if (!stopped) {
        console.error(`[pty:${sessionId}] ${label} read error:`, err.message)
      }
    } finally {
      const text = decoder.decode()
      if (label === 'stderr') {
        const { visibleText, pendingText } = extractTrackedChildPid(stderrBuffer + text, (nextPid) => {
          trackedProcessPid = nextPid
          void syncWorkingDir()
        })
        stderrBuffer = pendingText
        if (visibleText.trim()) {
          console.warn(`[pty:${sessionId}] bridge stderr: ${visibleText.trimEnd()}`)
        }
        if (stderrBuffer.trim()) {
          console.warn(`[pty:${sessionId}] bridge stderr (incomplete): ${stderrBuffer.trimEnd()}`)
        }
        stderrBuffer = ''
      } else {
        const { visibleText, pendingText } = consumeOsc7Output(stdoutBuffer + text, (nextWorkingDir) => {
          if (nextWorkingDir === lastWorkingDir) return
          lastWorkingDir = nextWorkingDir
          options.onWorkingDirChange?.(nextWorkingDir)
        })
        stdoutBuffer = pendingText
        if (visibleText) onData(visibleText)
      }
      reader.releaseLock()
    }
  }

  readStream(proc.stdout, 'stdout')
  readStream(proc.stderr, 'stderr')
  if (!python3) onData(FALLBACK_PTY_MESSAGE)

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
      const encoded = python3 ? encodePtyInput(data) : new TextEncoder().encode(data)
      proc.stdin.write(encoded)
      scheduleWorkingDirRefresh()
    } catch (err) {
      console.error(`[pty:${sessionId}] write error:`, err)
    }
  }

  function resize(nextCols: number, nextRows: number) {
    if (stopped || !proc.stdin) return
    if (!python3) {
      console.debug(`[pty:${sessionId}] resize to ${nextCols}x${nextRows} (best-effort)`)
      return
    }
    try {
      proc.stdin.write(encodePtyResize(nextCols, nextRows))
    } catch (err) {
      console.error(`[pty:${sessionId}] resize error:`, err)
    }
  }

  function kill() {
    stopped = true
    if (cwdRefreshTimer) {
      clearTimeout(cwdRefreshTimer)
      cwdRefreshTimer = null
    }
    if (cwdPollInterval) {
      clearInterval(cwdPollInterval)
      cwdPollInterval = null
    }
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

  activePtys.set(sessionId, { proc, onData, resize, cleanup })

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
  target: ResolvedSshTarget,
  cols: number = 220,
  rows: number = 50,
  onData: (chunk: string) => void
): PtySession {
  const controlPath = getSshControlPath(sessionId)
  const args = [
    '-t',
    '-t',
    '-o', 'ConnectTimeout=10',
    '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'TCPKeepAlive=yes',
    '-o', 'BatchMode=no',
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPersist=600',
    '-o', `ControlPath=${controlPath}`,
    '-o', 'LogLevel=ERROR',
  ]
  if (target.port) args.push('-p', String(target.port))
  if (target.user) args.push('-l', target.user)
  if (target.identityFile) args.push('-i', target.identityFile)
  args.push(makeSshTargetString(target))
  if (target.durable && target.remoteSessionName) {
    args.push(makeRemoteDurableShellCommand(target.remoteSessionName))
  }

  const proc = Bun.spawn(['ssh', ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: USER_HOME,
    env: cleanEnv({
      TERM: 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
    }),
  })

  let stopped = false

  async function readStream(stream: ReadableStream<Uint8Array>, label: string) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (!stopped) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.length > 0) {
          const text = decoder.decode(value, { stream: true })
          if (text) onData(text)
        }
      }
    } catch (err: any) {
      if (!stopped) console.error(`[ssh:${sessionId}] ${label} read error:`, err.message)
    } finally {
      const text = decoder.decode()
      if (text) onData(text)
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

  activePtys.set(sessionId, { proc, onData, resize, cleanup: kill })
  return ptySession
}

/**
 * List all active PTY session IDs.
 */
export function listActivePtys(): string[] {
  return Array.from(activePtys.keys())
}
