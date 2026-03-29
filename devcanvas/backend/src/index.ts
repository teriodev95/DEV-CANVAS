import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { getDb, insertWorkspace, getWorkspaces, insertSession, getSessions } from './db'
import { workspaces } from './routes/workspaces'
import { sessions } from './routes/sessions'
import { wsHandler, type WsData } from './ws/handler'
import { isTmuxAvailable, listSessions as tmuxListSessions, createSession as tmuxCreateSession } from './services/tmux'
import { tmuxControl } from './services/tmux-control'

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = new Hono()

// CORS — allow local and Tailscale origins
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*'
      // Allow localhost and any Tailscale 100.x.x.x IP
      if (origin.includes('localhost') || origin.match(/^https?:\/\/100\.\d+\.\d+\.\d+/)) {
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
      const dbSessionNames = new Set(dbSessions.map((s) => s.name))

      // Find a workspace to attach orphaned sessions to
      const defaultWorkspace = getWorkspaces()[0]
      if (!defaultWorkspace) throw new Error('No workspace found after creation')

      for (const tmuxName of liveTmuxSessions) {
        if (!dbSessionNames.has(tmuxName)) {
          console.log(`[startup] Restoring orphaned tmux session: ${tmuxName}`)
          const now = Date.now()
          insertSession({
            id: crypto.randomUUID(),
            workspace_id: defaultWorkspace.id,
            name: tmuxName,
            type: 'tmux',
            status: 'active',
            created_at: now,
            last_activity: now,
          })
        }
      }

      // Mark DB sessions as inactive if their tmux session no longer exists
      const liveTmuxSet = new Set(liveTmuxSessions)
      for (const session of dbSessions) {
        if (session.type === 'tmux' && session.status === 'active' && !liveTmuxSet.has(session.name)) {
          console.log(`[startup] Marking stale session as inactive: ${session.name}`)
          const { updateSessionStatus } = await import('./db')
          updateSessionStatus(session.id, 'inactive', Date.now())
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

const PORT = Number(process.env.PORT ?? 3001)

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
