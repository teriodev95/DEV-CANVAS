export interface SessionInfo {
  id: string
  workspaceId: string
  name: string
  type: 'tmux' | 'pty' | 'ssh'
  status: string
  createdAt: number
  lastActivity: number
  workingDir?: string | null
}

export interface TaskInfo {
  id: string
  workspaceId: string
  title: string
  description: string
  status: 'todo' | 'doing' | 'done'
  workdir?: string | null
  activeSessionId?: string | null
  liveNote: string
  createdAt: number
  updatedAt: number
  resolvedAt?: number | null
}

export interface TaskActivityInfo {
  id: string
  taskId: string
  actorType: string
  actorLabel: string
  kind: string
  message: string
  createdAt: number
}

export type WSMessage =
  | { type: 'session:create'; id: string; name: string; workspaceId: string; sessionType?: 'tmux' | 'pty' | 'ssh'; sshConfig?: { host: string; user: string; port?: number } }
  | { type: 'session:created'; id: string; sessionId: string; name: string }
  | { type: 'session:subscribe'; id: string; sessionId: string; fromSequence?: number }
  | { type: 'session:list'; id: string; workspaceId: string }
  | { type: 'tasks:subscribe'; id: string; workspaceId: string }
  | { type: 'tasks:unsubscribe'; id: string; workspaceId: string }
  | { type: 'session:list:response'; id: string; sessions: SessionInfo[] }
  | { type: 'terminal:input'; id: string; sessionId: string; data: string }
  | { type: 'terminal:output'; sessionId: string; data: string; sequence: number; timestamp: number }
  | { type: 'terminal:resize'; id: string; sessionId: string; cols: number; rows: number }
  | { type: 'ping'; id: string }
  | { type: 'pong'; id: string }
  | { type: 'error'; id?: string; code: string; message: string }

export type ServerMessage =
  | { type: 'session:created'; id: string; sessionId: string; name: string }
  | { type: 'session:list:response'; id: string; sessions: SessionInfo[] }
  | { type: 'tasks:subscribed'; id: string; workspaceId: string }
  | { type: 'task:upsert'; workspaceId: string; task: TaskInfo }
  | { type: 'task:delete'; workspaceId: string; taskId: string }
  | { type: 'task:activity'; workspaceId: string; activity: TaskActivityInfo }
  | { type: 'session:ready'; id?: string; sessionId: string }
  | { type: 'session:cwd'; sessionId: string; workingDir: string }
  | { type: 'terminal:output'; sessionId: string; data: string; sequence: number; timestamp: number }
  | { type: 'pong'; id: string }
  | { type: 'error'; id?: string; code: string; message: string }
