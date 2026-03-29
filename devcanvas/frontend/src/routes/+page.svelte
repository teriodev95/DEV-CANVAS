<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import WorkspaceCard from '$lib/components/WorkspaceCard.svelte';
	import { api } from '$lib/api';
	import type { Workspace } from '$lib/stores/workspace';

	let workspaces = $state<Workspace[]>([]);
	let loading = $state(true);
	let showCreateModal = $state(false);
	let newWorkspaceName = $state('');
	let creating = $state(false);

	function focusOnMount(node: HTMLElement) { node.focus(); }

	onMount(async () => {
		try {
			const data = await api.workspaces.list();
			workspaces = Array.isArray(data) ? data : (data.workspaces ?? []);
		} catch {
			workspaces = [
				{ id: 'demo-1', name: 'my-project',   createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), updatedAt: new Date(Date.now() - 3600000).toISOString(),    sessionCount: 3 },
				{ id: 'demo-2', name: 'infra-setup',  createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(),   sessionCount: 1 },
			];
		} finally {
			loading = false;
		}
	});

	async function createWorkspace() {
		if (!newWorkspaceName.trim() || creating) return;
		creating = true;
		try {
			const workspace = await api.workspaces.create(newWorkspaceName.trim());
			workspaces = [...workspaces, workspace];
			showCreateModal = false;
			newWorkspaceName = '';
			goto(`/workspace/${workspace.id}`);
		} catch {
			const demoId = `demo-${Date.now()}`;
			workspaces = [...workspaces, { id: demoId, name: newWorkspaceName.trim(), createdAt: new Date().toISOString(), sessionCount: 0 }];
			showCreateModal = false;
			newWorkspaceName = '';
			goto(`/workspace/${demoId}`);
		} finally {
			creating = false;
		}
	}

	function openCreate() {
		newWorkspaceName = '';
		showCreateModal = true;
	}
</script>

<div class="page">
	<!-- Top bar -->
	<header class="topbar">
		<div class="brand">
			<span class="brand-prompt">&gt;_</span>
			<span class="brand-name">DevCanvas</span>
			<span class="brand-version">v0.1</span>
		</div>
		<button class="btn-new" onclick={openCreate}>
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
				<path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			New Workspace
			<span class="kbd-hint">N</span>
		</button>
	</header>

	<!-- Content -->
	<main class="main">
		<div class="page-heading">
			<h1 class="page-title">Workspaces</h1>
			<p class="page-sub">Your visual terminal workspaces</p>
		</div>

		{#if loading}
			<div class="grid">
				{#each { length: 4 } as _}
					<div class="skeleton"></div>
				{/each}
			</div>
		{:else if workspaces.length === 0}
			<div class="empty">
				<div class="empty-terminal">
					<span class="et-path">~/devcanvas</span>
					<span class="et-prompt"> $ </span>
					<span class="et-cmd">ls workspaces/</span>
					<br />
					<span class="et-dim">total 0</span>
					<br />
					<span class="et-prompt">$ </span><span class="et-cursor"></span>
				</div>
				<h2 class="empty-title">No workspaces yet</h2>
				<p class="empty-body">Create a workspace to get started. Each workspace is an infinite canvas where you can arrange terminals and notes.</p>
				<button class="btn-cta" onclick={openCreate}>Create your first workspace</button>
			</div>
		{:else}
			<div class="grid">
				{#each workspaces as workspace (workspace.id)}
					<WorkspaceCard {workspace} onclick={() => goto(`/workspace/${workspace.id}`)} />
				{/each}
			</div>
		{/if}
	</main>
</div>

<!-- Create workspace modal -->
{#if showCreateModal}
	<div
		class="backdrop"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => { if (e.target === e.currentTarget) showCreateModal = false; }}
		onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
	>
		<div
			class="modal"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Enter' && createWorkspace()}
		>
			<div class="modal-header">
				<h2 class="modal-title">New Workspace</h2>
				<p class="modal-sub">An infinite canvas for your terminals and notes.</p>
			</div>

			<div class="modal-body">
				<label class="field">
					<span class="field-label">Name</span>
					<input
						class="field-input"
						type="text"
						bind:value={newWorkspaceName}
						placeholder="my-project"
						use:focusOnMount
					/>
				</label>
			</div>

			<div class="modal-foot">
				<button class="btn-ghost" onclick={() => (showCreateModal = false)}>Cancel</button>
				<button
					class="btn-primary"
					onclick={createWorkspace}
					disabled={creating || !newWorkspaceName.trim()}
				>{creating ? 'Creating…' : 'Create'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ─── Page shell ─────────────────────────────── */
	.page {
		min-height: 100vh;
		background: var(--bg);
		background-image: radial-gradient(circle, #2a2a35 1px, transparent 1px);
		background-size: 28px 28px;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* ─── Top bar ────────────────────────────────── */
	.topbar {
		position: sticky;
		top: 0;
		z-index: 10;
		height: 52px;
		padding: 0 32px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: rgba(13, 13, 15, 0.88);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.brand-prompt {
		font-family: var(--font-family-mono, monospace);
		font-size: 15px;
		font-weight: 400;
		color: #3a3a50;
	}

	.brand-name {
		font-family: var(--font-family-mono, monospace);
		font-size: 15px;
		font-weight: 500;
		color: var(--accent);
		letter-spacing: -0.3px;
	}

	.brand-version {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		font-weight: 500;
		color: var(--accent);
		background: rgba(124, 92, 252, 0.1);
		border: 1px solid rgba(124, 92, 252, 0.2);
		padding: 1px 6px;
		border-radius: 8px;
		opacity: 0.8;
	}

	.btn-new {
		display: flex;
		align-items: center;
		gap: 7px;
		background: var(--accent);
		border: none;
		color: #fff;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 13px;
		font-weight: 500;
		padding: 7px 14px;
		border-radius: 7px;
		cursor: pointer;
		transition: background 0.15s ease, transform 0.1s ease;
	}
	.btn-new:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}
	.btn-new:active {
		transform: translateY(0);
	}

	.kbd-hint {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: rgba(255, 255, 255, 0.45);
		background: rgba(255, 255, 255, 0.1);
		padding: 1px 5px;
		border-radius: 3px;
		margin-left: 2px;
	}

	/* ─── Main content ───────────────────────────── */
	.main {
		max-width: 1200px;
		width: 100%;
		margin: 0 auto;
		padding: 48px 32px;
	}

	.page-heading {
		margin-bottom: 32px;
	}

	.page-title {
		margin: 0 0 6px;
		font-family: var(--font-family-mono, monospace);
		font-size: 26px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.5px;
	}

	.page-sub {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 13px;
		color: var(--muted);
	}

	/* ─── Grid ───────────────────────────────────── */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
	}

	.skeleton {
		height: 110px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	/* ─── Empty state ────────────────────────────── */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 72px 32px;
		text-align: center;
		gap: 12px;
	}

	.empty-terminal {
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		line-height: 1.9;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 14px 20px;
		text-align: left;
		margin-bottom: 12px;
		color: var(--muted);
	}

	.et-path  { color: var(--green); }
	.et-prompt { color: var(--accent); }
	.et-cmd   { color: var(--text); }
	.et-dim   { color: #3a3a50; font-style: italic; }
	.et-cursor {
		display: inline-block;
		width: 7px;
		height: 12px;
		background: var(--accent);
		vertical-align: middle;
		animation: pulse-dot 1s step-end infinite;
		opacity: 0.7;
	}

	.empty-title {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 16px;
		font-weight: 600;
		color: var(--text);
	}

	.empty-body {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 13px;
		color: var(--muted);
		max-width: 340px;
		line-height: 1.7;
	}

	.btn-cta {
		margin-top: 8px;
		background: var(--accent);
		border: none;
		color: #fff;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 13px;
		font-weight: 500;
		padding: 9px 22px;
		border-radius: 8px;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.btn-cta:hover { background: var(--accent-hover); }

	/* ─── Modal ──────────────────────────────────── */
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		width: 360px;
		overflow: hidden;
		box-shadow: 0 32px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.04);
	}

	.modal-header {
		padding: 22px 22px 0;
	}

	.modal-title {
		margin: 0 0 4px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.01em;
	}

	.modal-sub {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		color: var(--muted);
		line-height: 1.5;
	}

	.modal-body {
		padding: 18px 22px 16px;
	}

	.field { display: block; }

	.field-label {
		display: block;
		margin-bottom: 6px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		font-weight: 600;
		color: #4a4a60;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.field-input {
		width: 100%;
		padding: 9px 12px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		color: var(--text);
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		outline: none;
		box-sizing: border-box;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.field-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.12);
	}

	.modal-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 22px;
		border-top: 1px solid var(--border);
		background: var(--surface2);
	}

	.btn-ghost {
		padding: 7px 16px;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--muted);
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}
	.btn-ghost:hover {
		border-color: var(--muted);
		color: var(--text);
	}

	.btn-primary {
		padding: 7px 16px;
		background: var(--accent);
		border: 1px solid transparent;
		border-radius: 6px;
		color: #fff;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.12s ease;
	}
	.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
	.btn-primary:disabled { opacity: 0.4; cursor: default; }
</style>
