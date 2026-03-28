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
			// Auto-add to canvas
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
<aside
	style="
		width: 240px;
		min-width: 240px;
		height: 100%;
		background: var(--surface);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	"
>
	<!-- Sidebar Header -->
	<div
		style="
			padding: 14px 12px 10px;
			border-bottom: 1px solid var(--border);
		"
	>
		<div style="font-size: 10px; font-weight: 600; color: #3a3a50; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
			SESSIONS
			{#if sessionCount > 0}
				<span
					style="
						background: var(--surface2);
						color: var(--muted);
						font-size: 10px;
						padding: 1px 6px;
						border-radius: 10px;
						font-variant-numeric: tabular-nums;
					"
				>{sessionCount}</span>
			{/if}
		</div>

		<!-- ACTIONS label -->
		<div style="font-size: 10px; font-weight: 600; color: #3a3a50; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;">ACTIONS</div>

		<!-- Create buttons — minimal text+icon, no heavy borders -->
		<div style="display: flex; gap: 6px;">
			<button
				onclick={() => openCreateModal('tmux')}
				style="
					flex: 1;
					background: transparent;
					border: none;
					color: var(--accent);
					font-size: 11px;
					font-weight: 500;
					padding: 5px 8px;
					border-radius: 5px;
					cursor: pointer;
					font-family: var(--font-family-mono, monospace);
					transition: background 0.1s ease, color 0.1s ease;
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 4px;
					opacity: 0.8;
				"
				onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(124,92,252,0.1)'; el.style.opacity = '1'; }}
				onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.opacity = '0.8'; }}
			>
				<span style="font-size:13px;line-height:1;">+</span> tmux
			</button>
			<button
				onclick={() => openCreateModal('pty')}
				style="
					flex: 1;
					background: transparent;
					border: none;
					color: #3dd68c;
					font-size: 11px;
					font-weight: 500;
					padding: 5px 8px;
					border-radius: 5px;
					cursor: pointer;
					font-family: var(--font-family-mono, monospace);
					transition: background 0.1s ease, color 0.1s ease;
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 4px;
					opacity: 0.8;
				"
				onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(61,214,140,0.08)'; el.style.opacity = '1'; }}
				onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.opacity = '0.8'; }}
			>
				<span style="font-size:13px;line-height:1;">+</span> pty
			</button>
		</div>
	</div>

	<!-- Sessions list -->
	<div
		style="
			flex: 1;
			overflow-y: auto;
			padding: 8px;
			border-top: 1px solid var(--border);
		"
	>
		{#if $sessionsLoading}
			{#each { length: 3 } as _}
				<div
					style="
						height: 36px;
						background: var(--surface2);
						border-radius: 6px;
						margin-bottom: 4px;
						animation: pulse-dot 1.5s ease-in-out infinite;
					"
				></div>
			{/each}
		{:else if $sessions.length === 0}
			<div
				style="
					padding: 24px 12px;
					text-align: center;
					color: #3a3a50;
					font-size: 11px;
					line-height: 1.8;
					font-family: var(--font-family-mono, monospace);
				"
			>
				<div style="margin-bottom: 4px; font-size: 16px; opacity: 0.4; letter-spacing: 2px;">_ _ _</div>
				<div>No sessions yet</div>
				<div style="opacity: 0.6;">Click + to create one</div>
			</div>
		{:else}
			{#each $sessions as session (session.id)}
				<div style="transition: all 0.15s ease;">
					<SessionItem
						{session}
						onclick={() => handleSessionClick(session)}
						ondelete={() => deleteSession(session.id)}
					/>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Sidebar Footer -->
	<div class="sidebar-footer">
		<button class="btn-note" onclick={() => onAddNote?.()}>
			<span>&#43;</span> Note Block
		</button>

		<!-- Font size control -->
		<div class="font-config">
			<span class="font-label">font</span>
			<div class="font-controls">
				<button
					class="font-btn"
					onclick={() => terminalConfig.setFontSize($terminalConfig.fontSize - 1)}
					disabled={$terminalConfig.fontSize <= terminalConfig.MIN}
				>−</button>
				<span class="font-value">{$terminalConfig.fontSize}</span>
				<button
					class="font-btn"
					onclick={() => terminalConfig.setFontSize($terminalConfig.fontSize + 1)}
					disabled={$terminalConfig.fontSize >= terminalConfig.MAX}
				>+</button>
			</div>
		</div>

		<!-- Keyboard shortcuts hint -->
		<div class="hints">
			<span><kbd>T</kbd> terminal</span>
			<span><kbd>N</kbd> note</span>
			<span><kbd>⌘Z</kbd> undo</span>
		</div>
	</div>
</aside>

<!-- Create Session Modal -->
{#if showCreateModal}
	<!-- Backdrop -->
	<div
		style="
			position: fixed;
			inset: 0;
			background: rgba(0,0,0,0.6);
			backdrop-filter: blur(2px);
			z-index: 1000;
			display: flex;
			align-items: center;
			justify-content: center;
		"
		role="dialog"
		aria-modal="true"
		onclick={(e) => { if (e.target === e.currentTarget) showCreateModal = false; }}
		onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
		tabindex="-1"
	>
		<div
			style="
				background: var(--surface);
				border: 1px solid var(--border);
				border-radius: 12px;
				padding: 24px;
				width: 340px;
				box-shadow: 0 24px 64px rgba(0,0,0,0.5);
			"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Enter' && createSession()}
			role="presentation"
		>
			<div style="margin-bottom: 20px;">
				<h2
					style="
						margin: 0 0 4px;
						font-size: 16px;
						font-weight: 600;
						color: var(--text);
					"
				>
					New {createType} session
				</h2>
				<p style="margin: 0; font-size: 13px; color: var(--muted);">
					{createType === 'tmux' ? 'Creates a tmux session on the server' : 'Spawns a PTY shell'}
				</p>
			</div>

			<label style="display:block;margin-bottom:16px;">
				<span
					style="
						font-size: 11px;
						font-weight: 500;
						color: var(--muted);
						text-transform: uppercase;
						letter-spacing: 0.06em;
						display: block;
						margin-bottom: 6px;
					"
				>Session name</span>
				<input
					type="text"
					bind:value={createName}
					placeholder="dev-1"
					style="
						width: 100%;
						background: var(--surface2);
						border: 1px solid var(--border);
						border-radius: 6px;
						padding: 8px 12px;
						color: var(--text);
						font-family: var(--font-family-mono, monospace);
						font-size: 13px;
						outline: none;
						transition: border-color 0.1s ease;
					"
					onfocus={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = 'var(--accent)')}
					onblur={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)')}
					use:focusOnMount
				/>
			</label>

			<div style="display:flex;gap:8px;justify-content:flex-end;">
				<button
					onclick={() => (showCreateModal = false)}
					style="
						background: transparent;
						border: 1px solid var(--border);
						color: var(--muted);
						padding: 7px 16px;
						border-radius: 6px;
						font-size: 13px;
						cursor: pointer;
						transition: border-color 0.1s, color 0.1s;
					"
					onmouseenter={(e) => {
						const el = e.currentTarget as HTMLElement;
						el.style.borderColor = 'var(--muted)';
						el.style.color = 'var(--text)';
					}}
					onmouseleave={(e) => {
						const el = e.currentTarget as HTMLElement;
						el.style.borderColor = 'var(--border)';
						el.style.color = 'var(--muted)';
					}}
				>
					Cancel
				</button>
				<button
					onclick={createSession}
					disabled={creating || !createName.trim()}
					style="
						background: var(--accent);
						border: none;
						color: #fff;
						padding: 7px 16px;
						border-radius: 6px;
						font-size: 13px;
						font-weight: 500;
						cursor: pointer;
						opacity: {creating || !createName.trim() ? '0.5' : '1'};
						transition: background 0.1s ease;
					"
					onmouseenter={(e) => { if (!creating) (e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
				>
					{creating ? 'Creating...' : 'Create'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.sidebar-footer {
		padding: 10px 12px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.btn-note {
		width: 100%;
		background: transparent;
		border: 1px dashed var(--border);
		color: var(--muted);
		font-size: 12px;
		padding: 6px 10px;
		border-radius: 5px;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: inherit;
	}
	.btn-note:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.font-config {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.font-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #3a3a50;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.font-controls {
		display: flex;
		align-items: center;
		background: #1c1c22;
		border: 1px solid #2a2a35;
		border-radius: 5px;
		overflow: hidden;
	}
	.font-btn {
		background: transparent;
		border: none;
		color: #6b6b80;
		width: 24px;
		height: 22px;
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.1s, color 0.1s;
		font-family: 'JetBrains Mono', monospace;
	}
	.font-btn:hover:not(:disabled) { background: #2a2a35; color: #e8e8f0; }
	.font-btn:disabled { opacity: 0.3; cursor: default; }
	.font-value {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #9b9bb0;
		min-width: 22px;
		text-align: center;
		border-left: 1px solid #2a2a35;
		border-right: 1px solid #2a2a35;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.hints {
		display: flex;
		gap: 10px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #3a3a50;
	}
	.hints span { display: flex; align-items: center; gap: 3px; }
	kbd {
		background: #1c1c22;
		border: 1px solid #2a2a35;
		border-radius: 3px;
		padding: 0 4px;
		font-family: inherit;
		font-size: 9px;
		color: #6b6b80;
	}
</style>
