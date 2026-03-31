import { Database } from 'bun:sqlite'
import path from 'path'
import { mkdirSync } from 'fs'

function getDefaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH
  // Use platform-appropriate data directory
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.'
  const dataDir = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'DevCanvas')
    : path.join(home, '.devcanvas')
  mkdirSync(dataDir, { recursive: true })
  return path.join(dataDir, 'devcanvas.db')
}

const DB_PATH = getDefaultDbPath()

let _db: Database | null = null

export interface WorkspaceSettings {
  appearance: {
    icon: 'terminal' | 'folder' | 'grid' | 'layers'
    color: '' | 'indigo' | 'blue' | 'emerald' | 'amber' | 'rose' | 'sky'
  }
  terminalDefaults: {
    themeId: 'default-dark' | 'onedarkpro' | 'rosepine'
    fontFamily: 'sfmono' | 'jetbrains' | 'menlo'
    fontSize: number
  }
}

export interface SessionAppearance {
  icon?: '' | 'git' | 'node' | 'py' | 'db' | 'dock' | 'proc' | 'brain' | 'code' | 'tool' | null
  color?: '' | 'indigo' | 'blue' | 'emerald' | 'amber' | 'rose' | 'sky' | null
  themeId?: 'default-dark' | 'onedarkpro' | 'rosepine' | null
  fontFamily?: 'sfmono' | 'jetbrains' | 'menlo' | null
  fontSize?: number | null
}

export type TaskStatus = 'todo' | 'doing' | 'done'

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  appearance: {
    icon: 'terminal',
    color: '',
  },
  terminalDefaults: {
    themeId: 'default-dark',
    fontFamily: 'sfmono',
    fontSize: 13,
  },
}

function ensureColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((info) => info.name === column)) return
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function clampFontSize(value: number | null | undefined): number {
  const next = Math.round(Number(value ?? DEFAULT_WORKSPACE_SETTINGS.terminalDefaults.fontSize))
  return Math.min(Math.max(next, 11), 18)
}

function parseJsonValue<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function normalizeWorkspaceSettings(input: unknown): WorkspaceSettings {
  if (!input || typeof input !== 'object') return DEFAULT_WORKSPACE_SETTINGS
  const candidate = input as Partial<WorkspaceSettings>
  return {
    appearance: {
      icon: candidate.appearance?.icon && ['terminal', 'folder', 'grid', 'layers'].includes(candidate.appearance.icon)
        ? candidate.appearance.icon
        : DEFAULT_WORKSPACE_SETTINGS.appearance.icon,
      color: candidate.appearance?.color && ['', 'indigo', 'blue', 'emerald', 'amber', 'rose', 'sky'].includes(candidate.appearance.color)
        ? candidate.appearance.color
        : DEFAULT_WORKSPACE_SETTINGS.appearance.color,
    },
    terminalDefaults: {
      themeId: candidate.terminalDefaults?.themeId && ['default-dark', 'onedarkpro', 'rosepine'].includes(candidate.terminalDefaults.themeId)
        ? candidate.terminalDefaults.themeId
        : DEFAULT_WORKSPACE_SETTINGS.terminalDefaults.themeId,
      fontFamily: candidate.terminalDefaults?.fontFamily && ['sfmono', 'jetbrains', 'menlo'].includes(candidate.terminalDefaults.fontFamily)
        ? candidate.terminalDefaults.fontFamily
        : DEFAULT_WORKSPACE_SETTINGS.terminalDefaults.fontFamily,
      fontSize: clampFontSize(candidate.terminalDefaults?.fontSize),
    },
  }
}

export function normalizeSessionAppearance(input: unknown): SessionAppearance {
  if (!input || typeof input !== 'object') return {}
  const candidate = input as SessionAppearance
  const next: SessionAppearance = {}
  if (candidate.icon == null || ['', 'git', 'node', 'py', 'db', 'dock', 'proc', 'brain', 'code', 'tool'].includes(candidate.icon)) {
    next.icon = candidate.icon
  }
  if (candidate.color == null || ['', 'indigo', 'blue', 'emerald', 'amber', 'rose', 'sky'].includes(candidate.color)) {
    next.color = candidate.color
  }
  if (candidate.themeId == null || ['default-dark', 'onedarkpro', 'rosepine'].includes(candidate.themeId)) {
    next.themeId = candidate.themeId
  }
  if (candidate.fontFamily == null || ['sfmono', 'jetbrains', 'menlo'].includes(candidate.fontFamily)) {
    next.fontFamily = candidate.fontFamily
  }
  if (candidate.fontSize != null) {
    next.fontSize = clampFontSize(candidate.fontSize)
  }
  return next
}

export function serializeWorkspaceSettings(settings: unknown): string {
  return JSON.stringify(normalizeWorkspaceSettings(settings))
}

export function serializeSessionAppearance(appearance: unknown): string {
  return JSON.stringify(normalizeSessionAppearance(appearance))
}

export function getDefaultWorkspaceSettings(): WorkspaceSettings {
  return DEFAULT_WORKSPACE_SETTINGS
}

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
      settings_json TEXT DEFAULT '{}',
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
      last_activity INTEGER NOT NULL,
      ssh_lookup TEXT,
      ssh_host TEXT,
      ssh_user TEXT,
      ssh_port INTEGER,
      ssh_identity_file TEXT,
      ssh_durable INTEGER NOT NULL DEFAULT 0,
      ssh_remote_session TEXT,
      working_dir TEXT,
      appearance_json TEXT DEFAULT '{}'
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

  _db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      workdir TEXT,
      active_session_id TEXT,
      live_note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
  `)

  _db.run(`
    CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status_updated
    ON tasks(workspace_id, status, updated_at DESC);
  `)

  _db.run(`
    CREATE TABLE IF NOT EXISTS task_activity (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'system',
      actor_label TEXT NOT NULL DEFAULT 'System',
      kind TEXT NOT NULL DEFAULT 'note',
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)

  _db.run(`
    CREATE INDEX IF NOT EXISTS idx_task_activity_task_created
    ON task_activity(task_id, created_at DESC);
  `)

  ensureColumn(_db, 'workspaces', 'settings_json', `TEXT DEFAULT '${JSON.stringify(DEFAULT_WORKSPACE_SETTINGS)}'`)
  ensureColumn(_db, 'sessions', 'ssh_lookup', 'TEXT')
  ensureColumn(_db, 'sessions', 'ssh_host', 'TEXT')
  ensureColumn(_db, 'sessions', 'ssh_user', 'TEXT')
  ensureColumn(_db, 'sessions', 'ssh_port', 'INTEGER')
  ensureColumn(_db, 'sessions', 'ssh_identity_file', 'TEXT')
  ensureColumn(_db, 'sessions', 'ssh_durable', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(_db, 'sessions', 'ssh_remote_session', 'TEXT')
  ensureColumn(_db, 'sessions', 'working_dir', 'TEXT')
  ensureColumn(_db, 'sessions', 'appearance_json', `TEXT DEFAULT '{}'`)
  ensureColumn(_db, 'tasks', 'description', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(_db, 'tasks', 'status', `TEXT NOT NULL DEFAULT 'todo'`)
  ensureColumn(_db, 'tasks', 'workdir', 'TEXT')
  ensureColumn(_db, 'tasks', 'active_session_id', 'TEXT')
  ensureColumn(_db, 'tasks', 'live_note', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(_db, 'tasks', 'resolved_at', 'INTEGER')

  return _db
}

// Prepared statement helpers
export function getWorkspaces() {
  return getDb().query(`
    SELECT
      workspaces.*,
      COUNT(sessions.id) AS session_count
    FROM workspaces
    LEFT JOIN sessions ON sessions.workspace_id = workspaces.id
    GROUP BY workspaces.id
    ORDER BY workspaces.created_at DESC
  `).all() as WorkspaceRow[]
}

export function getWorkspaceById(id: string) {
  return getDb().query('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | null
}

export function insertWorkspace(workspace: WorkspaceRow) {
  return getDb()
    .query(
      'INSERT INTO workspaces (id, name, canvas_snapshot, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      workspace.id,
      workspace.name,
      workspace.canvas_snapshot,
      workspace.settings_json ?? serializeWorkspaceSettings(DEFAULT_WORKSPACE_SETTINGS),
      workspace.created_at,
      workspace.updated_at
    )
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

export function updateWorkspaceSettings(id: string, settingsJson: string, updatedAt: number) {
  return getDb()
    .query('UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?')
    .run(settingsJson, updatedAt, id)
}

export function deleteWorkspaceCascade(id: string): string[] {
  const db = getDb()
  const tx = db.transaction((workspaceId: string) => {
    const sessionRows = db
      .query('SELECT id FROM sessions WHERE workspace_id = ?')
      .all(workspaceId) as Array<{ id: string }>
    const taskRows = db
      .query('SELECT id FROM tasks WHERE workspace_id = ?')
      .all(workspaceId) as Array<{ id: string }>

    for (const row of sessionRows) {
      db.query('DELETE FROM session_output WHERE session_id = ?').run(row.id)
    }
    for (const row of taskRows) {
      db.query('DELETE FROM task_activity WHERE task_id = ?').run(row.id)
    }

    db.query('DELETE FROM sessions WHERE workspace_id = ?').run(workspaceId)
    db.query('DELETE FROM tasks WHERE workspace_id = ?').run(workspaceId)
    db.query('DELETE FROM workspaces WHERE id = ?').run(workspaceId)

    return sessionRows.map((row) => row.id)
  })

  return tx(id) as string[]
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
      `INSERT INTO sessions (
        id, workspace_id, name, type, status, created_at, last_activity,
        ssh_lookup, ssh_host, ssh_user, ssh_port, ssh_identity_file, ssh_durable, ssh_remote_session,
        working_dir,
        appearance_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      session.id,
      session.workspace_id,
      session.name,
      session.type,
      session.status,
      session.created_at,
      session.last_activity,
      session.ssh_lookup ?? null,
      session.ssh_host ?? null,
      session.ssh_user ?? null,
      session.ssh_port ?? null,
      session.ssh_identity_file ?? null,
      session.ssh_durable ? 1 : 0,
      session.ssh_remote_session ?? null,
      session.working_dir ?? null,
      session.appearance_json ?? serializeSessionAppearance({})
    )
}

export function updateSessionSettings(id: string, values: { name?: string, appearanceJson?: string, lastActivity?: number }) {
  const fields: string[] = []
  const params: Array<string | number | null> = []

  if (values.name !== undefined) {
    fields.push('name = ?')
    params.push(values.name)
  }
  if (values.appearanceJson !== undefined) {
    fields.push('appearance_json = ?')
    params.push(values.appearanceJson)
  }
  if (values.lastActivity !== undefined) {
    fields.push('last_activity = ?')
    params.push(values.lastActivity)
  }
  if (fields.length === 0) return

  params.push(id)
  return getDb()
    .query(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`)
    .run(...params)
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

export function updateSessionWorkingDir(id: string, workingDir: string, lastActivity?: number) {
  if (lastActivity === undefined) {
    return getDb()
      .query('UPDATE sessions SET working_dir = ? WHERE id = ?')
      .run(workingDir, id)
  }

  return getDb()
    .query('UPDATE sessions SET working_dir = ?, last_activity = ? WHERE id = ?')
    .run(workingDir, lastActivity, id)
}

export function deleteSession(id: string) {
  getDb().query('DELETE FROM session_output WHERE session_id = ?').run(id)
  return getDb().query('DELETE FROM sessions WHERE id = ?').run(id)
}

export function getTasks(workspaceId: string) {
  return getDb()
    .query('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC, created_at DESC')
    .all(workspaceId) as TaskRow[]
}

export function getTaskById(id: string) {
  return getDb().query('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | null
}

export function getTasksByActiveSession(sessionId: string) {
  return getDb()
    .query('SELECT * FROM tasks WHERE active_session_id = ? ORDER BY updated_at DESC')
    .all(sessionId) as TaskRow[]
}

export function insertTask(task: TaskRow) {
  return getDb()
    .query(`
      INSERT INTO tasks (
        id, workspace_id, title, description, status, workdir, active_session_id, live_note,
        created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      task.id,
      task.workspace_id,
      task.title,
      task.description,
      task.status,
      task.workdir ?? null,
      task.active_session_id ?? null,
      task.live_note,
      task.created_at,
      task.updated_at,
      task.resolved_at ?? null
    )
}

export function updateTask(
  id: string,
  values: {
    title?: string
    description?: string
    status?: TaskStatus
    workdir?: string | null
    activeSessionId?: string | null
    liveNote?: string
    updatedAt: number
    resolvedAt?: number | null
  }
) {
  const fields: string[] = ['updated_at = ?']
  const params: Array<string | number | null> = [values.updatedAt]

  if (values.title !== undefined) {
    fields.push('title = ?')
    params.push(values.title)
  }
  if (values.description !== undefined) {
    fields.push('description = ?')
    params.push(values.description)
  }
  if (values.status !== undefined) {
    fields.push('status = ?')
    params.push(values.status)
  }
  if (values.workdir !== undefined) {
    fields.push('workdir = ?')
    params.push(values.workdir)
  }
  if (values.activeSessionId !== undefined) {
    fields.push('active_session_id = ?')
    params.push(values.activeSessionId)
  }
  if (values.liveNote !== undefined) {
    fields.push('live_note = ?')
    params.push(values.liveNote)
  }
  if (values.resolvedAt !== undefined) {
    fields.push('resolved_at = ?')
    params.push(values.resolvedAt)
  }

  params.push(id)
  return getDb()
    .query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`)
    .run(...params)
}

export function deleteTask(id: string) {
  getDb().query('DELETE FROM task_activity WHERE task_id = ?').run(id)
  return getDb().query('DELETE FROM tasks WHERE id = ?').run(id)
}

export function clearTaskActiveSession(sessionId: string, updatedAt: number) {
  return getDb()
    .query('UPDATE tasks SET active_session_id = NULL, updated_at = ? WHERE active_session_id = ?')
    .run(updatedAt, sessionId)
}

export function getTaskActivity(taskId: string, limit = 100) {
  return getDb()
    .query(`
      SELECT * FROM task_activity
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(taskId, limit) as TaskActivityRow[]
}

export function insertTaskActivity(activity: TaskActivityRow) {
  return getDb()
    .query(`
      INSERT INTO task_activity (
        id, task_id, actor_type, actor_label, kind, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      activity.id,
      activity.task_id,
      activity.actor_type,
      activity.actor_label,
      activity.kind,
      activity.message,
      activity.created_at
    )
}

export function insertSessionOutput(sessionId: string, sequence: number, data: string, timestamp: number) {
  return getDb()
    .query('INSERT INTO session_output (session_id, sequence, data, timestamp) VALUES (?, ?, ?, ?)')
    .run(sessionId, sequence, data, timestamp)
}

export function hasSessionOutput(sessionId: string): boolean {
  const row = getDb()
    .query('SELECT 1 as present FROM session_output WHERE session_id = ? LIMIT 1')
    .get(sessionId) as { present?: number } | null
  return Boolean(row?.present)
}

export function clearSessionOutput(sessionId: string) {
  return getDb().query('DELETE FROM session_output WHERE session_id = ?').run(sessionId)
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
  settings_json?: string
  created_at: number
  updated_at: number
  session_count?: number
}

export interface SessionRow {
  id: string
  workspace_id: string
  name: string
  type: string
  status: string
  created_at: number
  last_activity: number
  ssh_lookup?: string | null
  ssh_host?: string | null
  ssh_user?: string | null
  ssh_port?: number | null
  ssh_identity_file?: string | null
  ssh_durable?: number | boolean | null
  ssh_remote_session?: string | null
  working_dir?: string | null
  appearance_json?: string | null
}

export interface SessionOutputRow {
  id: number
  session_id: string
  sequence: number
  data: string
  timestamp: number
}

export interface TaskRow {
  id: string
  workspace_id: string
  title: string
  description: string
  status: TaskStatus
  workdir?: string | null
  active_session_id?: string | null
  live_note: string
  created_at: number
  updated_at: number
  resolved_at?: number | null
}

export interface TaskActivityRow {
  id: string
  task_id: string
  actor_type: string
  actor_label: string
  kind: string
  message: string
  created_at: number
}
