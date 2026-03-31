const BASE = process.env.DEVCANVAS_API_URL ?? 'http://localhost:39471';
const API = `${BASE}/api`;

const HEADERS = { 'Content-Type': 'application/json' };
const ACTOR = { actorType: 'agent', actorLabel: 'Claude' };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? res.statusText;
    throw new Error(`${res.status}: ${msg}`);
  }
  return body as T;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'doing' | 'done';

export type Task = {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: TaskStatus;
  workdir: string | null;
  activeSessionId: string | null;
  liveNote: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
};

export type TaskActivity = {
  id: string;
  taskId: string;
  actorType: string;
  actorLabel: string;
  kind: string;
  message: string;
  createdAt: number;
};

export type Workspace = {
  id: string;
  name: string;
  settings: unknown;
  createdAt: number;
  updatedAt: number;
  sessionCount: number;
};

export type Session = {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  createdAt: number;
};

// ─── Workspaces ─────────────────────────────────────────────────────────────

export function listWorkspaces() {
  return request<Workspace[]>(`${API}/workspaces`);
}

export function getWorkspace(id: string) {
  return request<Workspace>(`${API}/workspaces/${id}`);
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export function listSessions(workspaceId: string) {
  return request<Session[]>(`${API}/sessions?workspaceId=${encodeURIComponent(workspaceId)}`);
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export function listTasks(workspaceId: string) {
  return request<Task[]>(`${API}/tasks?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getTask(id: string) {
  return request<Task>(`${API}/tasks/${id}`);
}

export function createTask(workspaceId: string, title: string, description?: string, workdir?: string) {
  return request<Task>(`${API}/tasks`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      workspaceId,
      title,
      description: description ?? '',
      workdir: workdir ?? null,
      ...ACTOR,
    }),
  });
}

export function updateTask(
  id: string,
  fields: {
    title?: string;
    description?: string;
    workdir?: string | null;
    liveNote?: string;
  }
) {
  return request<Task>(`${API}/tasks/${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ ...fields, ...ACTOR }),
  });
}

export function moveTask(id: string, status: TaskStatus) {
  return request<Task>(`${API}/tasks/${id}/move`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ status, ...ACTOR }),
  });
}

export function resolveTask(id: string, note?: string) {
  return request<Task>(`${API}/tasks/${id}/resolve`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ note: note ?? '', ...ACTOR }),
  });
}

export function deleteTask(id: string) {
  return request<{ ok: boolean; id: string }>(`${API}/tasks/${id}`, {
    method: 'DELETE',
  });
}

export function addTaskActivity(id: string, message: string) {
  return request<TaskActivity>(`${API}/tasks/${id}/activity`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ message, kind: 'note', liveNote: message, ...ACTOR }),
  });
}

export function getTaskActivity(id: string, limit = 30) {
  return request<TaskActivity[]>(`${API}/tasks/${id}/activity?limit=${limit}`);
}

// ─── Health ─────────────────────────────────────────────────────────────────

export function healthCheck() {
  return request<{ ok: boolean; tmux: boolean; timestamp: number }>(`${BASE}/health`);
}
