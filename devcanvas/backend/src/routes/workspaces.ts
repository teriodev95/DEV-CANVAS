import { Hono } from 'hono'
import {
  deleteWorkspaceCascade,
  getWorkspaces,
  getWorkspaceById,
  getSessions,
  getDefaultWorkspaceSettings,
  insertWorkspace,
  normalizeWorkspaceSettings,
  serializeWorkspaceSettings,
  updateWorkspaceName,
  updateCanvasSnapshot,
  updateWorkspaceSettings,
} from '../db'
import { terminateSessionRuntime } from '../services/session-runtime'
import { notifySessionDeleted } from '../ws/handler'

const workspaces = new Hono()

function parseCanvasSnapshot(snapshot: string): unknown {
  let parsed: unknown = snapshot

  for (let depth = 0; depth < 3 && typeof parsed === 'string'; depth++) {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      break
    }
  }

  return parsed
}

// GET /api/workspaces — list all workspaces
workspaces.get('/', (c) => {
  const rows = getWorkspaces()
  return c.json(rows.map(rowToDto))
})

// POST /api/workspaces — create a workspace
workspaces.post('/', async (c) => {
  let body: { name?: string, settings?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }

  const now = Date.now()
  const settings = normalizeWorkspaceSettings(body.settings ?? getDefaultWorkspaceSettings())
  const workspace = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    canvas_snapshot: '{}',
    settings_json: serializeWorkspaceSettings(settings),
    created_at: now,
    updated_at: now,
  }

  try {
    insertWorkspace(workspace)
  } catch (err: any) {
    console.error('[workspaces] insert error:', err)
    return c.json({ error: 'Failed to create workspace' }, 500)
  }

  return c.json(rowToDto(workspace), 201)
})

// PATCH /api/workspaces/:id/settings — update workspace settings
workspaces.patch('/:id/settings', async (c) => {
  const id = c.req.param('id')
  const existing = getWorkspaceById(id)
  if (!existing) return c.json({ error: 'Workspace not found' }, 404)

  let body: { settings?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.settings === undefined) {
    return c.json({ error: 'settings is required' }, 400)
  }

  const nextSettings = normalizeWorkspaceSettings(body.settings)
  updateWorkspaceSettings(id, serializeWorkspaceSettings(nextSettings), Date.now())
  return c.json(rowToDto(getWorkspaceById(id)!))
})

// GET /api/workspaces/:id — get one workspace
workspaces.get('/:id', (c) => {
  const id = c.req.param('id')
  const row = getWorkspaceById(id)
  if (!row) return c.json({ error: 'Workspace not found' }, 404)
  return c.json(rowToDto(row))
})

// PATCH /api/workspaces/:id — rename workspace
workspaces.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = getWorkspaceById(id)
  if (!existing) return c.json({ error: 'Workspace not found' }, 404)

  let body: { name?: string }
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const name = body.name?.trim()
  if (!name) return c.json({ error: 'name is required' }, 400)

  updateWorkspaceName(id, name, Date.now())
  return c.json(rowToDto(getWorkspaceById(id)!))
})

// DELETE /api/workspaces/:id — delete workspace and all sessions inside it
workspaces.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = getWorkspaceById(id)
  if (!existing) return c.json({ error: 'Workspace not found' }, 404)

  const workspaceSessions = getSessions(id)
  const results = await Promise.allSettled(
    workspaceSessions.map(async (session) => {
      await terminateSessionRuntime(session)
    })
  )

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `[workspaces] kill error for session ${workspaceSessions[index]?.id ?? 'unknown'}:`,
        result.reason
      )
    }
  })

  const deletedSessionIds = deleteWorkspaceCascade(id)
  for (const sessionId of deletedSessionIds) {
    notifySessionDeleted(sessionId)
  }

  return c.json({ ok: true, id, deletedSessionIds })
})

// PUT /api/workspaces/:id/canvas — save canvas snapshot
workspaces.put('/:id/canvas', async (c) => {
  const id = c.req.param('id')
  const existing = getWorkspaceById(id)
  if (!existing) return c.json({ error: 'Workspace not found' }, 404)

  let body: { snapshot?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.snapshot === undefined || body.snapshot === null) {
    return c.json({ error: 'snapshot is required' }, 400)
  }

  const normalized = typeof body.snapshot === 'string'
    ? parseCanvasSnapshot(body.snapshot)
    : body.snapshot
  const snapshot = JSON.stringify(normalized)

  try {
    updateCanvasSnapshot(id, snapshot, Date.now())
  } catch (err: any) {
    console.error('[workspaces] canvas update error:', err)
    return c.json({ error: 'Failed to update canvas' }, 500)
  }

  const updated = getWorkspaceById(id)!
  return c.json(rowToDto(updated))
})

// GET /api/workspaces/:id/canvas — get canvas snapshot
workspaces.get('/:id/canvas', (c) => {
  const id = c.req.param('id')
  const row = getWorkspaceById(id)
  if (!row) return c.json({ error: 'Workspace not found' }, 404)

  return c.json({ id: row.id, snapshot: parseCanvasSnapshot(row.canvas_snapshot), updatedAt: row.updated_at })
})

// ---------------------------------------------------------------------------
// DTO helper
// ---------------------------------------------------------------------------

function rowToDto(row: {
  id: string
  name: string
  canvas_snapshot: string
  settings_json?: string
  created_at: number
  updated_at: number
  session_count?: number
}) {
  let settings = getDefaultWorkspaceSettings()
  if (row.settings_json) {
    try {
      settings = normalizeWorkspaceSettings(JSON.parse(row.settings_json))
    } catch {
      settings = getDefaultWorkspaceSettings()
    }
  }
  return {
    id: row.id,
    name: row.name,
    canvasSnapshot: row.canvas_snapshot,
    settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionCount: row.session_count ?? 0,
  }
}

export { workspaces }
