<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SessionLauncher from '$lib/components/SessionLauncher.svelte';
	import CanvasEditor from '$lib/canvas/CanvasEditor.svelte';
	import TerminalFullscreen from '$lib/terminal/TerminalFullscreen.svelte';
	import type { CanvasSnapshot } from '$lib/canvas/CanvasEditor.svelte';
	import { sessions, sessionsLoading } from '$lib/stores/sessions';
	import type { Session } from '$lib/stores/sessions';
	import { currentWorkspace } from '$lib/stores/workspace';
	import { api } from '$lib/api';
	import type { Node, Edge } from '@xyflow/svelte';
	import type { Viewport } from '@xyflow/system';

	const workspaceId = $derived($page.params.id ?? '');

	let canvasEditor: CanvasEditor | undefined = $state();
	let workspaceName = $state('Loading...');
	let workspaceLoadError = $state<string | null>(null);
	let sidebarOpen = $state(true);
	let editingName = $state(false);
	let nameInput = $state('');
	let hydratedWorkspaceId = $state<string | null>(null);

	function startRename() {
		nameInput = workspaceName;
		editingName = true;
	}

	async function commitRename() {
		if (!editingName) return;
		editingName = false;
		const trimmed = nameInput.trim();
		if (!trimmed || trimmed === workspaceName) return;
		workspaceName = trimmed;
		currentWorkspace.update((workspace) =>
			workspace && workspace.id === workspaceId
				? { ...workspace, name: trimmed }
				: workspace
		);
		try {
			const updated = await api.workspaces.rename(workspaceId, trimmed);
			currentWorkspace.set(updated);
		} catch { /* silent */ }
	}

	function handleNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') (e.target as HTMLElement).blur();
		if (e.key === 'Escape') { editingName = false; }
	}

	function normalizeSnapshot(
		snapshot: unknown,
		workspaceSessions: Session[]
	): CanvasSnapshot | null {
		const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
		if (!parsed || typeof parsed !== 'object') return null;

		const candidate = parsed as { nodes?: Node[]; edges?: Edge[]; viewport?: unknown };
		const validSessionIds = new Set(workspaceSessions.map((session) => session.id));
		const nodes = (candidate.nodes ?? []).filter((node) => {
			if (node.type !== 'terminal') return true;
			const sessionId = (node.data as { sessionId?: string } | undefined)?.sessionId;
			return typeof sessionId === 'string' && validSessionIds.has(sessionId);
		});

		return {
			nodes,
			edges: (candidate.edges ?? []).filter((edge) =>
				nodes.some((node) => node.id === edge.source) &&
				nodes.some((node) => node.id === edge.target)
			),
			viewport: normalizeViewport(candidate.viewport),
		};
	}

	function buildSessionFallbackSnapshot(workspaceSessions: Session[]): CanvasSnapshot {
		const columns = 2;
		const cardWidth = 660;
		const cardHeight = 440;
		const gapX = 48;
		const gapY = 52;
		const startX = 96;
		const startY = 96;

		const nodes: Node[] = workspaceSessions.map((session, index) => {
			const column = index % columns;
			const row = Math.floor(index / columns);
			return {
				id: `terminal-${session.id}`,
				type: 'terminal',
				position: {
					x: startX + column * (cardWidth + gapX),
					y: startY + row * (cardHeight + gapY),
				},
				data: {
					sessionId: session.id,
					sessionName: session.name,
					sessionType: session.type,
					color: session.appearance?.color ?? undefined,
					icon: session.appearance?.icon ?? undefined,
				},
				style: 'width:660px;height:440px;',
				draggable: true,
			};
		});

		return {
			nodes,
			edges: [],
			viewport: null,
		};
	}

	function mergeMissingTerminalNodes(
		snapshot: CanvasSnapshot,
		workspaceSessions: Session[]
	): CanvasSnapshot {
		const existingSessionIds = new Set(
			snapshot.nodes
				.filter((node) => node.type === 'terminal')
				.map((node) => (node.data as { sessionId?: string } | undefined)?.sessionId)
				.filter((value): value is string => typeof value === 'string')
		);

		const missingSessions = workspaceSessions.filter((session) => !existingSessionIds.has(session.id));
		if (missingSessions.length === 0) return snapshot;

		const terminalNodes = snapshot.nodes.filter((node) => node.type === 'terminal');
		const noteNodes = snapshot.nodes.filter((node) => node.type !== 'terminal');
		const cardWidth = 660;
		const cardHeight = 440;
		const gapX = 48;
		const gapY = 52;
		const columns = 2;

		const terminalPositions = terminalNodes.map((node) => node.position ?? { x: 96, y: 96 });
		const anchorX = terminalPositions.length > 0 ? Math.min(...terminalPositions.map((pos) => pos.x)) : 96;
		const anchorY = terminalPositions.length > 0
			? Math.max(...terminalPositions.map((pos) => pos.y))
			: noteNodes.length > 0
				? Math.max(...noteNodes.map((node) => node.position?.y ?? 96)) + 320
				: 96;

		const appendedNodes: Node[] = missingSessions.map((session, index) => {
			const offset = terminalNodes.length + index;
			const column = offset % columns;
			const row = Math.floor(offset / columns);
			return {
				id: `terminal-${session.id}`,
				type: 'terminal',
				position: {
					x: anchorX + column * (cardWidth + gapX),
					y: anchorY + row * (cardHeight + gapY),
				},
				data: {
					sessionId: session.id,
					sessionName: session.name,
					sessionType: session.type,
					color: session.appearance?.color ?? undefined,
					icon: session.appearance?.icon ?? undefined,
				},
				style: 'width:660px;height:440px;',
				draggable: true,
			};
		});

		return {
			...snapshot,
			nodes: [...snapshot.nodes, ...appendedNodes],
		};
	}

	function normalizeViewport(value: unknown): Viewport | null {
		if (!value || typeof value !== 'object') return null;

		const candidate = value as Partial<Viewport>;
		if (
			typeof candidate.x !== 'number' ||
			typeof candidate.y !== 'number' ||
			typeof candidate.zoom !== 'number'
		) {
			return null;
		}

		return {
			x: candidate.x,
			y: candidate.y,
			zoom: candidate.zoom,
		};
	}

	async function persistWorkspaceSnapshot(targetWorkspaceId: string) {
		if (hydratedWorkspaceId !== targetWorkspaceId) return;
		const snapshot = canvasEditor?.getSnapshot();
		if (!snapshot) return;

		try {
			await api.workspaces.saveCanvas(targetWorkspaceId, snapshot);
		} catch {
			/* silent */
		}
	}

	$effect(() => {
		const id = workspaceId;
		if (!id) return;
		let cancelled = false;

		// Flush pending save for the PREVIOUS workspace before clearing state.
		// Without this, the 2s debounce save is cancelled and snapshot changes
		// (including a newly added task-board node) are lost on workspace switch.
		if (hydratedWorkspaceId && hydratedWorkspaceId !== id) {
			canvasEditor?.cancelPendingSave();
			const snapshot = canvasEditor?.getSnapshot();
			if (snapshot) {
				void api.workspaces.saveCanvas(hydratedWorkspaceId, snapshot);
			}
		}

		hydratedWorkspaceId = null;

		// Reset state
		sessions.set([]);

		// Load workspace, sessions, and canvas snapshot, then apply
		void (async () => {
			let workspaceResolved = false;
			workspaceLoadError = null;

			for (let attempt = 0; attempt < 8; attempt += 1) {
				try {
					const ws = await api.workspaces.get(id);
					if (cancelled) return;
					workspaceName = ws.name;
					currentWorkspace.set(ws);
					workspaceResolved = true;
					break;
				} catch (error) {
					if (cancelled) return;
					if (attempt === 7) {
						workspaceName = id;
						currentWorkspace.set(null);
						workspaceLoadError =
							error instanceof Error ? error.message : 'No se pudo cargar el workspace';
					} else {
						await new Promise((resolve) =>
							setTimeout(resolve, Math.min(250 * 2 ** attempt, 1400))
						);
					}
				}
			}

			if (!workspaceResolved) {
				sessionsLoading.set(false);
				canvasEditor?.loadSnapshot({ nodes: [], edges: [], viewport: null });
				return;
			}

			// Load sessions
			let workspaceSessions: Session[] = [];
			sessionsLoading.set(true);
			try {
				for (let attempt = 0; attempt < 5; attempt += 1) {
					try {
						const fetchedSessions = await api.sessions.list(id);
						if (cancelled) return;
						workspaceSessions = fetchedSessions.filter((session) => session.type !== 'ssh');
						sessions.set(workspaceSessions);
						break;
					} catch (error) {
						if (cancelled) return;
						if (attempt === 4) {
							console.warn('[workspace] failed to load sessions', error);
							workspaceSessions = [];
							sessions.set([]);
						} else {
							await new Promise((resolve) =>
								setTimeout(resolve, Math.min(220 * 2 ** attempt, 1200))
							);
						}
					}
				}
			} finally {
				sessionsLoading.set(false);
			}

			// Load canvas snapshot
			let nextSnapshot: CanvasSnapshot = { nodes: [], edges: [], viewport: null };
			try {
				const { snapshot } = await api.workspaces.getCanvas(id);
				if (cancelled) return;
				if (snapshot && snapshot !== '{}') {
					const normalized = normalizeSnapshot(snapshot, workspaceSessions);
					if (normalized) nextSnapshot = normalized;
				}
			} catch {
				if (cancelled) return;
			}

			// Recover gracefully when the snapshot was accidentally saved empty
			// or when it lost terminal nodes but still has live sessions.
			if (nextSnapshot.nodes.length === 0 && workspaceSessions.length > 0) {
				nextSnapshot = buildSessionFallbackSnapshot(workspaceSessions);
			} else if (workspaceSessions.length > 0) {
				nextSnapshot = mergeMissingTerminalNodes(nextSnapshot, workspaceSessions);
			}

			if (cancelled) return;

			// Apply snapshot directly to the canvas editor.
			// canvasEditor should be bound by now (component is unconditionally
			// rendered and mount completes before effects, plus we did async work).
			const editor = canvasEditor;
			if (editor) {
				try {
					await editor.loadSnapshot(nextSnapshot);
					if (!cancelled) hydratedWorkspaceId = id;
				} catch (err) {
					console.error('[workspace] Failed to apply snapshot:', err);
				}
			} else {
				console.warn('[workspace] canvasEditor not available after loading — this should not happen');
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	onMount(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
			if (e.key === 'T' || e.key === 't') {
				void handleCreateTerminal();
			} else if (e.key === 'N' || e.key === 'n') {
				canvasEditor?.addNoteNode();
			} else if (e.key === 'b' || e.key === 'B') {
				sidebarOpen = !sidebarOpen;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	});

	onDestroy(() => {
		sessions.set([]);
		currentWorkspace.set(null);
	});

	function handleAddTerminal(sessionId: string, sessionName: string, sessionType: string) {
		canvasEditor?.addTerminalNode(sessionId, sessionName, sessionType);
	}

	function handleAddNote() {
		canvasEditor?.startNotePlacement();
	}

	function handleShowTaskBoard() {
		window.dispatchEvent(new CustomEvent('devcanvas:add-task-board'));
	}

	function handleCreateTerminal() {
		if (workspaceLoadError) return;
		window.dispatchEvent(new CustomEvent('devcanvas:new-session', { detail: { type: 'tmux' } }));
	}

	async function handleSave(snapshot: CanvasSnapshot) {
		if (hydratedWorkspaceId !== workspaceId) return;
		try {
			await api.workspaces.saveCanvas(workspaceId, snapshot);
		} catch { /* silent */ }
	}
</script>

<div class="workspace-shell">
	<div class="canvas-layer">
		<CanvasEditor bind:this={canvasEditor} {workspaceId} onSave={handleSave} />
	</div>

	<header class="topbar-shell">
		<div class="topbar-group">
			<button
				class="chip chip-icon"
				title={sidebarOpen ? 'Hide sidebar  [B]' : 'Show sidebar  [B]'}
				onclick={() => (sidebarOpen = !sidebarOpen)}
			>
				{#if sidebarOpen}
					<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
						<rect x="1" y="1" width="13" height="13" rx="1.5"/>
						<line x1="5" y1="1.5" x2="5" y2="13.5"/>
					</svg>
				{:else}
					<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
						<rect x="1" y="1" width="13" height="13" rx="1.5"/>
						<line x1="5" y1="1.5" x2="5" y2="13.5" stroke-dasharray="2.5 2"/>
					</svg>
				{/if}
			</button>

			<a href="/" class="chip brand-chip">
				<span class="brand-mark">&gt;_</span>
				<span class="brand-name">DevCanvas</span>
			</a>

			<div class="chip workspace-chip">
				<span class="workspace-chip-label">workspace</span>
				{#if editingName}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="workspace-input"
						bind:value={nameInput}
						onblur={commitRename}
						onkeydown={handleNameKeydown}
						autofocus
					/>
				{:else}
					<button class="workspace-name-btn" onclick={startRename} title="Click to rename">
						{workspaceName}
					</button>
				{/if}
			</div>
		</div>

		<div class="topbar-group topbar-group--right">
			<div class="chip status-chip">
				<span class="status-dot"></span>
				<span>local canvas</span>
			</div>
			<button class="chip action-chip action-chip--primary" onclick={handleCreateTerminal}>
				<span>+</span>
				<span>Terminal</span>
			</button>
			<button class="chip action-chip" onclick={handleShowTaskBoard}>
				<span>+</span>
				<span>Tasks</span>
			</button>
			<button class="chip action-chip" onclick={handleAddNote}>
				<span>+</span>
				<span>Note</span>
			</button>
		</div>
	</header>

	<aside class:open={sidebarOpen} class:closed={!sidebarOpen} class="sidebar-frame">
		<Sidebar {workspaceId} />
	</aside>

	{#if workspaceLoadError}
		<div class="workspace-alert">
			<div class="workspace-alert-title">Workspace no disponible</div>
			<div class="workspace-alert-copy">{workspaceLoadError}</div>
		</div>
	{:else}
		<SessionLauncher {workspaceId} onAddTerminal={handleAddTerminal} />
	{/if}

	<TerminalFullscreen />
</div>

<style>
	.workspace-shell {
		position: relative;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
	}

	.canvas-layer {
		position: absolute;
		inset: 0;
		z-index: 0;
	}

	.topbar-shell {
		position: absolute;
		top: 12px;
		left: 12px;
		right: 12px;
		z-index: 10;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		pointer-events: none;
	}

	.topbar-group {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		pointer-events: auto;
		padding: 4px;
		border-radius: 999px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 64%),
			var(--float-surface-soft);
		border: 1px solid rgba(126, 136, 160, 0.1);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}

	.topbar-group--right {
		justify-content: flex-end;
	}

	.chip {
		height: 44px;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 0 15px;
		border-radius: 999px;
		border: 1px solid var(--float-border);
		background:
			linear-gradient(180deg, var(--float-highlight), transparent 58%),
			var(--float-surface);
		box-shadow: var(--float-shadow);
		backdrop-filter: var(--float-blur);
		-webkit-backdrop-filter: var(--float-blur);
		color: #eaf0fb;
	}

	.chip-icon {
		width: 44px;
		justify-content: center;
		padding: 0;
		cursor: pointer;
		transition:
			transform 0.14s ease,
			border-color 0.14s ease,
			background 0.14s ease,
			color 0.14s ease;
		color: #95a0b8;
	}

	.chip-icon:hover,
	.action-chip:hover,
	.workspace-name-btn:hover {
		transform: translateY(-1px);
	}

	.chip-icon:hover {
		color: #f5f8ff;
		border-color: var(--float-border-strong);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent 58%),
			var(--float-surface-strong);
	}

	.brand-chip {
		text-decoration: none;
		padding-right: 18px;
	}

	.brand-mark {
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		color: #7c5cfc;
		opacity: 0.88;
	}

	.brand-name {
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: #f1f5ff;
	}

	.workspace-chip {
		gap: 12px;
		padding-right: 12px;
		max-width: min(44vw, 360px);
	}

	.workspace-chip-label {
		flex-shrink: 0;
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(182, 190, 207, 0.62);
	}

	.workspace-input,
	.workspace-name-btn {
		min-width: 0;
		max-width: 100%;
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		font-weight: 600;
		color: #f4f7ff;
		background: rgba(255, 255, 255, 0.035);
		border: 1px solid rgba(255, 255, 255, 0.03);
		border-radius: 999px;
		padding: 8px 12px;
	}

	.workspace-input {
		outline: none;
		width: min(26vw, 250px);
		border-color: rgba(124, 92, 252, 0.28);
		background: rgba(11, 14, 22, 0.72);
	}

	.workspace-input:focus {
		border-color: rgba(124, 92, 252, 0.38);
		box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.12);
	}

	.workspace-name-btn {
		cursor: pointer;
		transition:
			transform 0.14s ease,
			background 0.14s ease,
			border-color 0.14s ease,
			color 0.14s ease;
		color: #d8deec;
	}

	.workspace-name-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(150, 160, 184, 0.14);
		color: #f4f7ff;
	}

	.status-chip {
		gap: 8px;
		padding-right: 18px;
		font-family: var(--font-family-mono, monospace);
		font-size: 11px;
		color: #aeb7cb;
		text-transform: lowercase;
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: #44d987;
		box-shadow: 0 0 0 4px rgba(68, 217, 135, 0.14);
	}

	.action-chip {
		cursor: pointer;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 600;
		color: #dde4f4;
		transition:
			transform 0.14s ease,
			border-color 0.14s ease,
			background 0.14s ease,
			box-shadow 0.14s ease;
	}

	.action-chip:hover {
		border-color: rgba(154, 164, 188, 0.22);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent 58%),
			var(--float-surface-strong);
	}

	.action-chip--primary {
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent 64%),
			linear-gradient(135deg, rgba(124, 92, 252, 0.92), rgba(97, 79, 226, 0.94));
		border-color: rgba(182, 174, 255, 0.24);
		box-shadow:
			0 18px 34px rgba(103, 80, 234, 0.26),
			inset 0 1px 0 rgba(255, 255, 255, 0.16);
		color: white;
	}

	.action-chip--primary:hover {
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 64%),
			linear-gradient(135deg, rgba(133, 105, 255, 0.95), rgba(109, 88, 239, 0.96));
		box-shadow:
			0 22px 38px rgba(103, 80, 234, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.18);
	}

	.sidebar-frame {
		position: absolute;
		top: 74px;
		left: 12px;
		bottom: 12px;
		width: 286px;
		z-index: 10;
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
	}

	.sidebar-frame.open {
		transform: translateX(0);
		opacity: 1;
	}

	.sidebar-frame.closed {
		transform: translateX(-302px);
		opacity: 0;
		pointer-events: none;
	}

	.workspace-alert {
		position: absolute;
		top: 74px;
		right: 12px;
		z-index: 20;
		max-width: 420px;
		padding: 14px 16px;
		border-radius: 22px;
		border: 1px solid rgba(255, 107, 128, 0.18);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 58%),
			rgba(29, 16, 24, 0.82);
		color: #ffdbe2;
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.28),
			inset 0 1px 0 rgba(255, 255, 255, 0.035);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
	}

	.workspace-alert-title {
		font-size: 13px;
		font-weight: 700;
		color: #ffa8b8;
	}

	.workspace-alert-copy {
		margin-top: 4px;
		font-size: 13px;
		line-height: 1.45;
		color: #f2c4ce;
	}

	@media (max-width: 980px) {
		.topbar-shell {
			gap: 10px;
		}

		.topbar-group {
			max-width: 100%;
		}

		.topbar-group--right {
			margin-left: auto;
		}

		.workspace-chip {
			max-width: min(58vw, 320px);
		}

		.status-chip {
			display: none;
		}
	}
</style>
