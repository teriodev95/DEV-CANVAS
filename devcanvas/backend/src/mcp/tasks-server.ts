import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const API_ORIGIN = process.env.DEVCANVAS_API_ORIGIN?.trim() || 'http://localhost:39471/api'
const DEFAULT_ACTOR_TYPE = process.env.DEVCANVAS_MCP_ACTOR_TYPE?.trim() || 'agent'
const DEFAULT_ACTOR_LABEL = process.env.DEVCANVAS_MCP_ACTOR_LABEL?.trim() || 'Codex'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const server = new Server(
  {
    name: 'devcanvas-tasks',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

function withDefaultActor(input: Record<string, unknown>) {
  return {
    ...input,
    actorType: typeof input.actorType === 'string' && input.actorType.trim()
      ? input.actorType.trim()
      : DEFAULT_ACTOR_TYPE,
    actorLabel: typeof input.actorLabel === 'string' && input.actorLabel.trim()
      ? input.actorLabel.trim()
      : DEFAULT_ACTOR_LABEL,
  }
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (value == null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed || null
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_ORIGIN}${path}`, init)
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text()

  if (!response.ok) {
    const message = typeof payload === 'string'
      ? payload
      : (payload as { error?: string; message?: string })?.error ||
        (payload as { error?: string; message?: string })?.message ||
        `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return payload as JsonValue
}

function jsonContent(payload: JsonValue) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_tasks',
      description: 'List all tasks for a DevCanvas workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Workspace id' },
        },
        required: ['workspaceId'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_task',
      description: 'Read one task and its current status.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task id' },
        },
        required: ['taskId'],
        additionalProperties: false,
      },
    },
    {
      name: 'create_task',
      description: 'Create a new task in a workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          workdir: { type: 'string' },
          actorType: { type: 'string' },
          actorLabel: { type: 'string' },
        },
        required: ['workspaceId', 'title'],
        additionalProperties: false,
      },
    },
    {
      name: 'update_task',
      description: 'Update title, description, workdir, live note, or linked session for a task.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          workdir: { type: 'string' },
          liveNote: { type: 'string' },
          activeSessionId: { type: 'string' },
          actorType: { type: 'string' },
          actorLabel: { type: 'string' },
        },
        required: ['taskId'],
        additionalProperties: false,
      },
    },
    {
      name: 'move_task',
      description: 'Move a task between todo, doing, and done.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'doing', 'done'] },
          actorType: { type: 'string' },
          actorLabel: { type: 'string' },
        },
        required: ['taskId', 'status'],
        additionalProperties: false,
      },
    },
    {
      name: 'resolve_task',
      description: 'Mark a task as done and optionally attach a final note.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          note: { type: 'string' },
          actorType: { type: 'string' },
          actorLabel: { type: 'string' },
        },
        required: ['taskId'],
        additionalProperties: false,
      },
    },
    {
      name: 'add_task_activity',
      description: 'Append a timeline update to a task and optionally refresh its live note.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          message: { type: 'string' },
          kind: { type: 'string' },
          liveNote: { type: 'string' },
          actorType: { type: 'string' },
          actorLabel: { type: 'string' },
        },
        required: ['taskId', 'message'],
        additionalProperties: false,
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (requestMessage) => {
  const input = (requestMessage.params.arguments ?? {}) as Record<string, unknown>

  switch (requestMessage.params.name) {
    case 'list_tasks':
      return jsonContent(await request(`/tasks?workspaceId=${encodeURIComponent(requireString(input, 'workspaceId'))}`))

    case 'get_task': {
      const taskId = requireString(input, 'taskId')
      const task = await request(`/tasks/${encodeURIComponent(taskId)}`)
      const activity = await request(`/tasks/${encodeURIComponent(taskId)}/activity?limit=25`)
      return jsonContent({ task, activity })
    }

    case 'create_task': {
      const payload = withDefaultActor({
        workspaceId: requireString(input, 'workspaceId'),
        title: requireString(input, 'title'),
        description: optionalString(input, 'description') ?? '',
        workdir: optionalString(input, 'workdir'),
      })
      return jsonContent(await request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }))
    }

    case 'update_task': {
      const taskId = requireString(input, 'taskId')
      const payload = withDefaultActor({
        title: optionalString(input, 'title') ?? undefined,
        description: optionalString(input, 'description') ?? undefined,
        workdir: optionalString(input, 'workdir') ?? undefined,
        liveNote: optionalString(input, 'liveNote') ?? undefined,
        activeSessionId: optionalString(input, 'activeSessionId') ?? undefined,
      })
      return jsonContent(await request(`/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }))
    }

    case 'move_task': {
      const taskId = requireString(input, 'taskId')
      const payload = withDefaultActor({
        status: requireString(input, 'status'),
      })
      return jsonContent(await request(`/tasks/${encodeURIComponent(taskId)}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }))
    }

    case 'resolve_task': {
      const taskId = requireString(input, 'taskId')
      const payload = withDefaultActor({
        note: optionalString(input, 'note') ?? undefined,
      })
      return jsonContent(await request(`/tasks/${encodeURIComponent(taskId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }))
    }

    case 'add_task_activity': {
      const taskId = requireString(input, 'taskId')
      const payload = withDefaultActor({
        message: requireString(input, 'message'),
        kind: optionalString(input, 'kind') ?? undefined,
        liveNote: optionalString(input, 'liveNote') ?? undefined,
      })
      return jsonContent(await request(`/tasks/${encodeURIComponent(taskId)}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }))
    }

    default:
      throw new Error(`Unknown tool: ${requestMessage.params.name}`)
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
