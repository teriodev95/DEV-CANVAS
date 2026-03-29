import { Database } from 'bun:sqlite'
import path from 'path'

const DB_PATH = process.env.DB_PATH ?? path.join(import.meta.dir, '..', 'devcanvas.db')

let _db: Database | null = null

export function getDb(): Database {
  if (_db) return _db

  _db = new Database(DB_PATH, { create: true })

  // Performance pragmas
  _db.run('PRAGMA journal_mode = WAL;')
  _db.run('PRAGMA synchronous = NORMAL;')
  _db.run('PRAGMA foreign_keys = ON;')
  _db.run('PRAGMA busy_timeout = 5000;')

  // Schema
  _db.run(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      canvas_snapshot TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  _db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'tmux',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_activity INTEGER NOT NULL
    );
  `)

  _db.run(`
    CREATE TABLE IF NOT EXISTS session_output (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `)

  _db.run(`
    CREATE INDEX IF NOT EXISTS idx_output ON session_output(session_id, sequence);
  `)

  return _db
}

// Prepared statement helpers
export function getWorkspaces() {
  return getDb().query('SELECT * FROM workspaces ORDER BY created_at DESC').all() as WorkspaceRow[]
}

export function getWorkspaceById(id: string) {
  return getDb().query('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | null
}

export function insertWorkspace(workspace: WorkspaceRow) {
  return getDb()
    .query(
      'INSERT INTO workspaces (id, name, canvas_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(workspace.id, workspace.name, workspace.canvas_snapshot, workspace.created_at, workspace.updated_at)
}

export function updateWorkspaceName(id: string, name: string, updatedAt: number) {
  return getDb()
    .query('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, updatedAt, id)
}

export function updateCanvasSnapshot(id: string, snapshot: string, updatedAt: number) {
  return getDb()
    .query('UPDATE workspaces SET canvas_snapshot = ?, updated_at = ? WHERE id = ?')
    .run(snapshot, updatedAt, id)
}

export function getSessions(workspaceId?: string) {
  if (workspaceId) {
    return getDb()
      .query('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as SessionRow[]
  }
  return getDb().query('SELECT * FROM sessions ORDER BY created_at DESC').all() as SessionRow[]
}

export function getSessionById(id: string) {
  return getDb().query('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | null
}

export function insertSession(session: SessionRow) {
  return getDb()
    .query(
      'INSERT INTO sessions (id, workspace_id, name, type, status, created_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      session.id,
      session.workspace_id,
      session.name,
      session.type,
      session.status,
      session.created_at,
      session.last_activity
    )
}

export function updateSessionStatus(id: string, status: string, lastActivity: number) {
  return getDb()
    .query('UPDATE sessions SET status = ?, last_activity = ? WHERE id = ?')
    .run(status, lastActivity, id)
}

export function updateSessionActivity(id: string, lastActivity: number) {
  return getDb()
    .query('UPDATE sessions SET last_activity = ? WHERE id = ?')
    .run(lastActivity, id)
}

export function deleteSession(id: string) {
  getDb().query('DELETE FROM session_output WHERE session_id = ?').run(id)
  return getDb().query('DELETE FROM sessions WHERE id = ?').run(id)
}

export function insertSessionOutput(sessionId: string, sequence: number, data: string, timestamp: number) {
  return getDb()
    .query('INSERT INTO session_output (session_id, sequence, data, timestamp) VALUES (?, ?, ?, ?)')
    .run(sessionId, sequence, data, timestamp)
}

export function getSessionOutput(sessionId: string, fromSequence = 0) {
  return getDb()
    .query(
      'SELECT * FROM session_output WHERE session_id = ? AND sequence >= ? ORDER BY sequence ASC'
    )
    .all(sessionId, fromSequence) as SessionOutputRow[]
}

export function getNextSequence(sessionId: string): number {
  const row = getDb()
    .query('SELECT MAX(sequence) as max_seq FROM session_output WHERE session_id = ?')
    .get(sessionId) as { max_seq: number | null }
  return (row?.max_seq ?? 0) + 1
}

// Row types
export interface WorkspaceRow {
  id: string
  name: string
  canvas_snapshot: string
  created_at: number
  updated_at: number
}

export interface SessionRow {
  id: string
  workspace_id: string
  name: string
  type: string
  status: string
  created_at: number
  last_activity: number
}

export interface SessionOutputRow {
  id: number
  session_id: string
  sequence: number
  data: string
  timestamp: number
}
