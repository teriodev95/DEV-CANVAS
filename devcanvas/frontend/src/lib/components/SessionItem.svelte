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
	<span class="badge" class:tmux={session.type === 'tmux'} class:ssh={session.type === 'ssh'}>{session.type}</span>
</div>

{#if menu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<ul class="ctx" style="left:{menu.x}px;top:{menu.y}px" onclick={(e) => e.stopPropagation()}>
		{#if ondelete}
			<li class="ctx-item danger" onclick={() => { menu = null; ondelete?.(); }}>
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
		padding: 0 10px;
		height: 34px;
		border-radius: 5px;
		cursor: pointer;
		user-select: none;
		transition: background 0.1s ease;
	}
	.item:hover {
		background: var(--surface2);
	}
	.item:focus-visible {
		outline: 2px solid rgba(124, 92, 252, 0.35);
		outline-offset: -1px;
	}

	.name {
		flex: 1;
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.1s ease;
	}
	.item:hover .name {
		color: var(--text);
	}

	.badge {
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		letter-spacing: 0.04em;
		padding: 2px 5px;
		border-radius: 3px;
		flex-shrink: 0;
		color: #3dd68c;
		background: rgba(61, 214, 140, 0.07);
		border: 1px solid rgba(61, 214, 140, 0.15);
	}
	.badge.tmux {
		color: #8b6ff5;
		background: rgba(124, 92, 252, 0.07);
		border-color: rgba(124, 92, 252, 0.18);
	}
	.badge.ssh {
		color: #38bdf8;
		background: rgba(56, 189, 248, 0.07);
		border-color: rgba(56, 189, 248, 0.18);
	}

	/* Context menu */
	.ctx {
		position: fixed;
		z-index: 1000;
		margin: 0;
		padding: 4px;
		list-style: none;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		min-width: 148px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
	}

	.ctx-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.1s ease;
	}
	.ctx-item.danger {
		color: #e05454;
	}
	.ctx-item.danger:hover {
		background: rgba(255, 85, 85, 0.08);
		color: #ff6a6a;
	}
</style>
