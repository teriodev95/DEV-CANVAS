<script lang="ts">
	import { Handle, Position, NodeResizer } from '@xyflow/svelte';

	const NOTE_COLORS: { key: string; hex: string }[] = [
		{ key: 'yellow', hex: '#f1c40f' },
		{ key: 'violet', hex: '#9575ff' },
		{ key: 'pink', hex: '#ff6b9d' },
		{ key: 'green', hex: '#2ecc71' },
		{ key: 'blue', hex: '#5dade2' },
		{ key: 'neutral', hex: '#6b6b80' },
	];

	const MIN_FONT = 11;
	const MAX_FONT = 18;
	const DEFAULT_FONT = 12;
	const DEFAULT_COLOR = 'yellow';

	interface Props {
		id: string;
		selected?: boolean;
		data: { content: string; color?: string; fontSize?: number };
	}

	let { id, selected = false, data }: Props = $props();
	let confirmingDelete = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	// Local writable state for immediate textarea feedback; synced from data
	let editContent = $state('');
	$effect(() => { editContent = data.content ?? ''; });

	// Read-only derived values for toolbar display
	const color = $derived(data.color ?? DEFAULT_COLOR);
	const fontSize = $derived(data.fontSize ?? DEFAULT_FONT);
	const accentHex = $derived(NOTE_COLORS.find((c) => c.key === color)?.hex ?? NOTE_COLORS[0].hex);

	function updateNode(patch: Partial<{ content: string; color: string; fontSize: number }>) {
		window.dispatchEvent(
			new CustomEvent('devcanvas:update-node', {
				detail: { id, data: { ...data, ...patch } },
			})
		);
	}

	function setColor(key: string) {
		updateNode({ color: key });
	}

	function adjustFontSize(delta: number) {
		const next = Math.min(MAX_FONT, Math.max(MIN_FONT, fontSize + delta));
		if (next === fontSize) return;
		updateNode({ fontSize: next });
	}

	function handleDelete() {
		if (!confirmingDelete) {
			confirmingDelete = true;
			clearTimeout(confirmTimer);
			confirmTimer = setTimeout(() => (confirmingDelete = false), 2500);
			return;
		}
		clearTimeout(confirmTimer);
		confirmingDelete = false;
		window.dispatchEvent(new CustomEvent('devcanvas:remove-node', { detail: { id } }));
	}
</script>

<NodeResizer
	minWidth={180}
	minHeight={120}
	isVisible={selected}
	lineStyle="border: 1px dashed {accentHex}55; border-radius: 8px;"
	handleStyle="background:{accentHex}; border: 2px solid #0d0d0f; width: 10px; height: 10px; border-radius: 3px; cursor: nwse-resize;"
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="note-root">
	{#if selected}
		<div class="toolbar nopan nodrag nowheel">
			<div class="toolbar-group colors">
				{#each NOTE_COLORS as c}
					<button
						class="color-dot"
						class:active={color === c.key}
						style="--dot:{c.hex}"
						onclick={() => setColor(c.key)}
						title={c.key}
					></button>
				{/each}
			</div>

			<div class="toolbar-sep"></div>

			<div class="toolbar-group font-size">
				<button
					class="font-btn"
					disabled={fontSize <= MIN_FONT}
					onclick={() => adjustFontSize(-1)}
					title="Reducir fuente"
				>A-</button>
				<span class="font-label">{fontSize}</span>
				<button
					class="font-btn"
					disabled={fontSize >= MAX_FONT}
					onclick={() => adjustFontSize(1)}
					title="Aumentar fuente"
				>A+</button>
			</div>

			<div class="toolbar-sep"></div>

			<button
				class="delete-btn"
				class:confirming={confirmingDelete}
				onclick={handleDelete}
				title="Eliminar nota"
			>
				{confirmingDelete ? 'Confirmar?' : '✕'}
			</button>
		</div>
	{/if}

	<div class="node">
		<div class="accent" style="background:{accentHex}"></div>
		<textarea
			bind:value={editContent}
			placeholder="// notes..."
			spellcheck="false"
			style="font-size:{fontSize}px"
			oninput={() => updateNode({ content: editContent })}
		></textarea>
	</div>
</div>

<Handle type="source" position={Position.Right} style="opacity:0" />
<Handle type="target" position={Position.Left} style="opacity:0" />

<style>
	.note-root {
		width: 100%;
		height: 100%;
		position: relative;
	}

	/* ─── Floating toolbar ─────────────────────────────────────────── */
	.toolbar {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		background: rgba(20, 20, 28, 0.82);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
		white-space: nowrap;
		animation: toolbar-in 0.15s ease-out;
		z-index: 50;
	}

	@keyframes toolbar-in {
		from { opacity: 0; transform: translateX(-50%) translateY(4px); }
		to   { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.toolbar-sep {
		width: 1px;
		height: 16px;
		background: rgba(255, 255, 255, 0.08);
		flex-shrink: 0;
	}

	/* ─── Color dots ───────────────────────────────────────────────── */
	.color-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid transparent;
		background: var(--dot);
		cursor: pointer;
		padding: 0;
		transition: border-color 0.12s ease, transform 0.12s ease;
	}
	.color-dot:hover { transform: scale(1.2); }
	.color-dot.active { border-color: #e8e8f0; }

	/* ─── Font size ────────────────────────────────────────────────── */
	.font-btn {
		background: transparent;
		border: none;
		color: #9b9bb0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 5px;
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}
	.font-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); color: #e8e8f0; }
	.font-btn:disabled { opacity: 0.3; cursor: default; }

	.font-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #6b6b80;
		min-width: 18px;
		text-align: center;
	}

	/* ─── Delete ───────────────────────────────────────────────────── */
	.delete-btn {
		background: transparent;
		border: none;
		color: #6b6b80;
		font-size: 12px;
		padding: 2px 6px;
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}
	.delete-btn:hover { background: rgba(255, 85, 85, 0.1); color: #ff5555; }
	.delete-btn.confirming {
		color: #ff5555;
		font-size: 11px;
		font-family: 'JetBrains Mono', monospace;
		font-weight: 600;
	}

	/* ─── Note card ────────────────────────────────────────────────── */
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
		line-height: 1.6;
		padding: 10px 12px;
		caret-color: #7c5cfc;
	}
	textarea::placeholder { color: #2a2a35; }
</style>
