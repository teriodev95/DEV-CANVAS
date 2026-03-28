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

	<span class="badge" class:tmux={session.type === 'tmux'}>
		{session.type}
	</span>
</div>

{#if menu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<ul class="ctx" style="left:{menu.x}px;top:{menu.y}px" onclick={(e) => e.stopPropagation()}>
		{#if ondelete}
			<li class="danger" onclick={() => { menu = null; ondelete?.(); }}>Eliminar sesión</li>
		{/if}
	</ul>
{/if}

<style>
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.1s;
		user-select: none;
	}
	.item:hover { background: #1c1c22; }

	.name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		color: #c8c8d8;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge {
		font-size: 10px;
		font-family: 'JetBrains Mono', monospace;
		padding: 1px 5px;
		border-radius: 3px;
		flex-shrink: 0;
		background: rgba(61,214,140,0.08);
		color: #3dd68c;
		border: 1px solid rgba(61,214,140,0.2);
	}
	.badge.tmux {
		background: rgba(124,92,252,0.08);
		color: #9575ff;
		border-color: rgba(124,92,252,0.2);
	}

	.ctx {
		position: fixed;
		z-index: 1000;
		background: #1c1c22;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		padding: 4px;
		margin: 0;
		list-style: none;
		min-width: 140px;
		box-shadow: 0 8px 24px #00000066;
	}
	.ctx li {
		padding: 6px 10px;
		font-size: 12px;
		border-radius: 4px;
		cursor: pointer;
		color: #9b9bb0;
	}
	.ctx li:hover { background: #2a2a35; }
	.ctx li.danger { color: #ff5555; }
	.ctx li.danger:hover { background: rgba(255,85,85,0.1); }
</style>
