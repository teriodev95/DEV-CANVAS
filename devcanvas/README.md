# DevCanvas

A visual terminal workspace — tmux sessions, PTY shells, and SSH connections arranged on an infinite canvas.

Built with **SvelteKit + Svelte 5**, **Bun/Hono** backend, and **Tauri v2** for the desktop app.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust + Cargo | 1.77+ | https://rustup.rs |
| Bun | 1.3+ | `curl -fsSL https://bun.sh/install \| bash` |
| Node.js + npm | 18+ | https://nodejs.org |
| tmux | any | `brew install tmux` |
| Xcode CLI tools | (macOS only) | `xcode-select --install` |

---

## Running in development (web only)

```bash
# Terminal 1 — backend
cd backend
bun install
bun run dev        # http://localhost:3001

# Terminal 2 — frontend
cd frontend
npm install
npm run dev        # http://localhost:5173
```

---

## Building the macOS desktop app

### 1. Install dependencies

```bash
cd frontend && npm install
cd ../backend && bun install
```

### 2. Build the backend sidecar

The backend runs as an embedded binary inside the Tauri app.

```bash
cd frontend
npm run build:sidecar
```

This compiles the Bun backend into a standalone binary at
`frontend/src-tauri/binaries/devcanvas-backend-<target>`.

For Apple Silicon:
```bash
../scripts/build-sidecar.sh aarch64-apple-darwin
```

For Intel Mac:
```bash
../scripts/build-sidecar.sh x86_64-apple-darwin
```

### 3. Build the Tauri app

```bash
cd frontend
npm run tauri:build
```

The output is at `frontend/src-tauri/target/release/bundle/`:
- **macOS**: `macos/DevCanvas.app` + `dmg/DevCanvas_*.dmg`

---

## Session types

| Type | Description |
|------|-------------|
| **tmux** | Persistent multiplexed session — survives reconnects |
| **local** | Direct PTY using your system shell (`$SHELL`) |
| **ssh** | SSH connection to a remote machine (`user@host:port`) |

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `T` | Add next session to canvas |
| `N` | Add note block |
| `B` | Toggle sidebar |
| `⌘Z` / `Ctrl+Z` | Undo |

---

## Architecture

```
frontend/          SvelteKit + Svelte 5 (Tauri static build)
  src-tauri/       Rust Tauri shell — spawns backend sidecar
  src/
    lib/canvas/    Canvas editor (xyflow)
    lib/ws/        WebSocket client with reconnect + replay
    routes/        SvelteKit pages

backend/           Bun + Hono HTTP + WebSocket server
  src/
    services/
      tmux.ts      tmux session management (FIFO streaming)
      tmux-control.ts  persistent control-mode client (~0.1ms latency)
      pty.ts       PTY/SSH subprocess management
    ws/
      handler.ts   WebSocket message router
    routes/        REST API (workspaces, sessions)
    db.ts          SQLite via bun:sqlite
```
