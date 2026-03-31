import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import {
  getDb,
  getDefaultWorkspaceSettings,
  insertWorkspace,
  getWorkspaces,
  getSessions,
  serializeWorkspaceSettings,
  updateSessionStatus,
  updateSessionWorkingDir,
} from './db'
import { workspaces } from './routes/workspaces'
import { sessions } from './routes/sessions'
import { connections } from './routes/connections'
import { wsHandler, type WsData } from './ws/handler'
import {
  isTmuxAvailable,
  listSessions as tmuxListSessions,
  getSessionWorkingDirectory as getTmuxWorkingDirectory,
} from './services/tmux'
import { tmuxControl } from './services/tmux-control'

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new Hono()

// CORS — allow all local origins (localhost, 127.0.0.1, tauri.localhost)
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*'
      // Allow any localhost variant or loopback IP
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.startsWith('tauri://')
      ) {
        return origin
      }
      return null
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
)

// Request logging (dev-friendly)
if (process.env.NODE_ENV !== 'test') {
  app.use('*', logger())
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', async (c) => {
  const tmux = await isTmuxAvailable()
  return c.json({ ok: true, tmux, timestamp: Date.now() })
})

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.route('/api/workspaces', workspaces)
app.route('/api/sessions', sessions)
app.route('/api/connections', connections)

// 404 fallback for unmatched API routes
app.notFound((c) => {
  return c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404)
})

// Global error handler
app.onError((err, c) => {
  console.error('[app] Unhandled error:', err)
  return c.json({ error: 'Internal server error', message: err.message }, 500)
})

// ---------------------------------------------------------------------------
// Startup: initialize DB and restore state
// ---------------------------------------------------------------------------

async function startup() {
  // Ensure DB is initialized (tables created)
  getDb()

  // Start persistent tmux control-mode client (low-latency keystroke delivery)
  const tmuxAvailableEarly = await isTmuxAvailable()
  if (tmuxAvailableEarly) {
    tmuxControl.start().catch((err) =>
      console.warn('[startup] tmux control client failed to start:', err)
    )
  }

  // Create a default workspace if none exists
  const existingWorkspaces = getWorkspaces()
  if (existingWorkspaces.length === 0) {
    const now = Date.now()
    const defaultWorkspace = {
      id: crypto.randomUUID(),
      name: 'Default Workspace',
      canvas_snapshot: '{}',
      settings_json: serializeWorkspaceSettings(getDefaultWorkspaceSettings()),
      created_at: now,
      updated_at: now,
    }
    insertWorkspace(defaultWorkspace)
    console.log(`[startup] Created default workspace: ${defaultWorkspace.id}`)
  }

  // Scan existing tmux sessions and restore any missing from DB
  const tmuxAvailable = await isTmuxAvailable()
  if (tmuxAvailable) {
    try {
      const liveTmuxSessions = await tmuxListSessions()
      const dbSessions = getSessions()

      // Mark DB sessions as inactive if their tmux session no longer exists
      const liveTmuxSet = new Set(liveTmuxSessions)
      for (const session of dbSessions) {
        if (session.type !== 'tmux') continue

        if (liveTmuxSet.has(session.name) && session.status !== 'active') {
          console.log(`[startup] Restoring live tmux session as active: ${session.name}`)
          updateSessionStatus(session.id, 'active', Date.now())
        }

        if (session.status === 'active' && !liveTmuxSet.has(session.name)) {
          console.log(`[startup] Marking stale session as inactive: ${session.name}`)
          updateSessionStatus(session.id, 'inactive', Date.now())
          continue
        }

        if (liveTmuxSet.has(session.name)) {
          const workingDir = await getTmuxWorkingDirectory(session.name)
          if (workingDir) {
            updateSessionWorkingDir(session.id, workingDir, Date.now())
          }
        }
      }
    } catch (err) {
      console.warn('[startup] Failed to restore tmux sessions:', err)
    }
  } else {
    console.warn('[startup] tmux is not available — tmux session features will be disabled')
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 39471)

// Run startup tasks, then start the server
startup()
  .then(() => {
    const server = Bun.serve<WsData>({
      port: PORT,

      fetch(req, server) {
        // Upgrade WebSocket connections
        if (req.url.endsWith('/ws') || new URL(req.url).pathname === '/ws') {
          const clientId = crypto.randomUUID()
          const upgraded = server.upgrade(req, { data: { clientId } })
          if (upgraded) return undefined
          return new Response('WebSocket upgrade failed', { status: 400 })
        }

        // Delegate all other requests to Hono
        return app.fetch(req)
      },

      websocket: wsHandler,
    })

    console.log(`DevCanvas backend running on http://localhost:${PORT}`)
    console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`)
  })
  .catch((err) => {
    console.error('[startup] Fatal error:', err)
    process.exit(1)
  })
