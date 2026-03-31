import { Hono } from 'hono'
import {
  deleteTask,
  getTaskActivity,
  getTaskById,
  getTasks,
  getWorkspaceById,
  insertTask,
  insertTaskActivity,
  type TaskActivityRow,
  type TaskRow,
  type TaskStatus,
  updateTask,
} from '../db'
import {
  notifyTaskActivity,
  notifyTaskDeleted,
  notifyTaskUpsert,
} from '../ws/handler'

const tasks = new Hono()

type ActorPayload = {
  actorType?: string
  actorLabel?: string
}

const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done']

function normalizeTaskStatus(value: unknown): TaskStatus | null {
  return typeof value === 'string' && TASK_STATUSES.includes(value as TaskStatus)
    ? (value as TaskStatus)
    : null
}

function normalizeActor(body: ActorPayload): { actorType: string; actorLabel: string } {
  const actorType = typeof body.actorType === 'string' && body.actorType.trim()
    ? body.actorType.trim()
    : 'system'
  const actorLabel = typeof body.actorLabel === 'string' && body.actorLabel.trim()
    ? body.actorLabel.trim()
    : actorType === 'agent'
      ? 'Agent'
      : actorType === 'user'
        ? 'You'
        : 'System'
  return { actorType, actorLabel }
}

function appendTaskActivity(
  task: TaskRow,
  {
    actorType,
    actorLabel,
    kind,
    message,
    createdAt = Date.now(),
  }: {
    actorType: string
    actorLabel: string
    kind: string
    message: string
    createdAt?: number
  }
) {
  const activity: TaskActivityRow = {
    id: crypto.randomUUID(),
    task_id: task.id,
    actor_type: actorType,
    actor_label: actorLabel,
    kind,
    message,
    created_at: createdAt,
  }

  insertTaskActivity(activity)
  notifyTaskActivity(task.workspace_id, rowToActivityDto(activity))
  return activity
}

tasks.get('/', (c) => {
  const workspaceId = c.req.query('workspaceId')?.trim()
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  return c.json(getTasks(workspaceId).map(rowToTaskDto))
})

tasks.post('/', async (c) => {
  let body: {
    workspaceId?: string
    title?: string
    description?: string
    workdir?: string | null
  } & ActorPayload

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const workspaceId = body.workspaceId?.trim()
  const title = body.title?.trim()
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400)
  if (!title) return c.json({ error: 'title is required' }, 400)

  const workspace = getWorkspaceById(workspaceId)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)

  const now = Date.now()
  const task: TaskRow = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    title,
    description: body.description?.trim() ?? '',
    status: 'todo',
    workdir: body.workdir?.trim() || null,
    active_session_id: null,
    live_note: '',
    created_at: now,
    updated_at: now,
    resolved_at: null,
  }

  insertTask(task)
  notifyTaskUpsert(task.workspace_id, rowToTaskDto(task))

  const actor = normalizeActor(body)
  appendTaskActivity(task, {
    ...actor,
    kind: 'created',
    message: `Created "${task.title}"`,
    createdAt: now,
  })

  return c.json(rowToTaskDto(task), 201)
})

tasks.get('/:id', (c) => {
  const task = getTaskById(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)
  return c.json(rowToTaskDto(task))
})

tasks.get('/:id/activity', (c) => {
  const task = getTaskById(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)

  const limit = Number(c.req.query('limit') ?? 100)
  return c.json(getTaskActivity(task.id, Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 100).map(rowToActivityDto))
})

tasks.patch('/:id', async (c) => {
  const task = getTaskById(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)

  let body: {
    title?: string
    description?: string
    workdir?: string | null
    liveNote?: string
    activeSessionId?: string | null
  } & ActorPayload

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const title = body.title === undefined ? undefined : body.title.trim()
  if (body.title !== undefined && !title) {
    return c.json({ error: 'title cannot be empty' }, 400)
  }

  const description = body.description === undefined ? undefined : body.description.trim()
  const workdir = body.workdir === undefined ? undefined : body.workdir?.trim() || null
  const liveNote = body.liveNote === undefined ? undefined : body.liveNote.trim()
  const activeSessionId = body.activeSessionId === undefined ? undefined : body.activeSessionId?.trim() || null

  if (
    title === undefined &&
    description === undefined &&
    workdir === undefined &&
    liveNote === undefined &&
    activeSessionId === undefined
  ) {
    return c.json({ error: 'No changes provided' }, 400)
  }

  const now = Date.now()
  updateTask(task.id, {
    title,
    description,
    workdir,
    liveNote,
    activeSessionId,
    updatedAt: now,
  })

  const updated = getTaskById(task.id)!
  notifyTaskUpsert(updated.workspace_id, rowToTaskDto(updated))

  const actor = normalizeActor(body)
  if (liveNote !== undefined && liveNote !== task.live_note) {
    appendTaskActivity(updated, {
      ...actor,
      kind: 'note',
      message: liveNote || 'Cleared the live note',
      createdAt: now,
    })
  }

  if (activeSessionId !== undefined && activeSessionId !== (task.active_session_id ?? null)) {
    appendTaskActivity(updated, {
      ...actor,
      kind: 'session',
      message: activeSessionId
        ? `Linked session ${activeSessionId.slice(0, 8)}`
        : 'Cleared the linked session',
      createdAt: now,
    })
  }

  return c.json(rowToTaskDto(updated))
})

tasks.post('/:id/move', async (c) => {
  const task = getTaskById(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)

  let body: { status?: TaskStatus } & ActorPayload
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const status = normalizeTaskStatus(body.status)
  if (!status) return c.json({ error: 'status must be todo, doing, or done' }, 400)

  const now = Date.now()
  updateTask(task.id, {
    status,
    updatedAt: now,
    resolvedAt: status === 'done' ? now : null,
  })

  const updated = getTaskById(task.id)!
  notifyTaskUpsert(updated.workspace_id, rowToTaskDto(updated))

  const actor = normalizeActor(body)
  appendTaskActivity(updated, {
    ...actor,
    kind: 'status',
    message: `Moved to ${status}`,
    createdAt: now,
  })

  return c.json(rowToTaskDto(updated))
})

tasks.post('/:id/resolve', async (c) => {
  const task = getTaskById(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)

  let body: { note?: string } & ActorPayload
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const note = body.note?.trim()
  const now = Date.now()
  updateTask(task.id, {
    status: 'done',
    liveNote: note === undefined ? task.live_note : note,
    updatedAt: now,
    resolvedAt: now,
  })

  const updated = getTaskById(task.id)!
  notifyTaskUpsert(updated.workspace_id, rowToTaskDto(updated))

  const actor = normalizeActor(body)
  appendTaskActivity(updated, {
    ...actor,
    kind: 'resolved',
    message: note ? `Resolved: ${note}` : 'Marked as done',
    createdAt: now,
  })

  return c.json(rowToTaskDto(updated))
})

tasks.post('/:id/activity', async (c) => {
  const task = getTaskById(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)

  let body: {
    kind?: string
    message?: string
    liveNote?: string
  } & ActorPayload
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const message = body.message?.trim()
  if (!message) return c.json({ error: 'message is required' }, 400)

  const kind = body.kind?.trim() || 'note'
  const actor = normalizeActor(body)
  const now = Date.now()
  const liveNote = body.liveNote === undefined ? undefined : body.liveNote.trim()

  if (liveNote !== undefined) {
    updateTask(task.id, {
      liveNote,
      updatedAt: now,
    })
  } else {
    updateTask(task.id, { updatedAt: now })
  }

  const updated = getTaskById(task.id)!
  notifyTaskUpsert(updated.workspace_id, rowToTaskDto(updated))

  const activity = appendTaskActivity(updated, {
    ...actor,
    kind,
    message,
    createdAt: now,
  })

  return c.json(rowToActivityDto(activity), 201)
})

tasks.delete('/:id', (c) => {
  const task = getTaskById(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)

  deleteTask(task.id)
  notifyTaskDeleted(task.workspace_id, task.id)
  return c.json({ ok: true, id: task.id })
})

function rowToTaskDto(row: TaskRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status,
    workdir: row.workdir ?? null,
    activeSessionId: row.active_session_id ?? null,
    liveNote: row.live_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null,
  }
}

function rowToActivityDto(row: TaskActivityRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
  }
}

export { tasks }
