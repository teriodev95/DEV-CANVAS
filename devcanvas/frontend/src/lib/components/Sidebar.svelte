<script lang="ts">
	import SessionItem from './SessionItem.svelte';
	import { sessions, sessionsLoading } from '$lib/stores/sessions';
	import { terminalConfig } from '$lib/stores/terminalConfig';
	import { api } from '$lib/api';

	type Props = {
		workspaceId: string;
		onAddTerminal?: (sessionId: string, sessionName: string, sessionType: 'tmux' | 'pty') => void;
		onAddNote?: () => void;
	};

	let { workspaceId, onAddTerminal, onAddNote }: Props = $props();

	let showCreateModal = $state(false);

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}
	let createType = $state<'tmux' | 'pty'>('tmux');
	let createName = $state('');
	let creating = $state(false);

	let sessionCount = $derived($sessions.length);

	function getDefaultName(): string {
		const existingNumbers = $sessions
			.filter((s) => s.name.startsWith('dev-'))
			.map((s) => parseInt(s.name.replace('dev-', ''), 10))
			.filter((n) => !isNaN(n));
		const max = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
		return `dev-${max + 1}`;
	}

	function openCreateModal(type: 'tmux' | 'pty') {
		createType = type;
		createName = getDefaultName();
		showCreateModal = true;
	}

	async function createSession() {
		if (!createName.trim() || creating) return;
		creating = true;
		try {
			const session = await api.sessions.create(workspaceId, createName.trim(), createType);
			sessions.update((s) => [...s, session]);
			showCreateModal = false;
			onAddTerminal?.(session.id, session.name, session.type);
		} catch (err) {
			console.error('Failed to create session:', err);
		} finally {
			creating = false;
		}
	}

	async function deleteSession(id: string) {
		try {
			await api.sessions.delete(id);
			sessions.update((s) => s.filter((sess) => sess.id !== id));
		} catch (err) {
			console.error('Failed to delete session:', err);
		}
	}

	function handleSessionClick(session: { id: string; name: string; type: 'tmux' | 'pty' }) {
		onAddTerminal?.(session.id, session.name, session.type);
	}
</script>

<!-- Sidebar -->
<aside class="sidebar">

	<!-- Header -->
	<header class="sidebar-header">
		<div class="section-row">
			<span class="section-label">Sessions</span>
			{#if sessionCount > 0}
				<span class="count-badge">{sessionCount}</span>
			{/if}
		</div>

		<div class="create-row">
			<button class="create-btn create-btn--tmux" onclick={() => openCreateModal('tmux')}>
				<svg class="create-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				tmux
			</button>
			<button class="create-btn create-btn--pty" onclick={() => openCreateModal('pty')}>
				<svg class="create-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				pty
			</button>
		</div>
	</header>

	<!-- Sessions list -->
	<div class="sessions-scroll">
		{#if $sessionsLoading}
			<div class="skeleton-list">
				{#each { length: 3 } as _}
					<div class="skeleton-item"></div>
				{/each}
			</div>
		{:else if $sessions.length === 0}
			<div class="empty-state">
				<svg class="empty-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<rect x="3" y="3" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
					<path d="M7 21h10M12 17v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					<path d="M7.5 10l2 2-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					<path d="M12.5 14h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				<p class="empty-title">No sessions yet</p>
				<p class="empty-sub">Use + tmux or + pty to start</p>
			</div>
		{:else}
			<ul class="session-list">
				{#each $sessions as session (session.id)}
					<li class="session-list-item">
						<SessionItem
							{session}
							onclick={() => handleSessionClick(session)}
							ondelete={() => deleteSession(session.id)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Footer -->
	<footer class="sidebar-footer">
		<button class="btn-note" onclick={() => onAddNote?.()}>
			<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="13" height="13">
				<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			Note Block
		</button>

		<div class="footer-row">
			<span class="footer-label">Font size</span>
			<div class="font-stepper">
				<button
					class="stepper-btn"
					onclick={() => terminalConfig.setFontSize($terminalConfig.fontSize - 1)}
					disabled={$terminalConfig.fontSize <= terminalConfig.MIN}
					aria-label="Decrease font size"
				>−</button>
				<span class="stepper-value">{$terminalConfig.fontSize}</span>
				<button
					class="stepper-btn"
					onclick={() => terminalConfig.setFontSize($terminalConfig.fontSize + 1)}
					disabled={$terminalConfig.fontSize >= terminalConfig.MAX}
					aria-label="Increase font size"
				>+</button>
			</div>
		</div>

		<div class="hints">
			<span class="hint"><kbd>T</kbd> terminal</span>
			<span class="hint"><kbd>N</kbd> note</span>
			<span class="hint"><kbd>⌘Z</kbd> undo</span>
		</div>
	</footer>
</aside>

<!-- Create Session Modal -->
{#if showCreateModal}
	<div
		class="modal-backdrop"
		role="dialog"
		aria-modal="true"
		onclick={(e) => { if (e.target === e.currentTarget) showCreateModal = false; }}
		onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
		tabindex="-1"
	>
		<div
			class="modal-card"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Enter' && createSession()}
			role="presentation"
		>
			<div class="modal-header">
				<h2 class="modal-title">New {createType} session</h2>
				<p class="modal-sub">
					{createType === 'tmux' ? 'Creates a tmux session on the server' : 'Spawns a PTY shell'}
				</p>
			</div>

			<label class="field">
				<span class="field-label">Session name</span>
				<input
					class="field-input"
					type="text"
					bind:value={createName}
					placeholder="dev-1"
					use:focusOnMount
				/>
			</label>

			<div class="modal-actions">
				<button class="modal-btn modal-btn--cancel" onclick={() => (showCreateModal = false)}>
					Cancel
				</button>
				<button
					class="modal-btn modal-btn--confirm"
					onclick={createSession}
					disabled={creating || !createName.trim()}
				>
					{creating ? 'Creating…' : 'Create'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Layout ──────────────────────────────────── */
	.sidebar {
		width: 256px;
		min-width: 256px;
		height: 100%;
		background: var(--surface);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ── Header ──────────────────────────────────── */
	.sidebar-header {
		padding: 16px 16px 12px;
		border-bottom: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.section-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.section-label {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.count-badge {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		font-weight: 500;
		color: var(--muted);
		background: var(--surface2);
		border: 1px solid var(--border);
		padding: 1px 7px;
		border-radius: 20px;
		font-variant-numeric: tabular-nums;
		line-height: 1.6;
	}

	/* ── Create buttons ──────────────────────────── */
	.create-row {
		display: flex;
		gap: 6px;
	}

	.create-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 6px 0;
		border-radius: 6px;
		border: 1px solid transparent;
		font-family: var(--font-family-mono, monospace);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
	}

	.create-icon {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}

	.create-btn--tmux {
		background: rgba(124, 92, 252, 0.06);
		border-color: rgba(124, 92, 252, 0.2);
		color: #9575ff;
	}
	.create-btn--tmux:hover {
		background: rgba(124, 92, 252, 0.14);
		border-color: rgba(124, 92, 252, 0.4);
		color: #b09fff;
	}

	.create-btn--pty {
		background: rgba(61, 214, 140, 0.06);
		border-color: rgba(61, 214, 140, 0.2);
		color: #3dd68c;
	}
	.create-btn--pty:hover {
		background: rgba(61, 214, 140, 0.12);
		border-color: rgba(61, 214, 140, 0.35);
		color: #65e4a8;
	}

	/* ── Sessions scroll area ────────────────────── */
	.sessions-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}

	/* Skeleton loading */
	.skeleton-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.skeleton-item {
		height: 38px;
		background: var(--surface2);
		border-radius: 6px;
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 16px;
		gap: 6px;
		text-align: center;
	}

	.empty-icon {
		width: 28px;
		height: 28px;
		color: var(--border);
		margin-bottom: 4px;
	}

	.empty-title {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
	}

	.empty-sub {
		margin: 0;
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: var(--border);
	}

	/* Session list */
	.session-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.session-list-item {
		display: contents;
	}

	/* ── Footer ──────────────────────────────────── */
	.sidebar-footer {
		padding: 12px 16px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.btn-note {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 7px 10px;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--muted);
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
	}
	.btn-note:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: rgba(124, 92, 252, 0.05);
	}

	.footer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.footer-label {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: var(--muted);
	}

	/* Font stepper */
	.font-stepper {
		display: flex;
		align-items: center;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 5px;
		overflow: hidden;
	}

	.stepper-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 24px;
		background: transparent;
		border: none;
		color: var(--muted);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		font-family: var(--font-family-mono, monospace);
		transition: background 0.1s ease, color 0.1s ease;
	}
	.stepper-btn:hover:not(:disabled) {
		background: var(--border);
		color: var(--text);
	}
	.stepper-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.stepper-value {
		font-family: var(--font-family-mono, monospace);
		font-size: 11px;
		color: var(--text);
		min-width: 26px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: 1px solid var(--border);
		border-right: 1px solid var(--border);
		font-variant-numeric: tabular-nums;
	}

	/* Keyboard hints */
	.hints {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.hint {
		display: flex;
		align-items: center;
		gap: 4px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		color: var(--border);
	}

	kbd {
		display: inline-flex;
		align-items: center;
		padding: 1px 5px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 3px;
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		color: var(--muted);
		line-height: 1.6;
	}

	/* ── Modal ───────────────────────────────────── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.65);
		backdrop-filter: blur(3px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 24px;
		width: 360px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
	}

	.modal-header {
		margin-bottom: 20px;
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

	/* Field */
	.field {
		display: block;
		margin-bottom: 20px;
	}

	.field-label {
		display: block;
		margin-bottom: 6px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 500;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
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
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
		box-sizing: border-box;
	}
	.field-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.15);
	}

	/* Modal actions */
	.modal-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	.modal-btn {
		padding: 8px 18px;
		border-radius: 7px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
	}

	.modal-btn--cancel {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--muted);
	}
	.modal-btn--cancel:hover {
		border-color: var(--muted);
		color: var(--text);
	}

	.modal-btn--confirm {
		background: var(--accent);
		border: 1px solid transparent;
		color: #fff;
	}
	.modal-btn--confirm:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.modal-btn--confirm:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
