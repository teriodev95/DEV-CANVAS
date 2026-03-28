<script lang="ts">
	import { Handle, Position, NodeResizer } from '@xyflow/svelte';

	interface Props {
		id: string;
		selected?: boolean;
		data: { content: string };
	}

	let { id, selected = false, data }: Props = $props();
	let content = $state(data.content ?? '');
	let menu = $state<{ x: number; y: number } | null>(null);

	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		menu = { x: e.offsetX, y: e.offsetY };
	}

	function removeNode() {
		menu = null;
		window.dispatchEvent(new CustomEvent('devcanvas:remove-node', { detail: { id } }));
	}
</script>

<svelte:window onclick={() => (menu = null)} />

<NodeResizer
	minWidth={180}
	minHeight={120}
	isVisible={selected}
	lineStyle="border: 1px dashed #f1c40f55; border-radius: 8px;"
	handleStyle="background:#f1c40f; border: 2px solid #0d0d0f; width: 10px; height: 10px; border-radius: 3px; cursor: nwse-resize;"
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="node" oncontextmenu={onContextMenu}>
	<div class="accent"></div>
	<textarea
		bind:value={content}
		placeholder="// notes..."
		spellcheck="false"
		oninput={() => { data.content = content; }}
	></textarea>

	{#if menu}
		<ul class="ctx-menu" style="left:{menu.x}px;top:{menu.y}px">
			<li onclick={removeNode} class="danger">Cerrar nota</li>
		</ul>
	{/if}
</div>

<Handle type="source" position={Position.Right} style="opacity:0" />
<Handle type="target" position={Position.Left} style="opacity:0" />

<style>
	.node {
		width: 100%;
		height: 100%;
		background: #141418;
		border: 1px solid #2a2a35;
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.accent {
		height: 2px;
		background: #f1c40f;
		flex-shrink: 0;
	}

	textarea {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		resize: none;
		color: #c8c8d8;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		line-height: 1.6;
		padding: 10px 12px;
		caret-color: #7c5cfc;
	}
	textarea::placeholder { color: #2a2a35; }

	.ctx-menu {
		position: absolute;
		z-index: 100;
		background: #1c1c22;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		padding: 4px;
		margin: 0;
		list-style: none;
		min-width: 130px;
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
