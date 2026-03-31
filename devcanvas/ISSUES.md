# DEV-CANVAS — Issues & Action Items

> Auditoría bajo: simplicidad primero, claridad, suficiencia, mantenibilidad.
> Referencia: [waveterm](https://github.com/wavetermdev/waveterm) — buenas prácticas aplicables.

---

## P0 — Eliminar código muerto

- [ ] Borrar `backend/index.ts` (scaffold `console.log("Hello via Bun!")`)
- [ ] Borrar `frontend/src/lib/types/` (directorio vacío)
- [ ] Borrar `frontend/src/lib/components/SessionItem.svelte` (136 líneas, nunca importado)
- [ ] Borrar `frontend/src/lib/components/StatusDot.svelte` (solo lo usa SessionItem)
- [ ] Borrar `frontend/src/lib/stores/terminalConfig.ts` (nunca importado, rango font-size conflictivo 9-22 vs 11-18)
- [ ] Borrar `backend/src/middleware/tailscale.ts` (76 líneas, nunca conectado al app)
- [ ] Eliminar exports sin consumidores:
  - `toggleFullscreen`, `enterFullscreen`, `TERMINAL_FULLSCREEN_EVENT` — `terminal/navigation.ts`
  - `workspaceLoading`, `workspaceError` — `stores/workspace.ts`
  - `listActivePtys` — `backend/services/pty.ts`
  - `ServerMessage` — `backend/ws/protocol.ts`

---

## P0 — Eliminar dependencias no usadas

- [ ] **Frontend** (`package.json`): quitar `@tauri-apps/api`, `@xterm/addon-attach`, `@vite-pwa/sveltekit`, `vite-plugin-pwa`, `sharp`
- [ ] **Backend** (`package.json`): quitar `@hono/node-server`
- [ ] Correr `npm install` para actualizar lock

---

## P0 — Desduplicar lógica copiada

### Backend — utilidades compartidas (`pty.ts` y `tmux.ts`)

- [ ] Extraer a `backend/src/services/env.ts`:
  - `CLAUDE_ENV_KEYS`
  - `getDefaultShell()`
  - `getUserLoginPath()`
  - `cleanEnv()`
- [ ] Extraer a `backend/src/services/process-utils.ts`:
  - `run()` (subprocess helper) — unificar versiones de `tmux.ts` y `working-dir.ts`

### Frontend+Backend — normalización de settings

- [ ] `normalizeWorkspaceSettings()` y `normalizeSessionAppearance()` están duplicadas con implementaciones distintas en:
  - `frontend/src/lib/terminal/settings.ts:252-286`
  - `backend/src/db.ts:72-116`
- [ ] **Adoptar de waveterm**: usar **Zod como fuente única de verdad**. Definir schemas una vez, inferir tipos con `z.infer<>`, compartir entre frontend y backend. Elimina la duplicación y da validación runtime gratis.

### Frontend — constantes de layout

- [ ] Extraer a `frontend/src/lib/canvas/constants.ts`:
  - `660` (node width), `440` (node height), `48` (gapX), `52` (gapY), `96` (startX/Y)
  - Usadas en `+page.svelte`, `CanvasEditor.svelte`

### Frontend — patrón retry

- [ ] Extraer a `frontend/src/lib/utils/retry.ts`:
  - `retry<T>(fn, attempts, baseDelay, maxDelay)`
  - Duplicado en `+page.svelte` (home) y `workspace/[id]/+page.svelte` (×2)

---

## P0 — Constantes centralizadas (inspirado en waveterm)

waveterm usa 3 niveles de constantes. Adoptar el mismo patrón:

- [ ] Crear `backend/src/constants.ts`:
  - Puerto: `PORT = 39471`
  - Terminal: `DEFAULT_COLS = 220`, `DEFAULT_ROWS = 50`
  - SSH: `SSH_CONNECT_TIMEOUT`, `SSH_ALIVE_INTERVAL`, `SSH_ALIVE_COUNT_MAX`, `SSH_CONTROL_PERSIST`
- [ ] Crear `frontend/src/lib/constants.ts`:
  - Layout: `NODE_WIDTH`, `NODE_HEIGHT`, `GRID_GAP_X`, `GRID_GAP_Y`, `GRID_START_X`, `GRID_START_Y`
  - Timings: `PERSIST_DEBOUNCE_MS`, `PULSE_DURATION_MS`, `STATUS_FADE_MS`, `OUTPUT_BATCH_MS`, `CANVAS_SAVE_DEBOUNCE_MS`, `CWD_POLL_MS`, `RECONNECT_MAX_MS`
  - Retry: `RETRY_ATTEMPTS`, `RETRY_BASE_MS`, `RETRY_MAX_MS`
- [ ] **Namespacing** (patrón `waveterm/metaconsts.go`): usar prefijos por dominio (`canvas:nodeWidth`, `terminal:fontSize`, `ssh:connectTimeout`) para settings keys

---

## P1 — Dividir componentes oversized

### `TerminalNode.svelte` — 1,437 líneas

- [ ] Extraer `TerminalSettingsMenu` (color/icon/theme/font pickers — ~200 líneas markup)
- [ ] Extraer `CloseConfirmDialog` (diálogo de confirmación)
- [ ] Extraer `TerminalBar` (barra superior con nombre + controles)
- [ ] El componente no debe manejar persistencia de settings — delegar al padre

### `Sidebar.svelte` — 1,034 líneas

- [ ] Extraer `WorkspaceMenu` (icon/color picker + font stepper — líneas 296-402)
- [ ] Extraer `WorkspaceCard` independiente
- [ ] Extraer `formatRelative()` a `utils/date.ts` (duplicada en `WorkspaceCard.svelte`)

### `handler.ts` — `handleSessionSubscribe()` — 151 líneas

- [ ] Dividir en `handleTmuxSubscribe()`, `handlePtySubscribe()`, `replayBufferedOutput()`

### `+page.svelte` (workspace) — `$effect` de 115 líneas

- [ ] Separar: `loadWorkspace()`, `loadSessions()`, `loadCanvasSnapshot()`

### `pty.ts` — 634 líneas

- [ ] Extraer Python bridge source a `backend/src/services/pty-bridge.py.txt` o constante separada
- [ ] `spawnPty()` (195 líneas) y `spawnSsh()` (105 líneas) comparten estructura — extraer `readStream()` compartido

---

## P2 — Inconsistencias a corregir

- [ ] **Unificar idioma de errores**: elegir español O inglés para todos los mensajes de error UI
- [ ] **14 catch silenciosos**: agregar `console.debug` mínimo en cada uno
- [ ] **Type guard inconsistente**: `isTerminalIconKey` → usar `.includes()` como `isTerminalColorKey`
- [ ] **Renombrar** `d` → `nodeData` en `CanvasEditor.svelte:265`
- [ ] **Renombrar** `run()` → `execCommand()` en `tmux.ts` y `working-dir.ts`
- [ ] **UI duplicada**: extraer `<IconPicker>` y `<ColorSwatchPicker>` reutilizables (repetidos en 3 componentes)
- [ ] **`WSMessage` type collision**: frontend tiene tipo loose, backend tiene discriminated union — alinear o renombrar

---

## P2 — Tipos compartidos frontend/backend (inspirado en waveterm)

waveterm auto-genera tipos TS desde Go. DEV-CANVAS tiene TS en ambos lados, así que es más simple:

- [ ] Crear `shared/types/` con interfaces compartidas (`WorkspaceSettings`, `SessionAppearance`, `WSMessage`, etc.)
- [ ] Definir schemas Zod una vez → `z.infer<>` para tipos → usar en ambos lados
- [ ] Eliminar duplicación manual de tipos entre `frontend/settings.ts` y `backend/db.ts`
- [ ] Alinear `WSMessage` del frontend (tipo loose `{type: string, [key: string]: unknown}`) con el discriminated union del backend

---

## P2 — Logging estructurado (inspirado en waveterm)

waveterm usa Winston con rotación, tags `[service]`/`[panic]`, y timing por llamada.

- [ ] Introducir logger simple (pino o winston) con niveles `debug/info/warn/error`
- [ ] **Tag prefixes** para grep-ability: `[ws]`, `[pty]`, `[tmux]`, `[db]`, `[session]`
- [ ] **Service call timing**: medir duración en cada llamada API con `Date.now()` delta — loggear método + ms
- [ ] Reemplazar los 57 `console.*` dispersos con el logger
- [ ] **Frontend → backend log forwarding**: enviar logs frontend al backend via IPC para archivo unificado (patrón `fe-log` de waveterm)
- [ ] Rotación de logs: 10MB max, 5 archivos, con try/catch para que nunca rompa la app

---

## P3 — WebSocket reconnection robusto (inspirado en waveterm)

- [ ] Implementar `reconnectHandlers` pattern: `Set<() => void>` donde cada suscriptor re-registra rutas tras reconexión
- [ ] Backoff escalonado: `[0, 0, 2, 5, 10, 10, 30, 60]` segundos (patrón waveterm)
- [ ] Cola de mensajes offline + flush en reconnect
- [ ] Reset de backoff tras 2s de conexión estable

---

## P3 — Tooling y tests (inspirado en waveterm)

- [ ] **ESLint flat config**: `typescript-eslint` recommended + `eslint-config-prettier` al final + reglas pragmáticas (`no-explicit-any: off`, `no-unused-vars: warn` con `_` prefix)
- [ ] **Prettier**: `printWidth: 120`, `prettier-plugin-organize-imports`
- [ ] **Vitest**: `istanbul` coverage, `lcov` reporter, `junit` output para CI
- [ ] Tests de integración backend: tmux, PTY, WebSocket protocol
- [ ] Tests unitarios: normalización de settings, type guards, utilidades compartidas

---

## Nota positiva

No hay sobre-ingeniería arquitectónica. Sin adapters, facades, factories, ORMs, ni capas innecesarias. El Rust shell es mínimo. Los stores son thin. El proyecto es estructuralmente sano — necesita higiene, no redesign.

## Prácticas de waveterm NO aplicables

- Go→TS code generation (ambos lados son TS → import directo o Zod)
- Electron IPC (usamos Tauri, ya tiene su propio mecanismo)
- WshRouter/RPC routing multi-tab (DEV-CANVAS es single-window canvas)
- WaveObj/oRef full object database (overkill — caché reactiva ligera basta)
- Jotai-specific patterns (usamos Svelte stores → `derived()` equivalente)
