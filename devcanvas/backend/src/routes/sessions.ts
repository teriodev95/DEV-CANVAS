import { Hono } from 'hono'
import {
  getSessions,
  getSessionById,
  insertSession,
  deleteSession,
  getWorkspaceById,
  normalizeSessionAppearance,
  serializeSessionAppearance,
  updateSessionSettings,
  updateSessionStatus,
  updateSessionWorkingDir,
} from '../db'
import * as tmuxService from '../services/tmux'
import { terminateSessionRuntime } from '../services/session-runtime'
import { notifySessionDeleted } from '../ws/handler'
import { makeDurableRemoteSessionName, resolveSshTarget } from '../services/ssh'
import { getDefaultWorkingDirectory, resolveWorkingDirectory } from '../services/working-dir'

const sessions = new Hono()

// GET /api/sessions?workspaceId=x — list sessions
sessions.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const rows = getSessions(workspaceId)
  const tmuxAvailable = await tmuxService.isTmuxAvailable()
  const visibleRows = tmuxAvailable ? rows : rows.filter((row) => row.type !== 'tmux')
  return c.json(visibleRows.map(rowToDto))
})

// GET /api/sessions/tmux/live?workspaceId=x — list live tmux sessions for recovery/import
sessions.get('/tmux/live', async (c) => {
  const tmuxAvailable = await tmuxService.isTmuxAvailable()
  if (!tmuxAvailable) return c.json([])

  const workspaceId = c.req.query('workspaceId') ?? null
  const rows = getSessions().filter((row) => row.type === 'tmux')
  const trackedByName = new Map(rows.map((row) => [row.name, row]))

  const liveSessions = await tmuxService.listSessions()
  const payload = liveSessions
    .map((name) => {
      const tracked = trackedByName.get(name) ?? null
      const workspace = tracked ? getWorkspaceById(tracked.workspace_id) : null

      return {
        name,
        tracked: Boolean(tracked),
        sessionId: tracked?.id ?? null,
        workspaceId: tracked?.workspace_id ?? null,
        workspaceName: workspace?.name ?? null,
        inCurrentWorkspace: Boolean(workspaceId && tracked?.workspace_id === workspaceId),
        lastActivity: tracked?.last_activity ?? null,
      }
    })
    .sort((left, right) => {
      const leftRank = left.inCurrentWorkspace ? 0 : left.tracked ? 2 : 1
      const rightRank = right.inCurrentWorkspace ? 0 : right.tracked ? 2 : 1
      if (leftRank !== rightRank) return leftRank - rightRank
      if ((right.lastActivity ?? 0) !== (left.lastActivity ?? 0)) {
        return (right.lastActivity ?? 0) - (left.lastActivity ?? 0)
      }
      return left.name.localeCompare(right.name)
    })

  return c.json(payload)
})

// POST /api/sessions — create a session
sessions.post('/', async (c) => {
  let body: {
    workspaceId?: string
    name?: string
    type?: string
    workingDir?: string
    sshConfig?: {
      lookup?: string
      label?: string
      host?: string
      user?: string
      port?: number
      durable?: boolean
      remoteSessionName?: string
      identityFile?: string
    }
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.workspaceId) return c.json({ error: 'workspaceId is required' }, 400)

  const workspace = getWorkspaceById(body.workspaceId)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)

  const sessionType = (['tmux', 'pty', 'ssh'].includes(body.type ?? '')
    ? body.type
    : 'tmux') as 'tmux' | 'pty' | 'ssh'
  const sessionId = crypto.randomUUID()
  const launchWorkingDir = resolveWorkingDirectory(body.workingDir ?? getDefaultWorkingDirectory())

  // SSH: derive name from connection details; others: require explicit name
  let sessionName: string
  let sshResolved: ReturnType<typeof resolveSshTarget> | null = null
  let sshRemoteSession: string | null = null
  if (sessionType === 'ssh') {
    if (!body.sshConfig?.lookup && !body.sshConfig?.host) {
      return c.json({ error: 'sshConfig.lookup or sshConfig.host is required for ssh sessions' }, 400)
    }
    try {
      sshResolved = resolveSshTarget(body.sshConfig)
    } catch (err: any) {
      return c.json({ error: `Failed to resolve SSH target: ${err.message}` }, 400)
    }
    sshRemoteSession = sshResolved.durable
      ? (body.sshConfig?.remoteSessionName?.trim() || makeDurableRemoteSessionName(sessionId))
      : null
    sessionName = body.name?.trim() || sshResolved.label
  } else {
    if (!body.name) return c.json({ error: 'name is required' }, 400)
    sessionName = body.name.trim()
  }

  const now = Date.now()
  const session = {
    id: sessionId,
    workspace_id: body.workspaceId,
    name: sessionName,
    type: sessionType,
    status: 'active',
    created_at: now,
    last_activity: now,
    ssh_lookup: sshResolved?.lookup ?? null,
    ssh_host: sshResolved?.host ?? null,
    ssh_user: sshResolved?.user ?? null,
    ssh_port: sshResolved?.port ?? null,
    ssh_identity_file: sshResolved?.identityFile ?? null,
    ssh_durable: sshResolved?.durable ? 1 : 0,
    ssh_remote_session: sshRemoteSession,
    appearance_json: serializeSessionAppearance({}),
    working_dir: sessionType === 'ssh' ? null : launchWorkingDir,
  }

  try {
    if (sessionType === 'tmux') {
      await tmuxService.createSession(session.name, launchWorkingDir)
    }
    // PTY and SSH sessions are spawned on first WebSocket subscribe
    insertSession(session)
  } catch (err: any) {
    console.error('[sessions] create error:', err)
    return c.json({ error: `Failed to create session: ${err.message}` }, 500)
  }

  return c.json(rowToDto(session), 201)
})

// POST /api/sessions/tmux/import — attach an existing live tmux session to a workspace
sessions.post('/tmux/import', async (c) => {
  let body: { workspaceId?: string, name?: string, tmuxSessionName?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const workspaceId = body.workspaceId?.trim()
  const tmuxSessionName = body.tmuxSessionName?.trim()
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!tmuxSessionName) return c.json({ error: 'tmuxSessionName is required' }, 400)

  const workspace = getWorkspaceById(workspaceId)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)

  const tmuxAvailable = await tmuxService.isTmuxAvailable()
  if (!tmuxAvailable) return c.json({ error: 'tmux is not available' }, 400)

  const liveSessions = await tmuxService.listSessions()
  if (!liveSessions.includes(tmuxSessionName)) {
    return c.json({ error: `tmux session "${tmuxSessionName}" is not currently running` }, 404)
  }

  const existing = getSessions().find((row) => row.type === 'tmux' && row.name === tmuxSessionName) ?? null
  const liveWorkingDir = await tmuxService.getSessionWorkingDirectory(tmuxSessionName)
  const resolvedWorkingDir = resolveWorkingDirectory(liveWorkingDir ?? getDefaultWorkingDirectory())
  if (existing) {
    if (existing.workspace_id !== workspaceId) {
      const ownerWorkspace = getWorkspaceById(existing.workspace_id)
      return c.json({
        error: `tmux session "${tmuxSessionName}" already belongs to workspace "${ownerWorkspace?.name ?? existing.workspace_id}"`,
      }, 409)
    }

    if (existing.status !== 'active') {
      updateSessionStatus(existing.id, 'active', Date.now())
    }
    updateSessionWorkingDir(existing.id, resolvedWorkingDir, Date.now())

    return c.json(rowToDto(getSessionById(existing.id)!))
  }

  const now = Date.now()
  const session = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    name: body.name?.trim() || tmuxSessionName,
    type: 'tmux',
    status: 'active',
    created_at: now,
    last_activity: now,
    ssh_lookup: null,
    ssh_host: null,
    ssh_user: null,
    ssh_port: null,
    ssh_identity_file: null,
    ssh_durable: 0,
    ssh_remote_session: null,
    working_dir: resolvedWorkingDir,
    appearance_json: serializeSessionAppearance({}),
  }

  insertSession(session)
  return c.json(rowToDto(session), 201)
})

// GET /api/sessions/:id — get a single session
sessions.get('/:id', (c) => {
  const row = getSessionById(c.req.param('id'))
  if (!row) return c.json({ error: 'Session not found' }, 404)
  return c.json(rowToDto(row))
})

// PATCH /api/sessions/:id — update display name and appearance
sessions.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = getSessionById(id)
  if (!existing) return c.json({ error: 'Session not found' }, 404)

  let body: { name?: string, appearance?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const nextName = body.name?.trim()
  const nextAppearance = body.appearance === undefined
    ? undefined
    : normalizeSessionAppearance(body.appearance)

  if (nextName === undefined && nextAppearance === undefined) {
    return c.json({ error: 'name or appearance is required' }, 400)
  }
  if (body.name !== undefined && !nextName) {
    return c.json({ error: 'name cannot be empty' }, 400)
  }

  updateSessionSettings(id, {
    name: nextName,
    appearanceJson: nextAppearance === undefined ? undefined : serializeSessionAppearance(nextAppearance),
    lastActivity: Date.now(),
  })

  return c.json(rowToDto(getSessionById(id)!))
})

// DELETE /api/sessions/:id — kill + delete
sessions.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const session = getSessionById(id)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  // Kill the underlying process
  try {
    await terminateSessionRuntime(session)
  } catch (err) {
    // Log but don't fail — session may already be dead
    console.warn(`[sessions] kill error for ${id}:`, err)
  }

  // Notify WebSocket subscribers and stop streams
  notifySessionDeleted(id)

  // Remove from DB
  deleteSession(id)

  return c.json({ ok: true, id })
})

// ---------------------------------------------------------------------------
// DTO helper
// ---------------------------------------------------------------------------

function rowToDto(row: {
  id: string
  workspace_id: string
  name: string
  type: string
  status: string
  created_at: number
  last_activity: number
  appearance_json?: string | null
  working_dir?: string | null
}) {
  let appearance = {}
  if (row.appearance_json) {
    try {
      appearance = normalizeSessionAppearance(JSON.parse(row.appearance_json))
    } catch {
      appearance = {}
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    lastActivity: row.last_activity,
    workingDir: row.working_dir ?? null,
    appearance,
  }
}

export { sessions }
