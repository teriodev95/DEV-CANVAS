import { Hono } from 'hono'
import {
  getWorkspaces,
  getWorkspaceById,
  insertWorkspace,
  updateCanvasSnapshot,
} from '../db'

const workspaces = new Hono()

// GET /api/workspaces — list all workspaces
workspaces.get('/', (c) => {
  const rows = getWorkspaces()
  return c.json(rows.map(rowToDto))
})

// POST /api/workspaces — create a workspace
workspaces.post('/', async (c) => {
  let body: { name?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required' }, 400)
  }

  const now = Date.now()
  const workspace = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    canvas_snapshot: '{}',
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

// GET /api/workspaces/:id — get one workspace
workspaces.get('/:id', (c) => {
  const id = c.req.param('id')
  const row = getWorkspaceById(id)
  if (!row) return c.json({ error: 'Workspace not found' }, 404)
  return c.json(rowToDto(row))
})

// PUT /api/workspaces/:id/canvas — save canvas snapshot
workspaces.put('/:id/canvas', async (c) => {
  const id = c.req.param('id')
  const existing = getWorkspaceById(id)
  if (!existing) return c.json({ error: 'Workspace not found' }, 404)

  let body: { snapshot?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.snapshot === undefined || body.snapshot === null) {
    return c.json({ error: 'snapshot is required' }, 400)
  }

  const snapshot = typeof body.snapshot === 'string' ? body.snapshot : JSON.stringify(body.snapshot)

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

  let parsed: unknown = {}
  try {
    parsed = JSON.parse(row.canvas_snapshot)
  } catch {
    parsed = row.canvas_snapshot
  }

  return c.json({ id: row.id, snapshot: parsed, updatedAt: row.updated_at })
})

// ---------------------------------------------------------------------------
// DTO helper
// ---------------------------------------------------------------------------

function rowToDto(row: {
  id: string
  name: string
  canvas_snapshot: string
  created_at: number
  updated_at: number
}) {
  return {
    id: row.id,
    name: row.name,
    canvasSnapshot: row.canvas_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export { workspaces }
