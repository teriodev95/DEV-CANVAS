<script lang="ts">
	import { Handle, Position, NodeResizer } from '@xyflow/svelte';

	interface Props {
		id: string;
		selected?: boolean;
		data: { sessionId: string; sessionName: string; sessionType: string };
	}

	let { id, selected = false, data }: Props = $props();

	let menu = $state<{ x: number; y: number } | null>(null);
	let interacting = $state(false);

	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		menu = { x: e.offsetX, y: e.offsetY };
	}

	function closeMenu() {
		menu = null;
	}

	function removeNode() {
		menu = null;
		window.dispatchEvent(new CustomEvent('devcanvas:remove-node', { detail: { id } }));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && interacting) {
			interacting = false;
		}
	}
</script>

<svelte:window onclick={closeMenu} onkeydown={onKeydown} />

<NodeResizer
	minWidth={320}
	minHeight={200}
	isVisible={selected}
	lineStyle="border: 1px dashed #7c5cfc55; border-radius: 8px;"
	handleStyle="background:#7c5cfc; border: 2px solid #0d0d0f; width: 10px; height: 10px; border-radius: 3px; cursor: nwse-resize;"
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="node" oncontextmenu={onContextMenu}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="bar" onclick={() => (interacting = false)}>
		<span class="dot active"></span>
		<span class="name">{data.sessionName}</span>
		<span class="type">{data.sessionType}</span>
		{#if interacting}
			<span class="hint">esc · drag</span>
		{/if}
	</div>

	<div class="body" class:nodrag={interacting} class:nopan={interacting}>
		<iframe
			src="/terminal/{data.sessionId}"
			title={data.sessionName}
			sandbox="allow-scripts allow-same-origin"
			scrolling="no"
		></iframe>

		{#if !interacting}
			<!-- Transparent overlay captures mouse for drag -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="overlay"
				onclick={() => (interacting = true)}
				title="Click to type"
			></div>
		{/if}
	</div>

	{#if menu}
		<ul class="ctx-menu" style="left:{menu.x}px;top:{menu.y}px">
			<li onclick={removeNode} class="danger">Cerrar ventana</li>
		</ul>
	{/if}
</div>

<Handle type="source" position={Position.Right} style="opacity:0" />
<Handle type="target" position={Position.Left} style="opacity:0" />

<style>
	.node {
		width: 100%;
		height: 100%;
		background: #0d0d0f;
		border: 1px solid #2a2a35;
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 10px;
		background: #141418;
		border-bottom: 1px solid #2a2a35;
		cursor: grab;
		flex-shrink: 0;
		user-select: none;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #2a2a35;
		flex-shrink: 0;
	}
	.dot.active {
		background: #3dd68c;
		box-shadow: 0 0 5px #3dd68c66;
		animation: pulse 2.5s infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50%       { opacity: 0.4; }
	}

	.name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #9b9bb0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.type {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #3a3a50;
		flex-shrink: 0;
	}

	.hint {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #4a4a60;
		flex-shrink: 0;
	}

	.body {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	iframe {
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}

	.overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		cursor: grab;
		background: transparent;
	}
	.overlay:hover::after {
		content: 'click to type';
		position: absolute;
		bottom: 8px;
		right: 10px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		color: #3a3a50;
		pointer-events: none;
	}

	/* Context menu */
	.ctx-menu {
		position: absolute;
		z-index: 100;
		background: #1c1c22;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		padding: 4px;
		margin: 0;
		list-style: none;
		min-width: 140px;
		box-shadow: 0 8px 24px #00000066;
	}

	.ctx-menu li {
		padding: 6px 10px;
		font-size: 12px;
		border-radius: 4px;
		cursor: pointer;
		color: #9b9bb0;
	}
	.ctx-menu li:hover { background: #2a2a35; color: #e8e8f0; }
	.ctx-menu li.danger { color: #ff5555; }
	.ctx-menu li.danger:hover { background: rgba(255,85,85,0.1); color: #ff5555; }
</style>
