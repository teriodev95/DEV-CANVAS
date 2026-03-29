<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import CanvasEditor from '$lib/canvas/CanvasEditor.svelte';
	import { sessions, sessionsLoading } from '$lib/stores/sessions';
	import { currentWorkspace } from '$lib/stores/workspace';
	import { api } from '$lib/api';

	const workspaceId = $derived($page.params.id);

	let canvasEditor: CanvasEditor | undefined = $state();
	let workspaceName = $state('Loading...');
	let sidebarOpen = $state(true);
	let editingName = $state(false);
	let nameInput = $state('');

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
		try { await api.workspaces.rename(workspaceId, trimmed); } catch { /* silent */ }
	}

	function handleNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') (e.target as HTMLElement).blur();
		if (e.key === 'Escape') { editingName = false; }
	}

	onMount(async () => {
		// Load workspace data
		try {
			const ws = await api.workspaces.get(workspaceId);
			workspaceName = ws.name;
			currentWorkspace.set(ws);
		} catch {
			workspaceName = workspaceId;
		}

		// Load sessions
		sessionsLoading.set(true);
		try {
			const data = await api.sessions.list(workspaceId);
			sessions.set(Array.isArray(data) ? data : (data.sessions ?? []));
		} catch {
			sessions.set([]);
		} finally {
			sessionsLoading.set(false);
		}

		// Load saved canvas snapshot
		try {
			const { snapshot } = await api.workspaces.getCanvas(workspaceId);
			if (snapshot && snapshot !== '{}') {
				canvasEditor?.loadSnapshot(JSON.parse(snapshot));
			}
		} catch { /* no snapshot yet */ }

		// Keyboard shortcuts
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
			if (e.key === 'T' || e.key === 't') {
				const snap = canvasEditor?.getSnapshot();
				const onCanvas = new Set((snap?.nodes ?? []).map((n) => n.id));
				const next = $sessions.find((s) => !onCanvas.has(`terminal-${s.id}`));
				if (next) {
					canvasEditor?.addTerminalNode(next.id, next.name, next.type);
				} else {
					// No session available → open create modal
					window.dispatchEvent(new CustomEvent('devcanvas:new-session'));
				}
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
		canvasEditor?.addNoteNode();
	}

	async function handleSave(nodes: unknown[], edges: unknown[]) {
		try {
			await api.workspaces.saveCanvas(workspaceId, JSON.stringify({ nodes, edges }));
		} catch { /* silent */ }
	}
</script>

<div class="workspace">
	<!-- Top Bar -->
	<header class="topbar">
		<!-- Sidebar toggle — leftmost, controls left panel -->
		<button
			class="btn-sidebar-toggle"
			title={sidebarOpen ? 'Hide sidebar  [B]' : 'Show sidebar  [B]'}
			onclick={() => (sidebarOpen = !sidebarOpen)}
		>
			{#if sidebarOpen}
				<!-- Panel with left strip highlighted → click to hide -->
				<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
					<rect x="1" y="1" width="13" height="13" rx="1.5"/>
					<line x1="5" y1="1.5" x2="5" y2="13.5"/>
				</svg>
			{:else}
				<!-- Panel with left strip dashed → click to show -->
				<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
					<rect x="1" y="1" width="13" height="13" rx="1.5"/>
					<line x1="5" y1="1.5" x2="5" y2="13.5" stroke-dasharray="2.5 2"/>
				</svg>
			{/if}
		</button>

		<a href="/" class="logo">DevCanvas</a>
		<span class="divider">/</span>
		{#if editingName}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="ws-name-input"
				bind:value={nameInput}
				onblur={commitRename}
				onkeydown={handleNameKeydown}
				autofocus
			/>
		{:else}
			<button class="ws-name" onclick={startRename} title="Click to rename">
				{workspaceName}
			</button>
		{/if}
		<div class="spacer"></div>
		<button
			class="btn-new"
			onclick={() => document.dispatchEvent(new CustomEvent('devcanvas:new-session'))}
		>
			<span>+</span> Session
		</button>
	</header>

	<!-- Body -->
	<div class="body">
		<div class="sidebar-wrap" class:closed={!sidebarOpen}>
			<Sidebar {workspaceId} onAddTerminal={handleAddTerminal} onAddNote={handleAddNote} />
		</div>

		<div class="canvas-area">
			<CanvasEditor
				bind:this={canvasEditor}
				{workspaceId}
				onSave={handleSave}
			/>
		</div>
	</div>
</div>

<style>
	.workspace {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0d0d0f;
		overflow: hidden;
	}

	.topbar {
		height: 44px;
		min-height: 44px;
		background: #141418;
		border-bottom: 1px solid #2a2a35;
		display: flex;
		align-items: center;
		padding: 0 12px;
		gap: 8px;
		z-index: 10;
	}

	.btn-sidebar-toggle {
		background: transparent;
		border: none;
		color: #3a3a50;
		padding: 5px 6px;
		border-radius: 5px;
		cursor: pointer;
		display: flex;
		align-items: center;
		transition: color 0.15s, background 0.15s;
		flex-shrink: 0;
	}
	.btn-sidebar-toggle:hover { color: #9b9bb0; background: #1c1c22; }

	.logo {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: 500;
		color: #7c5cfc;
		text-decoration: none;
		letter-spacing: -0.3px;
		flex-shrink: 0;
	}

	.divider { color: #2a2a35; font-size: 18px; }

	.ws-name {
		font-size: 13px;
		font-weight: 500;
		color: #6b6b80;
		font-family: 'JetBrains Mono', monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 220px;
		background: none;
		border: none;
		padding: 2px 5px;
		border-radius: 4px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}
	.ws-name:hover { color: #c0c0d0; background: #1c1c22; }

	.ws-name-input {
		font-size: 13px;
		font-weight: 500;
		color: #e8e8f0;
		font-family: 'JetBrains Mono', monospace;
		background: #1c1c22;
		border: 1px solid #7c5cfc55;
		border-radius: 4px;
		padding: 2px 6px;
		outline: none;
		max-width: 220px;
		min-width: 80px;
	}

	.spacer { flex: 1; }

	.btn-new {
		background: #7c5cfc;
		border: none;
		color: #fff;
		font-size: 12px;
		font-weight: 500;
		padding: 5px 14px;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 5px;
		transition: background 0.15s;
		flex-shrink: 0;
	}
	.btn-new:hover { background: #9575ff; }
	.btn-new span { font-size: 16px; line-height: 1; }

	.body {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	/* Sidebar slide */
	.sidebar-wrap {
		width: 228px;
		min-width: 228px;
		height: 100%;
		overflow: hidden;
		transition: width 0.2s ease, min-width 0.2s ease, opacity 0.15s ease;
	}
	.sidebar-wrap.closed {
		width: 0;
		min-width: 0;
		opacity: 0;
		pointer-events: none;
	}

	.canvas-area {
		flex: 1;
		position: relative;
		overflow: hidden;
	}
</style>
