import { Hono } from 'hono'
import {
  getSessions,
  getSessionById,
  insertSession,
  deleteSession,
  getWorkspaceById,
} from '../db'
import * as tmuxService from '../services/tmux'
import { killPty } from '../services/pty'
import { notifySessionDeleted } from '../ws/handler'

const sessions = new Hono()

// GET /api/sessions?workspaceId=x — list sessions
sessions.get('/', (c) => {
  const workspaceId = c.req.query('workspaceId')
  const rows = getSessions(workspaceId)
  return c.json(rows.map(rowToDto))
})

// POST /api/sessions — create a session
sessions.post('/', async (c) => {
  let body: { workspaceId?: string; name?: string; type?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  const workspace = getWorkspaceById(body.workspaceId)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)

  const sessionType = (body.type === 'pty' ? 'pty' : 'tmux') as 'tmux' | 'pty'
  const now = Date.now()
  const session = {
    id: crypto.randomUUID(),
    workspace_id: body.workspaceId,
    name: body.name.trim(),
    type: sessionType,
    status: 'active',
    created_at: now,
    last_activity: now,
  }

  try {
    if (sessionType === 'tmux') {
      await tmuxService.createSession(session.name)
    }
    insertSession(session)
  } catch (err: any) {
    console.error('[sessions] create error:', err)
    return c.json({ error: `Failed to create session: ${err.message}` }, 500)
  }

  return c.json(rowToDto(session), 201)
})

// DELETE /api/sessions/:id — kill + delete
sessions.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const session = getSessionById(id)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  // Kill the underlying process
  try {
    if (session.type === 'tmux') {
      await tmuxService.killSession(session.name)
    } else {
      killPty(id)
    }
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
}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    lastActivity: row.last_activity,
  }
}

export { sessions }
