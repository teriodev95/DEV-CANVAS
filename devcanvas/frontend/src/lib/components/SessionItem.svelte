<script lang="ts">
	import StatusDot from './StatusDot.svelte';
	import type { Session } from '$lib/stores/sessions';

	type Props = {
		session: Session;
		onclick?: () => void;
		ondelete?: () => void;
	};

	let { session, onclick, ondelete }: Props = $props();

	let menu = $state<{ x: number; y: number } | null>(null);

	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY };
	}
</script>

<svelte:window onclick={() => (menu = null)} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="item"
	role="button"
	tabindex="0"
	onclick={onclick}
	onkeydown={(e) => e.key === 'Enter' && onclick?.()}
	oncontextmenu={onContextMenu}
>
	<StatusDot status={session.status === 'active' ? 'active' : 'idle'} />
	<span class="name">{session.name}</span>
	<span class="badge" class:tmux={session.type === 'tmux'}>{session.type}</span>
</div>

{#if menu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<ul class="ctx" style="left:{menu.x}px;top:{menu.y}px" onclick={(e) => e.stopPropagation()}>
		{#if ondelete}
			<li class="ctx-item danger" onclick={() => { menu = null; ondelete?.(); }}>
				<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="12" height="12">
					<path d="M2 4h12M5 4V2.5A1.5 1.5 0 016.5 1h3A1.5 1.5 0 0111 2.5V4M6 7v5M10 7v5M3 4l.8 9.2A1 1 0 004.8 14h6.4a1 1 0 001-.8L13 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				Delete session
			</li>
		{/if}
	</ul>
{/if}

<style>
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.12s ease;
		user-select: none;
		min-height: 38px;
	}
	.item:hover {
		background: var(--surface2);
	}
	.item:focus-visible {
		outline: 2px solid rgba(124, 92, 252, 0.4);
		outline-offset: -1px;
	}

	.name {
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		color: var(--text);
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0.85;
	}
	.item:hover .name {
		opacity: 1;
	}

	.badge {
		font-size: 10px;
		font-family: var(--font-family-mono, monospace);
		padding: 2px 6px;
		border-radius: 4px;
		flex-shrink: 0;
		letter-spacing: 0.02em;
		background: rgba(61, 214, 140, 0.08);
		color: #3dd68c;
		border: 1px solid rgba(61, 214, 140, 0.18);
	}
	.badge.tmux {
		background: rgba(124, 92, 252, 0.08);
		color: #9575ff;
		border-color: rgba(124, 92, 252, 0.2);
	}

	/* Context menu */
	.ctx {
		position: fixed;
		z-index: 1000;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 4px;
		margin: 0;
		list-style: none;
		min-width: 160px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03);
	}

	.ctx-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		border-radius: 5px;
		cursor: pointer;
		color: var(--muted);
		transition: background 0.1s ease, color 0.1s ease;
	}
	.ctx-item:hover {
		background: var(--border);
		color: var(--text);
	}
	.ctx-item.danger {
		color: #ff5555;
	}
	.ctx-item.danger:hover {
		background: rgba(255, 85, 85, 0.1);
		color: #ff6e6e;
	}
</style>
