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

	function focusOnMount(node: HTMLElement) { node.focus(); }

	let createType = $state<'tmux' | 'pty'>('tmux');
	let createName = $state('');
	let creating = $state(false);

	function getDefaultName(): string {
		const nums = $sessions
			.filter(s => s.name.startsWith('dev-'))
			.map(s => parseInt(s.name.replace('dev-', ''), 10))
			.filter(n => !isNaN(n));
		return `dev-${(nums.length > 0 ? Math.max(...nums) : 0) + 1}`;
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
			sessions.update(s => [...s, session]);
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
			sessions.update(s => s.filter(sess => sess.id !== id));
		} catch (err) {
			console.error('Failed to delete session:', err);
		}
	}
</script>

<aside class="sidebar">

	<!-- Section header -->
	<div class="section-head">
		<div class="section-left">
			<span class="section-title">Sessions</span>
			{#if $sessions.length > 0}
				<span class="count">{$sessions.length}</span>
			{/if}
		</div>
		<div class="section-actions">
			<button class="action-btn" onclick={() => openCreateModal('tmux')} title="New tmux session">
				+ tmux
			</button>
			<span class="action-sep">·</span>
			<button class="action-btn action-btn--pty" onclick={() => openCreateModal('pty')} title="New PTY session">
				+ pty
			</button>
		</div>
	</div>

	<!-- Session list -->
	<div class="list-area">
		{#if $sessionsLoading}
			{#each { length: 3 } as _, i}
				<div class="skeleton" style="opacity: {1 - i * 0.2}"></div>
			{/each}
		{:else if $sessions.length === 0}
			<div class="empty">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<rect x="2" y="2" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/>
					<path d="M6 18h8M10 14v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
					<path d="M5 8l3 2-3 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				<span>No sessions</span>
			</div>
		{:else}
			{#each $sessions as session (session.id)}
				<SessionItem
					{session}
					onclick={() => onAddTerminal?.(session.id, session.name, session.type)}
					ondelete={() => deleteSession(session.id)}
				/>
			{/each}
		{/if}
	</div>

	<!-- Footer -->
	<div class="sidebar-foot">
		<button class="foot-note" onclick={() => onAddNote?.()}>
			<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
				<path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
			</svg>
			Note block
		</button>

		<div class="foot-row">
			<span class="foot-label">Font</span>
			<div class="stepper">
				<button
					class="stepper-btn"
					onclick={() => terminalConfig.setFontSize($terminalConfig.fontSize - 1)}
					disabled={$terminalConfig.fontSize <= terminalConfig.MIN}
					aria-label="Decrease font size"
				>−</button>
				<span class="stepper-val">{$terminalConfig.fontSize}</span>
				<button
					class="stepper-btn"
					onclick={() => terminalConfig.setFontSize($terminalConfig.fontSize + 1)}
					disabled={$terminalConfig.fontSize >= terminalConfig.MAX}
					aria-label="Increase font size"
				>+</button>
			</div>
		</div>

		<div class="hints">
			<span><kbd>T</kbd> terminal</span>
			<span><kbd>N</kbd> note</span>
			<span><kbd>⌘Z</kbd> undo</span>
		</div>
	</div>
</aside>

<!-- Modal -->
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
			onkeydown={(e) => e.key === 'Enter' && createSession()}
		>
			<!-- Type toggle -->
			<div class="modal-toggle">
				<button
					class="toggle-opt"
					class:active={createType === 'tmux'}
					onclick={() => createType = 'tmux'}
				>tmux</button>
				<button
					class="toggle-opt"
					class:active={createType === 'pty'}
					onclick={() => createType = 'pty'}
				>pty</button>
			</div>

			<div class="modal-body">
				<p class="modal-desc">
					{createType === 'tmux'
						? 'Creates a multiplexed tmux session on the server'
						: 'Spawns a direct PTY shell process'}
				</p>

				<label class="field">
					<span class="field-label">Name</span>
					<input
						class="field-input"
						type="text"
						bind:value={createName}
						placeholder="dev-1"
						use:focusOnMount
					/>
				</label>
			</div>

			<div class="modal-foot">
				<button class="btn-ghost" onclick={() => showCreateModal = false}>Cancel</button>
				<button
					class="btn-primary"
					onclick={createSession}
					disabled={creating || !createName.trim()}
				>{creating ? 'Creating…' : 'Create'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ─── Sidebar shell ───────────────────────────────── */
	.sidebar {
		width: 228px;
		min-width: 228px;
		height: 100%;
		background: var(--surface);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ─── Section header ──────────────────────────────── */
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 14px;
		height: 44px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--border);
	}

	.section-left {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.section-title {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		letter-spacing: 0.04em;
	}

	.count {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: var(--border);
		font-variant-numeric: tabular-nums;
		background: var(--surface2);
		padding: 1px 6px;
		border-radius: 10px;
		border: 1px solid var(--border);
		line-height: 1.5;
	}

	.section-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.action-sep {
		font-size: 10px;
		color: var(--border);
		user-select: none;
		padding: 0 1px;
	}

	.action-btn {
		background: transparent;
		border: none;
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #4a4a60;
		cursor: pointer;
		padding: 3px 6px;
		border-radius: 4px;
		transition: color 0.12s ease, background 0.12s ease;
		letter-spacing: 0.02em;
	}
	.action-btn:hover {
		color: var(--accent-hover);
		background: rgba(124, 92, 252, 0.08);
	}
	.action-btn--pty:hover {
		color: #3dd68c;
		background: rgba(61, 214, 140, 0.08);
	}

	/* ─── Session list ────────────────────────────────── */
	.list-area {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	/* Skeleton */
	.skeleton {
		height: 34px;
		background: var(--surface2);
		border-radius: 5px;
		animation: pulse-dot 1.6s ease-in-out infinite;
	}

	/* Empty */
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 40px 0;
		color: var(--border);
	}
	.empty span {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: #3a3a50;
	}

	/* ─── Footer ──────────────────────────────────────── */
	.sidebar-foot {
		border-top: 1px solid var(--border);
		padding: 10px 14px 12px;
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.foot-note {
		display: flex;
		align-items: center;
		gap: 7px;
		background: transparent;
		border: none;
		color: #3a3a50;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		padding: 0;
		transition: color 0.12s ease;
		width: fit-content;
	}
	.foot-note:hover {
		color: var(--muted);
	}

	.foot-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.foot-label {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: #3a3a50;
	}

	/* Stepper */
	.stepper {
		display: flex;
		align-items: center;
		border: 1px solid var(--border);
		border-radius: 5px;
		overflow: hidden;
		background: var(--surface2);
	}

	.stepper-btn {
		width: 24px;
		height: 22px;
		background: transparent;
		border: none;
		color: #4a4a60;
		font-size: 13px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-family-mono, monospace);
		transition: background 0.1s ease, color 0.1s ease;
	}
	.stepper-btn:hover:not(:disabled) {
		background: var(--border);
		color: var(--text);
	}
	.stepper-btn:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.stepper-val {
		width: 28px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-family-mono, monospace);
		font-size: 11px;
		color: var(--muted);
		border-left: 1px solid var(--border);
		border-right: 1px solid var(--border);
		font-variant-numeric: tabular-nums;
	}

	/* Hints */
	.hints {
		display: flex;
		gap: 10px;
	}
	.hints span {
		display: flex;
		align-items: center;
		gap: 3px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		color: var(--border);
	}
	kbd {
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 3px;
		padding: 1px 4px;
		color: #4a4a60;
		line-height: 1.5;
	}

	/* ─── Modal ───────────────────────────────────────── */
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
		width: 340px;
		overflow: hidden;
		box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.04);
	}

	/* Type toggle */
	.modal-toggle {
		display: flex;
		border-bottom: 1px solid var(--border);
	}

	.toggle-opt {
		flex: 1;
		padding: 12px 0;
		background: transparent;
		border: none;
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		color: var(--muted);
		cursor: pointer;
		transition: color 0.12s ease, background 0.12s ease;
		position: relative;
	}
	.toggle-opt:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.toggle-opt.active {
		color: var(--text);
		background: var(--surface2);
	}
	.toggle-opt.active::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 16px;
		right: 16px;
		height: 2px;
		background: var(--accent);
		border-radius: 2px 2px 0 0;
	}
	.toggle-opt:not(:last-child) {
		border-right: 1px solid var(--border);
	}

	.modal-body {
		padding: 20px 20px 16px;
	}

	.modal-desc {
		margin: 0 0 16px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		color: var(--muted);
		line-height: 1.6;
	}

	/* Field */
	.field {
		display: block;
	}

	.field-label {
		display: block;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		font-weight: 600;
		color: #4a4a60;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 6px;
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

	/* Modal footer */
	.modal-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px;
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
	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.btn-primary:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
