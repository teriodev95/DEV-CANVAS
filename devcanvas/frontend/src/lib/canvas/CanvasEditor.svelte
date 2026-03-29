<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SvelteFlow, Background, Controls, BackgroundVariant } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import TerminalNode from './TerminalNode.svelte';
	import NoteNode from './NoteNode.svelte';
	import type { Node, Edge, NodeTypes } from '@xyflow/svelte';

	interface Props {
		workspaceId: string;
		onSave?: (nodes: Node[], edges: Edge[]) => void;
	}

	let { workspaceId, onSave }: Props = $props();

	const nodeTypes: NodeTypes = {
		terminal: TerminalNode,
		note: NoteNode,
	};

	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);
	let saveTimer: ReturnType<typeof setTimeout>;

	// ─── Undo history ───────────────────────────────────────────────────────────
	// Plain arrays — not reactive, UI doesn't depend on them
	let history: Array<{ nodes: Node[]; edges: Edge[] }> = [];
	let historyIndex = -1;
	const MAX_HISTORY = 50;

	function cloneState(): { nodes: Node[]; edges: Edge[] } {
		return {
			nodes: nodes.map((n) => ({
				...n,
				position: { ...n.position },
				data: { ...n.data },
			})),
			edges: [...edges],
		};
	}

	function pushHistory() {
		// Drop any redo branch above current index
		history = history.slice(0, historyIndex + 1);
		history.push(cloneState());
		if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
		historyIndex = history.length - 1;
	}

	function undo() {
		if (historyIndex <= 0) return;
		historyIndex--;
		const snap = history[historyIndex];
		nodes = snap.nodes;
		edges = snap.edges;
		scheduleSave();
	}

	// ─── Save ───────────────────────────────────────────────────────────────────
	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => onSave?.(nodes, edges), 2000);
	}

	// ─── Drag end → push history ────────────────────────────────────────────────
	function handleDragStop() {
		pushHistory();
		scheduleSave();
	}

	// ─── Resize end → push history (debounced) ──────────────────────────────────
	let resizeTimer: ReturnType<typeof setTimeout>;
	function handleNodesChange(e: CustomEvent) {
		const changes: any[] = e.detail ?? [];
		const hasResize = changes.some((c: any) => c.type === 'dimensions');
		if (hasResize) {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				pushHistory();
				scheduleSave();
			}, 200);
		}
	}

	// ─── Remove node ────────────────────────────────────────────────────────────
	function handleRemoveNode(e: Event) {
		const { id } = (e as CustomEvent).detail;
		nodes = nodes.filter((n) => n.id !== id);
		pushHistory();
		scheduleSave();
	}

	// ─── Update node data (color / icon) ────────────────────────────────────────
	function handleUpdateNode(e: Event) {
		const { id, data } = (e as CustomEvent).detail;
		nodes = nodes.map((n) => (n.id === id ? { ...n, data } : n));
		scheduleSave();
	}

	// ─── Keyboard: Ctrl/Cmd+Z ───────────────────────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		}
	}

	onMount(() => {
		window.addEventListener('devcanvas:remove-node', handleRemoveNode);
		window.addEventListener('devcanvas:update-node', handleUpdateNode);
		window.addEventListener('keydown', handleKeydown);
		// Capture initial empty state
		pushHistory();
	});

	onDestroy(() => {
		window.removeEventListener('devcanvas:remove-node', handleRemoveNode);
		window.removeEventListener('devcanvas:update-node', handleUpdateNode);
		window.removeEventListener('keydown', handleKeydown);
	});

	// ─── Public API ─────────────────────────────────────────────────────────────
	export function addTerminalNode(sessionId: string, sessionName: string, sessionType: string) {
		if (nodes.find((n) => n.id === `terminal-${sessionId}`)) return;
		nodes = [
			...nodes,
			{
				id: `terminal-${sessionId}`,
				type: 'terminal',
				position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 30 },
				data: { sessionId, sessionName, sessionType },
				style: 'width:660px;height:440px;',
				resizing: true,
			},
		];
		pushHistory();
		scheduleSave();
	}

	export function addNoteNode() {
		nodes = [
			...nodes,
			{
				id: `note-${Date.now()}`,
				type: 'note',
				position: { x: 120 + nodes.length * 25, y: 120 + nodes.length * 25 },
				data: { content: '' },
				style: 'width:280px;height:200px;',
				resizing: true,
			},
		];
		pushHistory();
		scheduleSave();
	}

	export function loadSnapshot(snapshot: { nodes: Node[]; edges: Edge[] }) {
		nodes = snapshot.nodes ?? [];
		edges = snapshot.edges ?? [];
		// Reset history to the loaded state as base
		history = [cloneState()];
		historyIndex = 0;
	}

	export function getSnapshot() {
		return { nodes, edges };
	}
</script>

<div class="wrap">
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		fitView
		minZoom={0.2}
		maxZoom={2}
		deleteKeyCode={null}
		snapToGrid={true}
		snapGrid={[12, 12]}
		nodesDraggable={true}
		nodesConnectable={false}
		panOnDrag={[1, 2]}
		connectionMode="loose"
		on:nodedragstop={handleDragStop}
		on:nodeschange={handleNodesChange}
	>
		<Background
			variant={BackgroundVariant.Dots}
			bgColor="#0d0d0f"
			patternColor="#2a2a35"
			gap={24}
			size={1.5}
		/>
		<Controls position="bottom-right" />
	</SvelteFlow>

	{#if nodes.length === 0}
		<div class="empty">
			<p>Arrastra sesiones desde el sidebar</p>
			<p><kbd>T</kbd> terminal &nbsp;·&nbsp; <kbd>N</kbd> nota &nbsp;·&nbsp; <kbd>⌘Z</kbd> deshacer</p>
		</div>
	{/if}
</div>

<style>
	.wrap {
		width: 100%;
		height: 100%;
		position: relative;
	}

	:global(.svelte-flow) { background: #0d0d0f; }
	:global(.svelte-flow__controls) {
		background: #141418;
		border: 1px solid #2a2a35;
		border-radius: 8px;
		overflow: hidden;
	}
	:global(.svelte-flow__controls-button) {
		background: #141418;
		border-bottom: 1px solid #2a2a35;
		fill: #6b6b80;
	}
	:global(.svelte-flow__controls-button:hover) {
		background: #1c1c22;
		fill: #e8e8f0;
	}
	:global(.svelte-flow__node.selected > *) {
		box-shadow: 0 0 0 1px #7c5cfc55 !important;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #6b6b80;
		font-size: 13px;
		pointer-events: none;
		user-select: none;
		gap: 6px;
	}
	.empty p { margin: 0; }
	kbd {
		background: #1c1c22;
		border: 1px solid #2a2a35;
		border-radius: 4px;
		padding: 1px 6px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #9575ff;
	}
</style>
