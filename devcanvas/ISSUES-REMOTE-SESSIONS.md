# DEV-CANVAS — Sesiones Remotas: Conectar, Desconectar, Reconectar

> Objetivo: SSH sessions que sobreviven cierres, caídas de red y reinicios de app.
> Zero fricción para el usuario. Simple. Mínimo.

---

## Estado Actual

DEV-CANVAS ya tiene SSH con tmux remoto (`ssh_durable`). Lo que falta es la capa de resiliencia y UX.

| Que funciona | Que no |
|---|---|
| SSH connect con `ControlMaster` | SSH resize es no-op |
| Remote tmux (`-A -D`) preserva proceso | No hay health check — muerte detectada solo al reconectar |
| Output buffering en DB | Reconnect repite TODO el output (fromSequence=0) |
| WebSocket auto-reconnect | No hay `session:unsubscribe` en el protocolo |
| `spawnSsh()` con keepalive | Errores SSH aparecen inline sin estructura |
| SSH metadata persistida en DB | No hay estados visuales SSH-specific en UI |

---

## Principios de Diseño

1. **El proceso sigue vivo** — tmux remoto sobrevive a todo. Solo necesitamos reconectar el transporte.
2. **Avisar, no esconder** — Si la conexión puede estar muerta, decirlo. Nunca silencio.
3. **Una acción máximo** — Reconectar debe ser automático o un click. Nunca re-escribir credenciales.
4. **Degradación elegante** — Terminal congelada con aviso > terminal que parece viva pero no responde.

---

## Implementación

### 1. Session States — Una máquina de estados simple

```
idle → connecting → connected ⇄ reconnecting → disconnected
                                         ↘ error
```

**Backend** — agregar a `db.ts` session schema:

```typescript
type SessionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
```

**Reglas:**
- `idle`: session existe en DB pero no hay proceso activo
- `connecting`: primer connect o reconnect en progreso
- `connected`: PTY/SSH vivo, output fluyendo
- `reconnecting`: transporte cayó, intentando reconectar (auto)
- `disconnected`: reconexión falló después de N intentos, requiere acción del usuario
- `error`: auth fallida, host inalcanzable, etc — requiere acción

**Persistir estado en DB** — al cerrar la app, el último estado se guarda. Al reabrir, se restaura.

---

### 2. Health Monitor — Detectar desconexión temprano

**Backend** — nuevo `backend/src/services/health-monitor.ts`:

```
Cada 10s:
  - Para cada sesión SSH activa: verificar que el proceso SSH siga vivo
  - Si proceso murió → emitir 'session:health' { status: 'disconnected' }
  
Cada 30s:
  - Para cada sesión tmux activa: verificar tmux hasSession
  - Si sesión desapareció → emitir 'session:health' { status: 'disconnected' }
```

**No sobre-ingeniar**: un `setInterval` que checkea `process.kill(pid, 0)` para SSH y `tmux has-session` para tmux. Nada más.

---

### 3. Auto-Reconnect — Sin intervención del usuario

**Frontend** — en `TerminalPane.svelte`, al recibir `session:health { status: 'disconnected' }`:

```
1. Mostrar banner "Reconnecting..." en la terminal (no borrar contenido)
2. Re-enviar 'session:subscribe' con fromSequence = lastSequence (no 0)
3. Backoff: [1s, 2s, 4s, 8s, 16s, 30s, 30s...]
4. Si reconecta → emitir 'session:health' { status: 'connected' }, quitar banner
5. Si falla 8 intentos → status 'disconnected', mostrar "Click to retry"
```

**Para SSH durable (tmux remoto)**: Al reconectar, el comando `tmux new-session -A -D -s <name>` re-attacha automáticamente a la sesión existente. El usuario ve exactamente donde estaba.

**Fix crítico**: `fromSequence` debe ser el último sequence recibido, no `0`. Esto evita duplicar output.

---

### 4. App Reopen — Restaurar sesiones automáticamente

**Backend** — en `index.ts` startup:

```typescript
// Después de DB init:
const activeSessions = db.getActiveSessions() // status != 'disconnected'
for (const session of activeSessions) {
  if (session.type === 'tmux') {
    // Verificar si tmux session sigue viva
    if (tmuxService.hasSession(session.name)) {
      session.status = 'idle' // lista para reconnect
    } else {
      session.status = 'disconnected'
    }
  }
  if (session.type === 'ssh' && session.ssh_durable) {
    // tmux remoto probablemente sigue vivo — marcar idle
    session.status = 'idle'
  }
  db.updateSessionStatus(session.id, session.status)
}
```

**Frontend** — al cargar workspace:

```typescript
// Para cada sesión con status 'idle' o 'connected':
// Auto-subscribe via WebSocket → dispara el flujo normal de connect/reconnect
```

**Resultado**: El usuario abre la app y ve sus terminales exactamente como las dejó.

---

### 5. SSH Resize — Fix inmediato

**Backend** — `pty.ts`, SSH sessions necesitan resize:

```typescript
// En spawnSsh(), guardar reference al control socket:
const controlPath = getControlPath(sessionId)

// Nueva función:
function resizeSshSession(sessionId: string, cols: number, rows: number) {
  // Via control socket: ssh -O resize <cols> <rows> -S <controlPath> <host>
  exec(`ssh -O ${cols}x${rows} -S ${controlPath} ${host}`)
}
```

**En `handler.ts`** — el `session:resize` message ya existe. Agregar caso SSH que llame `resizeSshSession()`.

---

### 6. UI States — Feedback visual mínimo

**TerminalNode.svelte** — un indicador de estado por terminal:

| Estado | Visual |
|---|---|
| `connected` | Nada (estado normal, sin distracción) |
| `connecting` | Dot amarillo pulsante + "Connecting..." en la barra |
| `reconnecting` | Banner sutil en la terminal "Reconnecting..." + dot amarillo |
| `disconnected` | Dot rojo + "Disconnected — click to retry" |
| `error` | Dot rojo + mensaje de error específico (auth failed, host unreachable, etc) |

**No agregar**: spinners complejos, modales, toasts. Solo un dot y texto. Mínimo.

**Mensajes de error SSH clasificados**:

| Error | Mensaje al usuario |
|---|---|
| Auth failed | "Authentication failed — check your credentials" |
| Host unreachable | "Cannot reach {host} — check network" |
| Connection refused | "Connection refused — is SSH running on {host}:{port}?" |
| Host key changed | "Host key changed — possible security issue" |
| Timeout | "Connection timed out — {host} may be unreachable" |
| Unknown | "Connection lost" |

---

### 7. WebSocket Protocol — Cambios mínimos

**Agregar al protocolo** (`protocol.ts`):

```typescript
// Nuevo message type:
| { type: 'session:health'; sessionId: string; status: SessionStatus; error?: string }

// Modificar subscribe para aceptar fromSequence:
| { type: 'session:subscribe'; sessionId: string; fromSequence?: number }
```

**Agregar `session:unsubscribe`**:

```typescript
| { type: 'session:unsubscribe'; sessionId: string }
```

Al cambiar de workspace, enviar `session:unsubscribe` para limpiar streams sin matar tmux/SSH.

---

## Qué NO hacer

- **No** implementar mosh-like UDP — ssh + tmux remoto ya resuelve el problema
- **No** agregar job managers daemonizados como waveterm — tmux remoto ya es el daemon
- **No** construir un secreto store criptográfico — usar SSH agent y `~/.ssh/config` del sistema
- **No** agregar connection profiles UI — usar `~/.ssh/config` que ya existe
- **No** sobre-ingeniar la máquina de estados — 6 estados, transiciones claras, listo

---

## Orden de implementación

1. **Fix `fromSequence`** — 5 líneas, elimina duplicación de output (P0)
2. **SSH resize** — 15 líneas, fix inmediato de UX (P0)
3. **Health monitor** — ~40 líneas backend, detección temprana (P0)
4. **Auto-reconnect con backoff** — ~60 líneas frontend, zero-friction (P0)
5. **UI states** — dot + texto, ~30 líneas CSS + lógica (P1)
6. **Session status en DB** — persistir estado al cerrar, restaurar al abrir (P1)
7. **App reopen restore** — ~30 líneas backend startup (P1)
8. **Error classification** — mensajes específicos por tipo de error SSH (P2)
9. **`session:unsubscribe`** — cleanup limpio al cambiar workspace (P2)
