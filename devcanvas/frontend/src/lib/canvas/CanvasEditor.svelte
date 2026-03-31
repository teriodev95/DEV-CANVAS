<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { SvelteFlow, Background, Controls, BackgroundVariant, ConnectionMode } from '@xyflow/svelte';
	import { PanOnScrollMode, type Viewport } from '@xyflow/system';
	import '@xyflow/svelte/dist/style.css';
	import TerminalNode from './TerminalNode.svelte';
	import NoteNode from './NoteNode.svelte';
	import TaskBoardNode from './TaskBoardNode.svelte';
	import FlowViewportController from './FlowViewportController.svelte';
	import type { Node, Edge, NodeTypes } from '@xyflow/svelte';
	import {
		TERMINAL_FOCUS_EVENT,
		TERMINAL_INTERACTION_EVENT,
		activeTerminalNodeId,
		resetTerminalNavigation,
		terminalQuickSlots,
		fullscreenTerminal,
		isFullscreen,
		type TerminalFocusOrigin,
	} from '$lib/terminal/navigation';
	import {
		detectApplePlatform,
		getTerminalCycleShortcutLabel,
		getTerminalSlotShortcutLabel,
	} from '$lib/utils/shortcuts';

	interface Props {
		workspaceId: string;
		onSave?: (snapshot: CanvasSnapshot) => void;
	}

	export type CanvasSnapshot = {
		nodes: Node[];
		edges: Edge[];
		viewport?: Viewport | null;
	};

	let { workspaceId, onSave }: Props = $props();

	const nodeTypes: NodeTypes = {
		terminal: TerminalNode,
		note: NoteNode,
		'task-board': TaskBoardNode,
	};

	const TERMINAL_DRAG_HANDLE = '.terminal-drag-handle';
	const TASK_BOARD_DRAG_HANDLE = '.task-board-drag-handle';
	const LEGACY_TASK_BOARD_NODE_ID = 'task-board';
	const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

	function taskBoardNodeId(wsId: string = workspaceId) {
		return `task-board-${wsId}`;
	}

	function isTaskBoardNode(node: Node): boolean {
		return node.type === 'task-board' || node.id === LEGACY_TASK_BOARD_NODE_ID || node.id.startsWith('task-board-');
	}

	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);
	let saveTimer: ReturnType<typeof setTimeout>;
	let viewport = $state<Viewport>(DEFAULT_VIEWPORT);
	let viewportController:
		| {
				focusNode: (nodeId: string) => Promise<boolean>;
				restoreViewport: (viewport: Viewport) => Promise<boolean>;
				fitToContent: () => Promise<boolean>;
				readViewport: () => Viewport;
				screenToFlow: (point: { x: number; y: number }) => { x: number; y: number };
				zoomIn: () => void;
				zoomOut: () => void;
				zoomReset: () => void;
		  }
		| undefined = $state();
	let activeNodeId = $state<string | null>(null);
	let isApplePlatform = $state(false);
	let terminalMru: string[] = [];
	let quickSlotSignature = '';
	const slotShortcutHint = $derived(getTerminalSlotShortcutLabel(1, isApplePlatform));
	const cycleShortcutHint = $derived(getTerminalCycleShortcutLabel(isApplePlatform));

	// ─── Placement mode ─────────────────────────────────────────────────────────
	type PlacementMode = 'note' | null;
	let placementMode = $state<PlacementMode>(null);
	let ghostScreenPos = $state<{ x: number; y: number } | null>(null);

	// ─── Undo history ───────────────────────────────────────────────────────────
	// Plain arrays — not reactive, UI doesn't depend on them
	let history: Array<{ nodes: Node[]; edges: Edge[] }> = [];
	let historyIndex = -1;
	const MAX_HISTORY = 50;

	function decorateNode(node: Node): Node {
		if (node.type === 'terminal') {
			return {
				...node,
				draggable: node.draggable ?? true,
				dragHandle: TERMINAL_DRAG_HANDLE,
			};
		}

		if (node.type === 'task-board') {
			const correctId = taskBoardNodeId();
			return {
				...node,
				id: correctId,
				draggable: node.draggable ?? true,
				dragHandle: TASK_BOARD_DRAG_HANDLE,
				data: {
					...node.data,
					workspaceId,
				},
			};
		}

		return node;
	}

	function cloneState(): { nodes: Node[]; edges: Edge[] } {
		return {
			nodes: nodes.map((n) =>
				decorateNode({
					...n,
					position: { ...n.position },
					data: { ...n.data },
				})
			),
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
	function buildSnapshot(): CanvasSnapshot {
		return {
			nodes,
			edges,
			viewport,
		};
	}

	function runSave() {
		clearTimeout(saveTimer);
		onSave?.(buildSnapshot());
	}

	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => runSave(), 2000);
	}

	function getTerminalNodeIds() {
		return nodes.filter((node) => node.type === 'terminal').map((node) => node.id);
	}

	function setTerminalSelection(targetId: string) {
		let changed = false;
		const nextNodes = nodes.map((node) => {
			const nextSelected = node.type === 'terminal' ? node.id === targetId : false;
			if (!!node.selected === nextSelected) return node;
			changed = true;
			return { ...node, selected: nextSelected };
		});

		if (changed) nodes = nextNodes;
	}

	function rememberTerminal(nodeId: string) {
		const terminalIds = getTerminalNodeIds();
		if (!terminalIds.includes(nodeId)) return;

		activeNodeId = nodeId;
		activeTerminalNodeId.set(nodeId);
		terminalMru = [nodeId, ...terminalMru.filter((id) => id !== nodeId && terminalIds.includes(id))];

		for (const id of terminalIds) {
			if (!terminalMru.includes(id)) terminalMru.push(id);
		}
	}

	function syncTerminalNavigation() {
		const terminalIds = getTerminalNodeIds();
		const quickSlots = Object.fromEntries(
			terminalIds.slice(0, 9).map((nodeId, index) => [nodeId, index + 1])
		);
		const nextSignature = terminalIds.slice(0, 9).join('|');

		if (nextSignature !== quickSlotSignature) {
			quickSlotSignature = nextSignature;
			terminalQuickSlots.set(quickSlots);
		}

		terminalMru = terminalMru.filter((id) => terminalIds.includes(id));
		for (const id of terminalIds) {
			if (!terminalMru.includes(id)) terminalMru.push(id);
		}

		if (activeNodeId && !terminalIds.includes(activeNodeId)) {
			activeNodeId = terminalMru[0] ?? terminalIds[0] ?? null;
			activeTerminalNodeId.set(activeNodeId);
		}

		if (!activeNodeId && terminalIds.length === 0) {
			activeTerminalNodeId.set(null);
		}
	}

	function isEditableTarget(target: EventTarget | null) {
		return target instanceof HTMLElement &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
	}

	function isTerminalTarget(target: EventTarget | null) {
		return target instanceof Element &&
			!!target.closest('.terminal-pane, .terminal-host, .xterm, .xterm-helper-textarea');
	}

	async function activateTerminalNode(nodeId: string, origin: TerminalFocusOrigin) {
		if (!getTerminalNodeIds().includes(nodeId)) return;

		rememberTerminal(nodeId);
		setTerminalSelection(nodeId);

		window.dispatchEvent(
			new CustomEvent(TERMINAL_FOCUS_EVENT, {
				detail: { id: nodeId, origin },
			})
		);

		await viewportController?.focusNode(nodeId);
	}

	function cycleTerminal(direction: 1 | -1) {
		const terminalIds = getTerminalNodeIds();
		if (terminalIds.length === 0) return;

		const ordered = [
			...terminalMru.filter((id) => terminalIds.includes(id)),
			...terminalIds.filter((id) => !terminalMru.includes(id)),
		];

		if (ordered.length === 0) return;

		const currentId = activeNodeId && ordered.includes(activeNodeId) ? activeNodeId : ordered[0];
		const currentIndex = ordered.indexOf(currentId);
		const nextIndex = (currentIndex + direction + ordered.length) % ordered.length;
		void activateTerminalNode(ordered[nextIndex], 'cycle');
	}

	function handleTerminalInteraction(event: Event) {
		const nodeId = (event as CustomEvent<{ id?: string }>).detail?.id;
		if (!nodeId) return;
		rememberTerminal(nodeId);
	}

	// ─── Placement mode ─────────────────────────────────────────────────────────
	export function startNotePlacement() {
		placementMode = 'note';
		ghostScreenPos = null;
	}

	function cancelPlacement() {
		placementMode = null;
		ghostScreenPos = null;
	}

	function handlePlacementMouseMove(event: MouseEvent) {
		if (!placementMode) return;
		ghostScreenPos = { x: event.clientX, y: event.clientY };
	}

	function handlePaneClick({ event }: { event: MouseEvent }) {
		if (!placementMode || !viewportController) return;
		const flowPos = viewportController.screenToFlow({ x: event.clientX, y: event.clientY });
		if (placementMode === 'note') {
			addNoteNodeAt(flowPos.x, flowPos.y);
		}
		cancelPlacement();
	}

	// ─── Drag end → push history ────────────────────────────────────────────────
	function handleDragStop() {
		pushHistory();
		scheduleSave();
	}

	function handleMoveEnd() {
		viewport = viewportController?.readViewport() ?? viewport;
		scheduleSave();
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
		nodes = nodes.map((n) => (n.id === id ? decorateNode({ ...n, data }) : n));
		scheduleSave();
	}

	function handleAddTerminalEvent(e: Event) {
		const detail = (e as CustomEvent<{ sessionId?: string; sessionName?: string; sessionType?: string }>).detail;
		if (!detail?.sessionId || !detail.sessionName || !detail.sessionType) return;
		addTerminalNode(detail.sessionId, detail.sessionName, detail.sessionType);
	}

	function handleAddTaskBoardEvent() {
		void addTaskBoardNode();
	}

	// ─── Keyboard: Ctrl/Cmd+Z ───────────────────────────────────────────────────
	function enterFullscreenForNode(nodeId: string) {
		const node = nodes.find((n) => n.id === nodeId && n.type === 'terminal');
		if (!node) return;
		const d = node.data as { sessionId: string; sessionName: string; sessionType: string };
		fullscreenTerminal.set({
			nodeId,
			sessionId: d.sessionId,
			sessionName: d.sessionName,
			sessionType: d.sessionType,
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		// Skip all canvas shortcuts while fullscreen is active
		if (isFullscreen()) return;

		const target = e.target as HTMLElement;
		const editableTarget = isEditableTarget(target);
		const terminalTarget = isTerminalTarget(target);
		const primaryModifierPressed = isApplePlatform
			? e.metaKey && !e.ctrlKey
			: e.ctrlKey && !e.metaKey;

		// Cmd+Enter → enter fullscreen for active terminal
		if (primaryModifierPressed && e.key === 'Enter' && !e.altKey && !e.shiftKey) {
			if (editableTarget && !terminalTarget) return;
			const targetId = activeNodeId ?? getTerminalNodeIds()[0];
			if (!targetId) return;
			e.preventDefault();
			enterFullscreenForNode(targetId);
			return;
		}

		if (primaryModifierPressed && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
			if (editableTarget && !terminalTarget) return;
			const targetNodeId = getTerminalNodeIds()[Number(e.key) - 1];
			if (!targetNodeId) return;
			e.preventDefault();
			void activateTerminalNode(targetNodeId, 'slot');
			return;
		}

		if (isApplePlatform) {
			if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
				if (editableTarget && !terminalTarget) return;

				if (e.key === ']' || e.code === 'BracketRight') {
					e.preventDefault();
					cycleTerminal(1);
					return;
				}

				if (e.key === '[' || e.code === 'BracketLeft') {
					e.preventDefault();
					cycleTerminal(-1);
					return;
				}
			}
		} else if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
			if (editableTarget && !terminalTarget) return;
			e.preventDefault();
			cycleTerminal(e.shiftKey ? -1 : 1);
			return;
		}

		// Cmd+= / Cmd+- / Cmd+0 → canvas zoom
		if (primaryModifierPressed && !e.altKey && !e.shiftKey) {
			if (e.key === '=' || e.key === '+') {
				e.preventDefault();
				viewportController?.zoomIn();
				return;
			}
			if (e.key === '-') {
				e.preventDefault();
				viewportController?.zoomOut();
				return;
			}
			if (e.key === '0') {
				e.preventDefault();
				viewportController?.zoomReset();
				return;
			}
		}

		// Esc cancels placement mode
		if (e.key === 'Escape' && placementMode) {
			e.preventDefault();
			cancelPlacement();
			return;
		}

		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		}
	}

	$effect(() => {
		nodes;
		syncTerminalNavigation();
	});

	onMount(() => {
		isApplePlatform = detectApplePlatform();
		window.addEventListener('devcanvas:remove-node', handleRemoveNode);
		window.addEventListener('devcanvas:update-node', handleUpdateNode);
		window.addEventListener('devcanvas:add-terminal-node', handleAddTerminalEvent);
		window.addEventListener('devcanvas:add-task-board', handleAddTaskBoardEvent);
		window.addEventListener(TERMINAL_INTERACTION_EVENT, handleTerminalInteraction);
		window.addEventListener('keydown', handleKeydown, true);
		// Capture initial empty state
		pushHistory();
	});

	onDestroy(() => {
		clearTimeout(saveTimer);
		window.removeEventListener('devcanvas:remove-node', handleRemoveNode);
		window.removeEventListener('devcanvas:update-node', handleUpdateNode);
		window.removeEventListener('devcanvas:add-terminal-node', handleAddTerminalEvent);
		window.removeEventListener('devcanvas:add-task-board', handleAddTaskBoardEvent);
		window.removeEventListener('keydown', handleKeydown, true);
		window.removeEventListener(TERMINAL_INTERACTION_EVENT, handleTerminalInteraction);
		resetTerminalNavigation();
	});

	// ─── Public API ─────────────────────────────────────────────────────────────
	export function addTerminalNode(sessionId: string, sessionName: string, sessionType: string) {
		if (nodes.find((n) => n.id === `terminal-${sessionId}`)) return;
		const nextNode: Node = {
			id: `terminal-${sessionId}`,
			type: 'terminal',
			position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 30 },
			data: { sessionId, sessionName, sessionType },
			style: 'width:660px;height:440px;',
			draggable: true,
			dragHandle: TERMINAL_DRAG_HANDLE,
		};
		nodes = [
			...nodes,
			decorateNode(nextNode),
		];
		pushHistory();
		scheduleSave();
	}

	export async function addTaskBoardNode() {
		const boardId = taskBoardNodeId();
		const existing = nodes.find((node) => isTaskBoardNode(node));
		if (existing) {
			await viewportController?.focusNode(existing.id);
			return;
		}

		const nextNode: Node = {
			id: boardId,
			type: 'task-board',
			position: { x: 160, y: 120 },
			data: { workspaceId },
			style: 'width:1120px;height:680px;',
			draggable: true,
			dragHandle: TASK_BOARD_DRAG_HANDLE,
		};

		nodes = [...nodes, decorateNode(nextNode)];
		pushHistory();
		scheduleSave();
		await tick();
		await viewportController?.focusNode(boardId);
	}

	function addNoteNodeAt(x: number, y: number) {
		const nextNode: Node = {
			id: `note-${Date.now()}`,
			type: 'note',
			position: { x, y },
			data: { content: '' },
			style: 'width:280px;height:200px;',
		};
		nodes = [
			...nodes,
			nextNode,
		];
		pushHistory();
		scheduleSave();
	}

	export function addNoteNode() {
		startNotePlacement();
	}

	export async function loadSnapshot(snapshot: CanvasSnapshot) {
		nodes = (snapshot.nodes ?? []).map((node) => decorateNode(node));
		edges = snapshot.edges ?? [];
		viewport = snapshot.viewport ?? DEFAULT_VIEWPORT;
		activeNodeId = null;
		terminalMru = [];
		quickSlotSignature = '';
		resetTerminalNavigation();
		// Reset history to the loaded state as base
		history = [cloneState()];
		historyIndex = 0;

		await tick();

		if (snapshot.viewport) {
			await viewportController?.restoreViewport(snapshot.viewport);
			viewport = viewportController?.readViewport() ?? snapshot.viewport;
			return;
		}

		if (nodes.length > 0) {
			await viewportController?.fitToContent();
			viewport = viewportController?.readViewport() ?? viewport;
			scheduleSave();
		}
	}

	export function getSnapshot(): CanvasSnapshot {
		return buildSnapshot();
	}

	export function cancelPendingSave() {
		clearTimeout(saveTimer);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="w-full h-full"
	class:placement-active={!!placementMode}
	style="--flow-zoom:{viewport.zoom}"
	onmousemove={handlePlacementMouseMove}
>
	<SvelteFlow
		bind:nodes
		bind:edges
		bind:viewport
		{nodeTypes}
		minZoom={0.2}
		maxZoom={2}
		deleteKey={null}
		snapGrid={[12, 12]}
		nodesDraggable={true}
		nodesConnectable={false}
		panOnDrag={[1, 2]}
		panOnScroll={true}
		panOnScrollMode={PanOnScrollMode.Free}
		zoomOnScroll={false}
		zoomOnPinch={true}
		noWheelClass="nowheel"
		noPanClass="nopan"
		connectionMode={ConnectionMode.Loose}
		onmoveend={handleMoveEnd}
		onnodedragstop={handleDragStop}
		onpaneclick={handlePaneClick}
	>
		<FlowViewportController bind:this={viewportController} />

		<Background
			variant={BackgroundVariant.Dots}
			bgColor="#0d0d0f"
			patternColor="#2a2a35"
			gap={24}
			size={1.5}
		/>
		<Controls position="bottom-right" />
	</SvelteFlow>

	{#if nodes.length === 0 && !placementMode}
		<div class="absolute inset-0 flex flex-col items-center justify-center text-[#6b6b80] text-[13px] pointer-events-none select-none gap-1.5">
			<p class="m-0">Arrastra sesiones desde el sidebar</p>
			<p class="m-0"><kbd class="bg-[#1c1c22] border border-[#2a2a35] rounded px-1.5 py-px font-mono text-[11px] text-[#9575ff]">T</kbd> terminal &nbsp;·&nbsp; <kbd class="bg-[#1c1c22] border border-[#2a2a35] rounded px-1.5 py-px font-mono text-[11px] text-[#9575ff]">N</kbd> nota &nbsp;·&nbsp; <kbd class="bg-[#1c1c22] border border-[#2a2a35] rounded px-1.5 py-px font-mono text-[11px] text-[#9575ff]">{slotShortcutHint}</kbd> terminal &nbsp;·&nbsp; <kbd class="bg-[#1c1c22] border border-[#2a2a35] rounded px-1.5 py-px font-mono text-[11px] text-[#9575ff]">{cycleShortcutHint}</kbd> iterar</p>
		</div>
	{/if}

	{#if placementMode && ghostScreenPos}
		<div
			class="placement-ghost"
			style="left:{ghostScreenPos.x}px;top:{ghostScreenPos.y}px"
		>
			<div class="placement-ghost-card">
				<div class="placement-ghost-accent"></div>
				<span class="placement-ghost-text">// notes...</span>
			</div>
			<span class="placement-ghost-hint">clic para colocar · esc cancelar</span>
		</div>
	{/if}
</div>

<style>
	:global(.svelte-flow) { background: #0d0d0f; }

	:global(.svelte-flow__controls) {
		background: rgba(20, 20, 28, 0.75);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
	}

	:global(.svelte-flow__controls-button) {
		background: transparent;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		fill: #6b6b80;
		transition: background 0.12s ease, fill 0.12s ease;
	}

	:global(.svelte-flow__controls-button:hover) {
		background: rgba(255, 255, 255, 0.06);
		fill: #e8e8f0;
	}

	:global(.svelte-flow__controls-button:last-child) {
		border-bottom: none;
	}

	:global(.svelte-flow__node.selected > *) {
		box-shadow: 0 0 0 1px #7c5cfc55 !important;
	}

	/* ─── Placement mode ─────────────────────────────────────────── */
	.placement-active {
		cursor: crosshair;
	}

	.placement-active :global(.svelte-flow__pane) {
		cursor: crosshair;
	}

	.placement-ghost {
		position: fixed;
		pointer-events: none;
		z-index: 50;
		transform: translate(16px, 16px);
		display: flex;
		flex-direction: column;
		gap: 6px;
		animation: ghost-in 120ms ease-out;
	}

	@keyframes ghost-in {
		from { opacity: 0; transform: translate(16px, 20px); }
		to   { opacity: 1; transform: translate(16px, 16px); }
	}

	.placement-ghost-card {
		width: 200px;
		height: 120px;
		background: rgba(20, 20, 24, 0.72);
		border: 1px solid rgba(149, 117, 255, 0.28);
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-shadow:
			0 12px 32px rgba(0, 0, 0, 0.3),
			0 0 0 1px rgba(124, 92, 252, 0.12);
		backdrop-filter: blur(8px);
	}

	.placement-ghost-accent {
		height: 2px;
		background: #f1c40f;
		flex-shrink: 0;
	}

	.placement-ghost-text {
		padding: 10px 12px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: rgba(42, 42, 53, 0.8);
	}

	.placement-ghost-hint {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #6b6b80;
		white-space: nowrap;
		padding: 3px 8px;
		background: rgba(20, 20, 28, 0.78);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		width: fit-content;
		backdrop-filter: blur(6px);
	}
</style>
