<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { getWorkspaceIcon, WORKSPACE_ICONS } from '$lib/terminal/icons';
	import {
		getDefaultWorkspaceSettings,
		getTerminalColor,
		normalizeWorkspaceSettings,
		TERMINAL_COLORS,
	} from '$lib/terminal/settings';
	import type { Workspace } from '$lib/stores/workspace';

	type Props = {
		open: boolean;
		onclose?: () => void;
		oncreated?: (workspace: Workspace) => void;
	};

	let { open, onclose, oncreated }: Props = $props();

	let name = $state('');
	let creating = $state(false);
	let workspaceSettings = $state(getDefaultWorkspaceSettings());
	const workspaceAppearance = $derived(normalizeWorkspaceSettings(workspaceSettings).appearance);
	const workspaceColor = $derived(getTerminalColor(workspaceAppearance.color));
	const workspaceIcon = $derived(getWorkspaceIcon(workspaceAppearance.icon));

	function focusOnMount(node: HTMLElement) { node.focus(); }

	function close() {
		if (creating) return;
		onclose?.();
	}

	async function createWorkspace() {
		const trimmed = name.trim();
		if (!trimmed || creating) return;
		creating = true;
		try {
			const workspace = await api.workspaces.create(trimmed, workspaceSettings);
			oncreated?.(workspace);
			onclose?.();
			name = '';
			workspaceSettings = getDefaultWorkspaceSettings();
			await goto(`/workspace/${workspace.id}`);
		} catch (err) {
			console.error('Failed to create workspace:', err);
		} finally {
			creating = false;
		}
	}

	$effect(() => {
		if (open) {
			name = '';
			workspaceSettings = getDefaultWorkspaceSettings();
		}
	});
</script>

{#if open}
	<div
		class="backdrop"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => { if (e.target === e.currentTarget) close(); }}
		onkeydown={(e) => e.key === 'Escape' && close()}
	>
		<div
			class="modal"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Enter' && createWorkspace()}
		>
			<div class="modal-header">
				<h2 class="modal-title">New Workspace</h2>
				<p class="modal-sub">An infinite canvas for your terminals and notes.</p>
			</div>

			<div class="modal-body">
				<label class="field">
					<span class="field-label">Name</span>
					<input
						class="field-input"
						type="text"
						bind:value={name}
						placeholder="my-project"
						use:focusOnMount
					/>
				</label>

				<div class="option-block">
					<div class="option-head">
						<span class="field-label">Icon</span>
						<span class="option-value">{workspaceIcon.label}</span>
					</div>
					<div class="icon-row">
						{#each WORKSPACE_ICONS as option}
							{@const OptionIcon = option.component}
							<button
								class="icon-btn"
								class:active={workspaceAppearance.icon === option.key}
								type="button"
								title={option.label}
								aria-label={option.label}
								onclick={() =>
									(workspaceSettings = normalizeWorkspaceSettings({
										...workspaceSettings,
										appearance: {
											...workspaceSettings.appearance,
											icon: option.key,
										},
									}))}
							>
								<OptionIcon size={14} strokeWidth={1.9} />
							</button>
						{/each}
					</div>
				</div>

				<div class="option-block">
					<div class="option-head">
						<span class="field-label">Color</span>
						<span class="option-value">{workspaceColor.label}</span>
					</div>
					<div class="swatch-row">
						{#each TERMINAL_COLORS as color}
							<button
								class="swatch"
								class:active={workspaceAppearance.color === color.key}
								type="button"
								title={color.label}
								aria-label={color.label}
								onclick={() =>
									(workspaceSettings = normalizeWorkspaceSettings({
										...workspaceSettings,
										appearance: {
											...workspaceSettings.appearance,
											color: color.key,
										},
									}))}
							>
								<span
									class="swatch-dot"
									style={`--swatch:${color.dot}; --ring:${color.border};`}
								></span>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<div class="modal-foot">
				<button class="btn-ghost" onclick={close}>Cancel</button>
				<button
					class="btn-primary"
					onclick={createWorkspace}
					disabled={creating || !name.trim()}
				>{creating ? 'Creating…' : 'Create'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		width: 360px;
		overflow: hidden;
		box-shadow: 0 32px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.04);
	}

	.modal-header {
		padding: 22px 22px 0;
	}

	.modal-title {
		margin: 0 0 4px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.01em;
	}

	.modal-sub {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		color: var(--muted);
		line-height: 1.5;
	}

	.modal-body {
		padding: 18px 22px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.field {
		display: block;
	}

	.field-label {
		display: block;
		margin-bottom: 6px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		font-weight: 600;
		color: #4a4a60;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.field-input {
		width: 100%;
		padding: 9px 12px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		color: var(--text);
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		outline: none;
		box-sizing: border-box;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}

	.field-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.12);
	}

	.option-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-radius: 14px;
		border: 1px solid var(--border);
		background: var(--surface2);
	}

	.option-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.option-value {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: var(--muted);
	}

	.icon-row,
	.swatch-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.icon-btn,
	.swatch {
		width: 28px;
		height: 28px;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		border: 1px solid rgba(118, 127, 150, 0.16);
		background: rgba(255, 255, 255, 0.02);
		color: #8f98aa;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			transform 0.12s ease;
	}

	.icon-btn:hover,
	.swatch:hover {
		transform: translateY(-1px);
	}

	.icon-btn.active {
		color: #fff;
		border-color: rgba(124, 92, 252, 0.3);
		background: rgba(124, 92, 252, 0.12);
	}

	.swatch {
		border: none;
		border-radius: 999px;
		background: transparent;
	}

	.swatch-dot {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: var(--swatch);
		box-shadow:
			0 0 0 2px rgba(10, 12, 18, 0.9),
			0 0 0 4px transparent;
	}

	.swatch.active .swatch-dot {
		box-shadow:
			0 0 0 2px rgba(10, 12, 18, 0.9),
			0 0 0 4px var(--ring);
	}

	.modal-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 22px;
		border-top: 1px solid var(--border);
		background: var(--surface2);
	}

	.btn-ghost {
		padding: 7px 16px;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--muted);
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}

	.btn-ghost:hover {
		border-color: var(--muted);
		color: var(--text);
	}

	.btn-primary {
		padding: 7px 16px;
		background: var(--accent);
		border: 1px solid transparent;
		border-radius: 6px;
		color: #fff;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.12s ease;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-primary:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
