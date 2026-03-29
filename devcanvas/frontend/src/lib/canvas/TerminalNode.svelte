<script lang="ts">
	import { Handle, Position, NodeResizer } from '@xyflow/svelte';

	interface Props {
		id: string;
		selected?: boolean;
		data: {
			sessionId: string;
			sessionName: string;
			sessionType: string;
			color?: string;
			icon?: string;
		};
	}

	let { id, selected = false, data }: Props = $props();

	let menu = $state<{ x: number; y: number } | null>(null);
	let interacting = $state(false);

	// ── Palette ──────────────────────────────────────────────────────────────
	const COLORS: { key: string; bar: string; dot: string; glow: string; border: string }[] = [
		{ key: '',        bar: '#141418', dot: '#3dd68c', glow: '#3dd68c66', border: '#2a2a35' },
		{ key: 'indigo',  bar: '#18152a', dot: '#9575ff', glow: '#9575ff55', border: '#3a2a55' },
		{ key: 'blue',    bar: '#101d2e', dot: '#5aa8ff', glow: '#5aa8ff55', border: '#1e3555' },
		{ key: 'emerald', bar: '#0e1e18', dot: '#3dd68c', glow: '#3dd68c55', border: '#1a3a28' },
		{ key: 'amber',   bar: '#201c0e', dot: '#f5a623', glow: '#f5a62355', border: '#3a3010' },
		{ key: 'rose',    bar: '#201015', dot: '#ff6b80', glow: '#ff6b8055', border: '#3a1525' },
		{ key: 'sky',     bar: '#0e1e24', dot: '#22d3ee', glow: '#22d3ee55', border: '#103540' },
	];

	const ICONS: { key: string; label: string; char: string }[] = [
		{ key: '',     label: 'shell',    char: '❯' },
		{ key: 'git',  label: 'git',      char: '⎇' },
		{ key: 'node', label: 'node',     char: '⬡' },
		{ key: 'py',   label: 'python',   char: 'λ' },
		{ key: 'db',   label: 'database', char: '⊞' },
		{ key: 'dock', label: 'docker',   char: '◈' },
		{ key: 'proc', label: 'process',  char: '⊕' },
	];

	function getColor() {
		return COLORS.find((c) => c.key === (data.color ?? '')) ?? COLORS[0];
	}
	function getIcon() {
		return ICONS.find((i) => i.key === (data.icon ?? '')) ?? ICONS[0];
	}

	function setColor(key: string) {
		window.dispatchEvent(new CustomEvent('devcanvas:update-node', {
			detail: { id, data: { ...data, color: key } }
		}));
		menu = null;
	}

	function setIcon(key: string) {
		window.dispatchEvent(new CustomEvent('devcanvas:update-node', {
			detail: { id, data: { ...data, icon: key } }
		}));
		menu = null;
	}

	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		menu = { x: e.offsetX, y: e.offsetY };
	}

	function closeMenu() { menu = null; }

	function removeNode() {
		menu = null;
		window.dispatchEvent(new CustomEvent('devcanvas:remove-node', { detail: { id } }));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (interacting) interacting = false;
			else closeMenu();
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
<div
	class="node"
	oncontextmenu={onContextMenu}
	style="--bar-bg:{getColor().bar}; --dot-color:{getColor().dot}; --dot-glow:{getColor().glow}; --border-color:{getColor().border}"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="bar" onclick={() => (interacting = false)}>
		<span class="icon">{getIcon().char}</span>
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
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="overlay" onclick={() => (interacting = true)} title="Click to type"></div>
		{/if}
	</div>

	{#if menu}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="ctx-menu" style="left:{menu.x}px;top:{menu.y}px" onclick={(e) => e.stopPropagation()}>
			<!-- Color row -->
			<div class="ctx-section">
				{#each COLORS as c}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span
						class="swatch"
						class:active={( data.color ?? '') === c.key}
						style="background:{c.dot}; box-shadow: 0 0 0 2px {(data.color ?? '') === c.key ? c.dot : 'transparent'}, 0 0 0 3px #1c1c22"
						onclick={() => setColor(c.key)}
						title={c.key || 'default'}
					></span>
				{/each}
			</div>

			<!-- Icon row -->
			<div class="ctx-section icon-row">
				{#each ICONS as ic}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span
						class="icon-btn"
						class:active={(data.icon ?? '') === ic.key}
						onclick={() => setIcon(ic.key)}
						title={ic.label}
					>{ic.char}</span>
				{/each}
			</div>

			<div class="ctx-divider"></div>

			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="ctx-item danger" onclick={removeNode}>Cerrar ventana</div>
		</div>
	{/if}
</div>

<Handle type="source" position={Position.Right} style="opacity:0" />
<Handle type="target" position={Position.Left} style="opacity:0" />

<style>
	.node {
		width: 100%;
		height: 100%;
		background: #0d0d0f;
		border: 1px solid var(--border-color, #2a2a35);
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		position: relative;
		transition: border-color 0.2s;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 10px;
		background: var(--bar-bg, #141418);
		border-bottom: 1px solid var(--border-color, #2a2a35);
		cursor: grab;
		flex-shrink: 0;
		user-select: none;
		transition: background 0.2s;
	}

	.icon {
		font-size: 10px;
		color: var(--dot-color, #3dd68c);
		opacity: 0.7;
		flex-shrink: 0;
		line-height: 1;
		font-family: 'JetBrains Mono', monospace;
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #2a2a35;
		flex-shrink: 0;
	}
	.dot.active {
		background: var(--dot-color, #3dd68c);
		box-shadow: 0 0 5px var(--dot-glow, #3dd68c66);
		animation: pulse 2.5s infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50%       { opacity: 0.35; }
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
		z-index: 200;
		background: #1c1c22;
		border: 1px solid #2a2a35;
		border-radius: 8px;
		padding: 8px;
		box-shadow: 0 12px 32px #00000077;
		min-width: 160px;
	}

	.ctx-section {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0 6px;
	}

	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		cursor: pointer;
		flex-shrink: 0;
		transition: transform 0.1s;
	}
	.swatch:hover { transform: scale(1.3); }
	.swatch.active { transform: scale(1.25); }

	.icon-row { gap: 4px; }
	.icon-btn {
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-family: 'JetBrains Mono', monospace;
		border-radius: 4px;
		cursor: pointer;
		color: #6b6b80;
		background: transparent;
		transition: background 0.1s, color 0.1s;
	}
	.icon-btn:hover { background: #2a2a35; color: #e8e8f0; }
	.icon-btn.active { background: #2a2a35; color: var(--dot-color, #3dd68c); }

	.ctx-divider {
		height: 1px;
		background: #2a2a35;
		margin: 4px 0;
	}

	.ctx-item {
		padding: 6px 6px;
		font-size: 12px;
		border-radius: 4px;
		cursor: pointer;
		color: #9b9bb0;
		font-family: 'JetBrains Mono', monospace;
	}
	.ctx-item:hover { background: #2a2a35; color: #e8e8f0; }
	.ctx-item.danger { color: #ff6b80; }
	.ctx-item.danger:hover { background: rgba(255,107,128,0.08); }
</style>
