import type { ServerWebSocket } from 'bun'
import {
  getDb,
  getSessions,
  getSessionById,
  insertSession,
  hasSessionOutput,
  clearSessionOutput,
  updateSessionActivity,
  updateSessionStatus,
  updateSessionWorkingDir,
  insertSessionOutput,
  getNextSequence,
  getSessionOutput,
} from '../db'
import * as tmuxService from '../services/tmux'
import { tmuxControl } from '../services/tmux-control'
import { spawnPty, spawnSsh, killPty } from '../services/pty'
import type { WSMessage, SessionInfo, TaskActivityInfo, TaskInfo } from './protocol'
import { getDefaultWorkingDirectory, resolveWorkingDirectory } from '../services/working-dir'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// clientId → WebSocket
const clients = new Map<string, ServerWebSocket<WsData>>()

// sessionId → Set<clientId>
const sessionSubscribers = new Map<string, Set<string>>()

// workspaceId → Set<clientId>
const workspaceSubscribers = new Map<string, Set<string>>()

// sessionId → cleanup function (for FIFO streams)
const sessionStreams = new Map<string, () => void>()

// sessionId → { cols, rows } (track last known size)
const sessionSizes = new Map<string, { cols: number; rows: number }>()

// sessionId → session info cache (avoids DB lookup on every keystroke)
const sessionCache = new Map<string, { type: 'tmux' | 'pty' | 'ssh'; name: string }>()

export interface WsData {
  clientId: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendToClient(ws: ServerWebSocket<WsData>, msg: object) {
  try {
    ws.send(JSON.stringify(msg))
  } catch (err) {
    console.error(`[ws] Failed to send to client ${ws.data.clientId}:`, err)
  }
}

function broadcastToSession(sessionId: string, msg: object) {
  const subscribers = sessionSubscribers.get(sessionId)
  if (!subscribers || subscribers.size === 0) return

  const payload = JSON.stringify(msg)
  for (const clientId of subscribers) {
    const ws = clients.get(clientId)
    if (!ws) {
      // Stale subscriber — clean up
      subscribers.delete(clientId)
      continue
    }
    try {
      ws.send(payload)
    } catch (err) {
      console.error(`[ws] Broadcast to ${clientId} failed:`, err)
      subscribers.delete(clientId)
    }
  }
}

function broadcastToWorkspace(workspaceId: string, msg: object) {
  const subscribers = workspaceSubscribers.get(workspaceId)
  if (!subscribers || subscribers.size === 0) return

  const payload = JSON.stringify(msg)
  for (const clientId of subscribers) {
    const ws = clients.get(clientId)
    if (!ws) {
      subscribers.delete(clientId)
      continue
    }
    try {
      ws.send(payload)
    } catch (err) {
      console.error(`[ws] Workspace broadcast to ${clientId} failed:`, err)
      subscribers.delete(clientId)
    }
  }
}

function errorMsg(id: string | undefined, code: string, message: string) {
  return { type: 'error', id, code, message }
}

function syncSessionWorkingDir(sessionId: string, workingDir: string, touchActivity = true) {
  const now = Date.now()
  updateSessionWorkingDir(sessionId, workingDir, touchActivity ? now : undefined)
  broadcastToSession(sessionId, {
    type: 'session:cwd',
    sessionId,
    workingDir,
  })
}

// ---------------------------------------------------------------------------
// Stream management
// ---------------------------------------------------------------------------

function ensureStream(sessionId: string, sessionName: string) {
  if (sessionStreams.has(sessionId)) return

  let sequence = getNextSequence(sessionId)

  const cleanup = tmuxService.startStreaming(
    sessionId,
    sessionName,
    (chunk: string) => {
      const now = Date.now()
      const seq = sequence++

      // Broadcast first — don't block on DB write
      broadcastToSession(sessionId, {
        type: 'terminal:output',
        sessionId,
        data: chunk,
        sequence: seq,
        timestamp: now,
      })

      // Persist async
      queueMicrotask(() => {
        try {
          insertSessionOutput(sessionId, seq, chunk, now)
          updateSessionActivity(sessionId, now)
        } catch (err) {
          console.error(`[ws] DB write error for session ${sessionId}:`, err)
        }
      })
    },
    (workingDir) => {
      queueMicrotask(() => {
        try {
          syncSessionWorkingDir(sessionId, workingDir)
        } catch (err) {
          console.error(`[ws] Failed to persist tmux working dir for ${sessionId}:`, err)
        }
      })
    }
  )

  sessionStreams.set(sessionId, cleanup)
}

function stopStream(sessionId: string) {
  const cleanup = sessionStreams.get(sessionId)
  if (cleanup) {
    cleanup()
    sessionStreams.delete(sessionId)
  }
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleSessionCreate(ws: ServerWebSocket<WsData>, msg: Extract<WSMessage, { type: 'session:create' }>) {
  const { id, name, workspaceId, sessionType = 'tmux' } = msg
  const launchWorkingDir = getDefaultWorkingDirectory()

  // Validate workspace exists
  const workspace = getDb().query('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
  if (!workspace) {
    sendToClient(ws, errorMsg(id, 'WORKSPACE_NOT_FOUND', `Workspace ${workspaceId} not found`))
    return
  }

  const sessionId = crypto.randomUUID()
  const now = Date.now()

  try {
    if (sessionType === 'tmux') {
      await tmuxService.createSession(name, launchWorkingDir)
    } else {
      // PTY sessions are spawned on first subscribe
    }

    insertSession({
      id: sessionId,
      workspace_id: workspaceId,
      name,
      type: sessionType,
      status: 'active',
      created_at: now,
      last_activity: now,
      working_dir: sessionType === 'ssh' ? null : launchWorkingDir,
    })

    sendToClient(ws, {
      type: 'session:created',
      id,
      sessionId,
      name,
    })
  } catch (err: any) {
    console.error(`[ws] session:create error:`, err)
    sendToClient(ws, errorMsg(id, 'SESSION_CREATE_FAILED', err.message))
  }
}

async function handleSessionSubscribe(
  ws: ServerWebSocket<WsData>,
  msg: Extract<WSMessage, { type: 'session:subscribe' }>
) {
  const { id, sessionId, fromSequence = 0 } = msg
  const { clientId } = ws.data

  const session = getSessionById(sessionId)
  if (!session) {
    sendToClient(ws, errorMsg(id, 'SESSION_NOT_FOUND', `Session ${sessionId} not found`))
    return
  }

  // Add to subscribers
  if (!sessionSubscribers.has(sessionId)) {
    sessionSubscribers.set(sessionId, new Set())
  }
  sessionSubscribers.get(sessionId)!.add(clientId)

  // Cache session info to avoid DB lookups on the hot input path
  if (!sessionCache.has(sessionId)) {
    sessionCache.set(sessionId, { type: session.type as 'tmux' | 'pty' | 'ssh', name: session.name })
  }

  let skipBufferedReplay = false
  let restartNotice: string | null = null
  let tmuxResyncScreen = ''
  const hadStream = session.type === 'tmux' ? sessionStreams.has(sessionId) : false

  // Start streaming if not already active
  if (session.type === 'tmux') {
    const tmuxExists = await tmuxService.hasSession(session.name)
    if (!tmuxExists) {
      const launchWorkingDir = resolveWorkingDirectory(session.working_dir ?? getDefaultWorkingDirectory())
      clearSessionOutput(sessionId)
      skipBufferedReplay = true
      restartNotice =
        '\x1bc\x1b[33m[devcanvas] Esta sesion tmux se reinicio porque la original ya no existia.\x1b[0m\r\n' +
        `\x1b[90m[devcanvas] Se abrio de nuevo en ${launchWorkingDir}.\x1b[0m\r\n\r\n`

      await tmuxService.createSession(session.name, launchWorkingDir)
      updateSessionStatus(sessionId, 'active', Date.now())
      syncSessionWorkingDir(sessionId, launchWorkingDir)
    } else {
      const liveWorkingDir = await tmuxService.getSessionWorkingDirectory(session.name)
      if (liveWorkingDir) {
        updateSessionStatus(sessionId, 'active', Date.now())
        syncSessionWorkingDir(sessionId, liveWorkingDir)
      }
    }

    ensureStream(sessionId, session.name)
    if (!hadStream) {
      tmuxResyncScreen = await tmuxService.capturePane(session.name)
    }
  } else if (session.type === 'pty' || session.type === 'ssh') {
    // Spawn PTY/SSH process if not already running
    const { getPty } = await import('../services/pty')
    if (!getPty(sessionId)) {
      const isColdPtyRestore = session.type === 'pty' && hasSessionOutput(sessionId)
      if (isColdPtyRestore) {
        clearSessionOutput(sessionId)
        skipBufferedReplay = true
        const launchWorkingDir = resolveWorkingDirectory(session.working_dir ?? getDefaultWorkingDirectory())
        restartNotice =
          '\x1bc\x1b[33m[devcanvas] Esta sesion local se reinicio al relanzar la app.\x1b[0m\r\n' +
          `\x1b[90m[devcanvas] El historial anterior no puede reanudarse con fidelidad en PTY; se abrio un shell nuevo en ${launchWorkingDir}.\x1b[0m\r\n\r\n`
      }

      let sequence = getNextSequence(sessionId)

      const onChunk = (chunk: string) => {
        const now = Date.now()
        const seq = sequence++
        broadcastToSession(sessionId, {
          type: 'terminal:output',
          sessionId,
          data: chunk,
          sequence: seq,
          timestamp: now,
        })
        queueMicrotask(() => {
          try {
            insertSessionOutput(sessionId, seq, chunk, now)
            updateSessionActivity(sessionId, now)
          } catch (err) {
            console.error(`[ws] PTY DB write error:`, err)
          }
        })
      }

      if (session.type === 'ssh') {
        if (session.ssh_host && session.ssh_user && (session.ssh_lookup || session.ssh_host)) {
          const sshSession = spawnSsh(sessionId, {
            lookup: session.ssh_lookup ?? session.ssh_host,
            label: session.name,
            host: session.ssh_host,
            user: session.ssh_user,
            port: session.ssh_port ?? 22,
            identityFile: session.ssh_identity_file ?? null,
            durable: Boolean(session.ssh_durable),
            remoteSessionName: session.ssh_remote_session ?? null,
          }, 220, 50, onChunk)
          ptyWriters.set(sessionId, sshSession.write.bind(sshSession))
        } else {
          console.error(`[ws] SSH session "${session.name}" is missing connection metadata`)
        }
      } else {
        const launchWorkingDir = resolveWorkingDirectory(session.working_dir ?? getDefaultWorkingDirectory())
        syncSessionWorkingDir(sessionId, launchWorkingDir)
        spawnPtyAndTrack(sessionId, 220, 50, onChunk, launchWorkingDir)
      }
    }
  }

  // Replay buffered output from DB unless this is a cold PTY restore.
  if (!skipBufferedReplay && fromSequence >= 0) {
    const rows = getSessionOutput(sessionId, fromSequence)
    for (const row of rows) {
      sendToClient(ws, {
        type: 'terminal:output',
        sessionId,
        data: row.data,
        sequence: row.sequence,
        timestamp: row.timestamp,
      })
    }
  }

  if (tmuxResyncScreen) {
    sendToClient(ws, {
      type: 'terminal:output',
      sessionId,
      data: `\x1bc${tmuxResyncScreen}`,
      sequence: getNextSequence(sessionId),
      timestamp: Date.now(),
    })
  }

  if (restartNotice) {
    sendToClient(ws, {
      type: 'terminal:output',
      sessionId,
      data: restartNotice,
      sequence: 0,
      timestamp: Date.now(),
    })
  }

  // Notify frontend that the session is ready for input
  sendToClient(ws, { type: 'session:ready', id, sessionId })
}

async function handleTerminalInput(
  ws: ServerWebSocket<WsData>,
  msg: Extract<WSMessage, { type: 'terminal:input' }>
) {
  const { id, sessionId, data } = msg

  // Use in-memory cache to avoid a DB query on every keystroke
  let cached = sessionCache.get(sessionId)
  if (!cached) {
    // Fallback: populate cache from DB (handles race with subscribe)
    const session = getSessionById(sessionId)
    if (!session) {
      sendToClient(ws, errorMsg(id, 'SESSION_NOT_FOUND', `Session ${sessionId} not found`))
      return
    }
    cached = { type: session.type as 'tmux' | 'pty' | 'ssh', name: session.name }
    sessionCache.set(sessionId, cached)
  }

  try {
    if (cached.type === 'tmux') {
      // Fast path: control-mode client (~0.1ms, no subprocess)
      // Falls back to subprocess if control client isn't ready yet
      const sent = tmuxControl.sendKeys(cached.name, data)
      if (!sent) await tmuxService.sendInput(cached.name, data)
    } else {
      // Both 'pty' and 'ssh' use the ptyWriters map
      const writeFn = ptyWriters.get(sessionId)
      if (writeFn) writeFn(data)
    }
    // Fire-and-forget — don't await DB write on the hot input path
    queueMicrotask(() => updateSessionActivity(sessionId, Date.now()))
  } catch (err: any) {
    console.error(`[ws] terminal:input error:`, err)
    sendToClient(ws, errorMsg(id, 'INPUT_FAILED', err.message))
  }
}

// Map to store PTY write functions (since spawnPty returns PtySession but
// getPty only returns the internal ActivePty)
const ptyWriters = new Map<string, (data: string) => void>()

// Override spawnPty usage to capture write function
function spawnPtyAndTrack(
  sessionId: string,
  cols: number,
  rows: number,
  onData: (chunk: string) => void,
  workingDir?: string | null
) {
  const ptySession = spawnPty(sessionId, cols, rows, onData, {
    workingDir,
    onWorkingDirChange: (nextWorkingDir) => {
      queueMicrotask(() => {
        try {
          syncSessionWorkingDir(sessionId, nextWorkingDir)
        } catch (err) {
          console.error(`[ws] Failed to persist PTY working dir for ${sessionId}:`, err)
        }
      })
    },
  })
  ptyWriters.set(sessionId, ptySession.write.bind(ptySession))
  return ptySession
}

async function handleTerminalResize(
  ws: ServerWebSocket<WsData>,
  msg: Extract<WSMessage, { type: 'terminal:resize' }>
) {
  const { id, sessionId, cols, rows } = msg

  const session = getSessionById(sessionId)
  if (!session) {
    sendToClient(ws, errorMsg(id, 'SESSION_NOT_FOUND', `Session ${sessionId} not found`))
    return
  }

  sessionSizes.set(sessionId, { cols, rows })

  try {
    if (session.type === 'tmux') {
      await tmuxService.resizeSession(session.name, cols, rows)
    } else {
      const { getPty } = await import('../services/pty')
      getPty(sessionId)?.resize(cols, rows)
    }
  } catch (err: any) {
    console.error(`[ws] terminal:resize error:`, err)
  }
}

async function handleSessionList(
  ws: ServerWebSocket<WsData>,
  msg: Extract<WSMessage, { type: 'session:list' }>
) {
  const { id, workspaceId } = msg
  const rows = getSessions(workspaceId)
  const sessions: SessionInfo[] = rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    type: r.type as 'tmux' | 'pty' | 'ssh',
    status: r.status,
    createdAt: r.created_at,
    lastActivity: r.last_activity,
    workingDir: r.working_dir ?? null,
  }))

  sendToClient(ws, { type: 'session:list:response', id, sessions })
}

function handleTasksSubscribe(
  ws: ServerWebSocket<WsData>,
  msg: Extract<WSMessage, { type: 'tasks:subscribe' }>
) {
  const { clientId } = ws.data
  const { id, workspaceId } = msg
  if (!workspaceSubscribers.has(workspaceId)) {
    workspaceSubscribers.set(workspaceId, new Set())
  }
  workspaceSubscribers.get(workspaceId)!.add(clientId)
  sendToClient(ws, { type: 'tasks:subscribed', id, workspaceId })
}

function handleTasksUnsubscribe(
  ws: ServerWebSocket<WsData>,
  msg: Extract<WSMessage, { type: 'tasks:unsubscribe' }>
) {
  const { clientId } = ws.data
  const { workspaceId } = msg
  const subs = workspaceSubscribers.get(workspaceId)
  if (subs) {
    subs.delete(clientId)
    if (subs.size === 0) workspaceSubscribers.delete(workspaceId)
  }
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle
// ---------------------------------------------------------------------------

export const wsHandler = {
  open(ws: ServerWebSocket<WsData>) {
    const { clientId } = ws.data
    clients.set(clientId, ws)
    console.log(`[ws] Client connected: ${clientId}`)
  },

  async message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    let msg: WSMessage
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as WSMessage
    } catch {
      sendToClient(ws, errorMsg(undefined, 'PARSE_ERROR', 'Invalid JSON'))
      return
    }

    try {
      switch (msg.type) {
        case 'ping':
          sendToClient(ws, { type: 'pong', id: msg.id })
          break

        case 'session:create':
          await handleSessionCreate(ws, msg)
          break

        case 'session:subscribe':
          await handleSessionSubscribe(ws, msg)
          break

        case 'session:list':
          await handleSessionList(ws, msg)
          break

        case 'tasks:subscribe':
          handleTasksSubscribe(ws, msg)
          break

        case 'tasks:unsubscribe':
          handleTasksUnsubscribe(ws, msg)
          break

        case 'terminal:input':
          await handleTerminalInput(ws, msg)
          break

        case 'terminal:resize':
          await handleTerminalResize(ws, msg)
          break

        default:
          sendToClient(ws, errorMsg(undefined, 'UNKNOWN_TYPE', `Unknown message type: ${(msg as any).type}`))
      }
    } catch (err: any) {
      console.error(`[ws] Unhandled error processing message:`, err)
      sendToClient(ws, errorMsg(undefined, 'INTERNAL_ERROR', err.message))
    }
  },

  close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
    const { clientId } = ws.data
    clients.delete(clientId)

    // Remove from all session subscriber sets
    for (const [sessionId, subs] of sessionSubscribers.entries()) {
      subs.delete(clientId)
      // Keep tmux capture streams alive even when no UI is attached.
      // Otherwise, switching workspaces drops all output produced while
      // the user is away, and full-screen tools look frozen on return.
      if (subs.size === 0) {
        sessionSubscribers.delete(sessionId)
      }
    }
    for (const [workspaceId, subs] of workspaceSubscribers.entries()) {
      subs.delete(clientId)
      if (subs.size === 0) {
        workspaceSubscribers.delete(workspaceId)
      }
    }

    console.log(`[ws] Client disconnected: ${clientId} (code=${code})`)
  },

  error(ws: ServerWebSocket<WsData>, err: Error) {
    console.error(`[ws] WebSocket error for client ${ws.data.clientId}:`, err)
  },
}

// ---------------------------------------------------------------------------
// Internal helpers used by the REST layer
// ---------------------------------------------------------------------------

/**
 * Notify all subscribers of a session that it has been deleted/killed.
 */
export function notifySessionDeleted(sessionId: string) {
  stopStream(sessionId)
  killPty(sessionId)
  ptyWriters.delete(sessionId)
  sessionSubscribers.delete(sessionId)
  sessionCache.delete(sessionId)
}

export function notifyTaskUpsert(workspaceId: string, task: TaskInfo) {
  broadcastToWorkspace(workspaceId, {
    type: 'task:upsert',
    workspaceId,
    task,
  })
}

export function notifyTaskDeleted(workspaceId: string, taskId: string) {
  broadcastToWorkspace(workspaceId, {
    type: 'task:delete',
    workspaceId,
    taskId,
  })
}

export function notifyTaskActivity(workspaceId: string, activity: TaskActivityInfo) {
  broadcastToWorkspace(workspaceId, {
    type: 'task:activity',
    workspaceId,
    activity,
  })
}
