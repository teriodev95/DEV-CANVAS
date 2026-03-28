export interface SessionInfo {
  id: string
  workspaceId: string
  name: string
  type: 'tmux' | 'pty'
  status: string
  createdAt: number
  lastActivity: number
}

export type WSMessage =
  | { type: 'session:create'; id: string; name: string; workspaceId: string; sessionType?: 'tmux' | 'pty' }
  | { type: 'session:created'; id: string; sessionId: string; name: string }
  | { type: 'session:subscribe'; id: string; sessionId: string; fromSequence?: number }
  | { type: 'session:list'; id: string; workspaceId: string }
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
  | { type: 'terminal:output'; sessionId: string; data: string; sequence: number; timestamp: number }
  | { type: 'pong'; id: string }
  | { type: 'error'; id?: string; code: string; message: string }
