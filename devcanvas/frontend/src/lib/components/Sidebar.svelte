<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import CreateWorkspaceModal from '$lib/components/CreateWorkspaceModal.svelte';
	import { getWorkspaceIcon, WORKSPACE_ICONS } from '$lib/terminal/icons';
	import { currentWorkspace, type Workspace } from '$lib/stores/workspace';
	import {
		clampTerminalFontSize,
		getDefaultWorkspaceSettings,
		getTerminalColor,
		normalizeWorkspaceSettings,
		type TerminalColorKey,
		TERMINAL_COLORS,
		TERMINAL_FONT_SIZE_MAX,
		TERMINAL_FONT_SIZE_MIN,
		type WorkspaceIconKey,
	} from '$lib/terminal/settings';

	type Props = {
		workspaceId: string;
	};

	let { workspaceId }: Props = $props();

	let workspaces = $state<Workspace[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let filter = $state('');
	let showCreateModal = $state(false);
	let menuWorkspaceId = $state<string | null>(null);
	let savingWorkspaceId = $state<string | null>(null);
	let deletingWorkspaceId = $state<string | null>(null);
	let menuDeleteConfirm = $state(false);
	let menuError = $state<string | null>(null);
	const defaultWorkspaceSettings = getDefaultWorkspaceSettings();

	const workspaceFontSize = $derived(
		clampTerminalFontSize(
			$currentWorkspace?.settings?.terminalDefaults.fontSize ??
				defaultWorkspaceSettings.terminalDefaults.fontSize
		)
	);

	function formatRelative(dateValue: string | number | undefined): string {
		if (!dateValue) return '';
		try {
			const date = new Date(dateValue);
			const diff = Date.now() - date.getTime();
			const mins = Math.floor(diff / 60000);
			const hours = Math.floor(diff / 3600000);
			const days = Math.floor(diff / 86400000);
			if (mins < 1) return 'just now';
			if (mins < 60) return `${mins}m ago`;
			if (hours < 24) return `${hours}h ago`;
			if (days < 7) return `${days}d ago`;
			return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		} catch {
			return String(dateValue);
		}
	}

	async function loadWorkspaces() {
		loading = true;
		loadError = null;
		try {
			workspaces = await api.workspaces.list();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load workspaces';
			workspaces = $currentWorkspace ? [$currentWorkspace] : [];
		} finally {
			loading = false;
		}
	}

	function handleCreated(workspace: Workspace) {
		workspaces = [workspace, ...workspaces.filter((item) => item.id !== workspace.id)];
	}

	function dismissWorkspaceMenu() {
		if (deletingWorkspaceId) return;
		menuWorkspaceId = null;
		menuDeleteConfirm = false;
		menuError = null;
	}

	function openWorkspaceMenu(event: MouseEvent, workspaceId: string) {
		event.preventDefault();
		event.stopPropagation();
		menuWorkspaceId = workspaceId;
		menuDeleteConfirm = false;
		menuError = null;
	}

	function applyWorkspace(updated: Workspace) {
		workspaces = workspaces.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
		currentWorkspace.update((workspace) =>
			workspace && workspace.id === updated.id ? { ...workspace, ...updated } : workspace
		);
	}

	async function updateWorkspaceAppearance(
		workspace: Workspace,
		patch: { icon?: WorkspaceIconKey; color?: TerminalColorKey }
	) {
		if (savingWorkspaceId || deletingWorkspaceId) return;

		const previousSettings = normalizeWorkspaceSettings(workspace.settings ?? defaultWorkspaceSettings);
		const nextSettings = normalizeWorkspaceSettings({
			...previousSettings,
			appearance: {
				...previousSettings.appearance,
				...patch,
			},
		});

		if (
			nextSettings.appearance.icon === previousSettings.appearance.icon &&
			nextSettings.appearance.color === previousSettings.appearance.color
		) {
			return;
		}

		savingWorkspaceId = workspace.id;
		menuError = null;
		applyWorkspace({ ...workspace, settings: nextSettings });

		try {
			const updated = await api.workspaces.updateSettings(workspace.id, nextSettings);
			applyWorkspace(updated);
		} catch (error) {
			applyWorkspace({ ...workspace, settings: previousSettings });
			menuError =
				error instanceof Error ? error.message : 'No se pudo guardar el workspace';
		} finally {
			savingWorkspaceId = null;
		}
	}

	async function confirmDeleteWorkspace(workspace: Workspace) {
		if (deletingWorkspaceId) return;
		deletingWorkspaceId = workspace.id;
		menuError = null;

		try {
			await api.workspaces.delete(workspace.id);
			const remaining = workspaces.filter((item) => item.id !== workspace.id);
			workspaces = remaining;
			menuWorkspaceId = null;
			menuDeleteConfirm = false;
			loadError = null;

			if ($currentWorkspace?.id === workspace.id) {
				currentWorkspace.set(null);
				await goto(remaining[0] ? `/workspace/${remaining[0].id}` : '/');
			}
		} catch (error) {
			menuError =
				error instanceof Error ? error.message : 'No se pudo eliminar el workspace';
		} finally {
			deletingWorkspaceId = null;
		}
	}

	const visibleWorkspaces = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		const merged = workspaces.map((workspace) => {
			if ($currentWorkspace && workspace.id === $currentWorkspace.id) {
				return {
					...workspace,
					name: $currentWorkspace.name,
					updatedAt: $currentWorkspace.updatedAt ?? workspace.updatedAt,
					settings: $currentWorkspace.settings ?? workspace.settings,
				};
			}
			return workspace;
		});
		if (!q) return merged;
		return merged.filter((workspace) => workspace.name.toLowerCase().includes(q));
	});

	onMount(() => {
		void loadWorkspaces();
	});

	async function changeWorkspaceFontSize(delta: number) {
		const workspace = $currentWorkspace;
		if (!workspace) return;

		const previousSettings = normalizeWorkspaceSettings(workspace.settings ?? defaultWorkspaceSettings);
		const nextSettings = normalizeWorkspaceSettings({
			...previousSettings,
			terminalDefaults: {
				...previousSettings.terminalDefaults,
				fontSize: previousSettings.terminalDefaults.fontSize + delta,
			},
		});

		if (nextSettings.terminalDefaults.fontSize === previousSettings.terminalDefaults.fontSize) return;

		currentWorkspace.update((current) =>
			current && current.id === workspace.id
				? { ...current, settings: nextSettings }
				: current
		);

		try {
			const updated = await api.workspaces.updateSettings(workspace.id, nextSettings);
			currentWorkspace.set(updated);
			workspaces = workspaces.map((item) =>
				item.id === updated.id ? { ...item, settings: updated.settings } : item
			);
			loadError = null;
		} catch (error) {
			currentWorkspace.update((current) =>
				current && current.id === workspace.id
					? { ...current, settings: previousSettings }
					: current
			);
			loadError = error instanceof Error ? error.message : 'Failed to save workspace settings';
		}
	}
</script>

<svelte:window
	onclick={dismissWorkspaceMenu}
	onkeydown={(event) => event.key === 'Escape' && dismissWorkspaceMenu()}
/>

<aside class="sidebar">
	<div class="sidebar-top">
		<div class="title-row">
			<div class="title-group">
				<span class="section-title">Workspaces</span>
				<span class="count">{workspaces.length}</span>
			</div>
			<button class="action-btn" onclick={() => (showCreateModal = true)} title="New workspace">
				<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
					<path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>
		</div>

		<label class="filter">
			<svg class="filter-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
				<circle cx="5.2" cy="5.2" r="3.6" stroke="currentColor" stroke-width="1.2"/>
				<path d="M8.2 8.2L10.8 10.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
			</svg>
			<input class="filter-input" type="text" bind:value={filter} placeholder="Filter" />
		</label>
	</div>

	<div class="list-area">
		{#if loading}
			{#each { length: 4 } as _, i}
				<div class="skeleton" style="opacity: {1 - i * 0.14}"></div>
			{/each}
		{:else if visibleWorkspaces.length === 0}
			<div class="empty">
				<span>{filter.trim() ? 'No matching workspaces' : 'No workspaces yet'}</span>
			</div>
		{:else}
			{#each visibleWorkspaces as workspace (workspace.id)}
				{@const workspaceSettings = normalizeWorkspaceSettings(
					workspace.settings ?? defaultWorkspaceSettings
				)}
				{@const workspaceColor = getTerminalColor(workspaceSettings.appearance.color)}
				{@const workspaceIcon = getWorkspaceIcon(workspaceSettings.appearance.icon)}
				{@const WorkspaceIcon = workspaceIcon.component}
				<div class="workspace-stack">
					<button
						class="workspace-item"
						type="button"
						class:active={workspace.id === workspaceId}
						onclick={() => workspace.id !== workspaceId && goto(`/workspace/${workspace.id}`)}
						oncontextmenu={(event) => openWorkspaceMenu(event, workspace.id)}
						title="Click derecho para opciones"
					>
						<div
							class="workspace-avatar"
							style={`--avatar-bar:${workspaceColor.bar}; --avatar-dot:${workspaceColor.dot}; --avatar-border:${workspaceColor.border};`}
						>
							<WorkspaceIcon size={15} strokeWidth={1.85} />
						</div>
						<div class="workspace-copy">
							<span class="workspace-name">{workspace.name}</span>
							<span class="workspace-meta">
								{formatRelative(workspace.updatedAt ?? workspace.createdAt)}
							</span>
						</div>
						{#if workspace.sessionCount !== undefined}
							<span class="workspace-badge">{workspace.sessionCount}</span>
						{/if}
					</button>

					{#if menuWorkspaceId === workspace.id}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
						<div
							class="workspace-menu"
							role="dialog"
							aria-label={`Opciones de ${workspace.name}`}
							tabindex="-1"
							onclick={(event) => event.stopPropagation()}
							oncontextmenu={(event) => event.preventDefault()}
						>
							<div class="workspace-menu-header">
								<div class="workspace-menu-copy">
									<span class="workspace-menu-title">{workspace.name}</span>
									<span class="workspace-menu-meta">Workspace</span>
								</div>
								{#if savingWorkspaceId === workspace.id}
									<span class="workspace-menu-status">Guardando...</span>
								{/if}
							</div>

							{#if menuError}
								<p class="workspace-menu-error">{menuError}</p>
							{/if}

							<div class="workspace-menu-block">
								<div class="workspace-menu-head">
									<span class="workspace-menu-label">Icono</span>
									<span class="workspace-menu-value">{workspaceIcon.label}</span>
								</div>
								<div class="workspace-menu-icons">
									{#each WORKSPACE_ICONS as option}
										{@const OptionIcon = option.component}
										<button
											class="workspace-menu-icon"
											class:active={workspaceSettings.appearance.icon === option.key}
											type="button"
											onclick={() =>
												void updateWorkspaceAppearance(workspace, { icon: option.key })}
										>
											<OptionIcon size={14} strokeWidth={1.9} />
										</button>
									{/each}
								</div>
							</div>

							<div class="workspace-menu-block">
								<div class="workspace-menu-head">
									<span class="workspace-menu-label">Color</span>
									<span class="workspace-menu-value">{workspaceColor.label}</span>
								</div>
								<div class="workspace-menu-colors">
									{#each TERMINAL_COLORS as color}
										<button
											class="workspace-menu-swatch"
											class:active={workspaceSettings.appearance.color === color.key}
											type="button"
											title={color.label}
											aria-label={color.label}
											onclick={() =>
												void updateWorkspaceAppearance(workspace, { color: color.key })}
										>
											<span
												class="workspace-menu-swatch-dot"
												style={`--swatch:${color.dot}; --ring:${color.border};`}
											></span>
										</button>
									{/each}
								</div>
							</div>

							<div class="workspace-menu-footer">
								{#if menuDeleteConfirm}
									<div class="workspace-menu-confirm">
										<span class="workspace-menu-confirm-copy">
											También se cerrarán sus terminales.
										</span>
										<div class="workspace-menu-actions">
											<button
												class="workspace-menu-btn"
												type="button"
												disabled={deletingWorkspaceId === workspace.id}
												onclick={() => {
													menuDeleteConfirm = false;
													menuError = null;
												}}
											>Cancelar</button>
											<button
												class="workspace-menu-btn workspace-menu-btn--danger"
												type="button"
												disabled={deletingWorkspaceId === workspace.id}
												onclick={() => void confirmDeleteWorkspace(workspace)}
											>{deletingWorkspaceId === workspace.id ? 'Eliminando...' : 'Eliminar'}</button>
										</div>
									</div>
								{:else}
									<button
										class="workspace-menu-danger"
										type="button"
										onclick={() => {
											menuDeleteConfirm = true;
											menuError = null;
										}}
									>Eliminar workspace</button>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<div class="sidebar-foot">
		{#if loadError}
			<p class="foot-error">{loadError}</p>
		{/if}

		<div class="stepper-row">
			<span class="stepper-label">Default font</span>
			<div class="stepper">
				<button
					class="stepper-btn"
					onclick={() => void changeWorkspaceFontSize(-1)}
					disabled={workspaceFontSize <= TERMINAL_FONT_SIZE_MIN}
					aria-label="Decrease font size"
				>−</button>
				<span class="stepper-val">{workspaceFontSize}</span>
				<button
					class="stepper-btn"
					onclick={() => void changeWorkspaceFontSize(1)}
					disabled={workspaceFontSize >= TERMINAL_FONT_SIZE_MAX}
					aria-label="Increase font size"
				>+</button>
			</div>
		</div>

		<div class="hints">
			<span class="hint"><i>T</i> terminal</span>
			<span class="hint"><i>N</i> note</span>
			<span class="hint"><i>B</i> sidebar</span>
		</div>
	</div>
</aside>

<CreateWorkspaceModal
	open={showCreateModal}
	onclose={() => (showCreateModal = false)}
	oncreated={handleCreated}
/>

<style>
	.sidebar {
		width: 100%;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 10px;
		background: transparent;
	}

	.sidebar-top,
	.list-area,
	.sidebar-foot {
		border: 1px solid var(--float-border);
		background:
			linear-gradient(180deg, var(--float-highlight), transparent 62%),
			var(--float-surface);
		box-shadow: var(--float-shadow);
		backdrop-filter: var(--float-blur);
		-webkit-backdrop-filter: var(--float-blur);
	}

	.sidebar-top,
	.sidebar-foot {
		padding: 14px 12px 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-radius: 28px;
	}

	.sidebar-top {
		flex-shrink: 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.title-group {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.section-title {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 600;
		color: rgba(218, 224, 237, 0.76);
		letter-spacing: 0.03em;
	}

	.count {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #9aa3b9;
		font-variant-numeric: tabular-nums;
		background: rgba(255, 255, 255, 0.045);
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		line-height: 1.5;
	}

	.action-btn {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(118, 127, 150, 0.14);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.045);
		color: #8d95aa;
		cursor: pointer;
		transition:
			border-color 0.12s ease,
			color 0.12s ease,
			background 0.12s ease,
			transform 0.12s ease;
	}

	.action-btn:hover {
		color: #f5f7fc;
		border-color: rgba(142, 152, 176, 0.22);
		background: rgba(255, 255, 255, 0.07);
		transform: translateY(-1px);
	}

	.filter {
		position: relative;
		display: block;
	}

	.filter-icon {
		position: absolute;
		top: 50%;
		left: 10px;
		transform: translateY(-50%);
		color: #4a4a60;
		pointer-events: none;
	}

	.filter-input {
		width: 100%;
		box-sizing: border-box;
		height: 36px;
		padding: 0 12px 0 30px;
		border-radius: 999px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.04);
		color: #f4f7ff;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		outline: none;
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			background 0.12s ease;
	}

	.filter-input::placeholder {
		color: #667087;
	}

	.filter-input:focus {
		border-color: rgba(124, 92, 252, 0.32);
		background: rgba(255, 255, 255, 0.045);
		box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.12);
	}

	.list-area {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-radius: 32px;
	}

	.workspace-stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.workspace-item {
		width: 100%;
		padding: 11px 12px;
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid rgba(255, 255, 255, 0.03);
		border-radius: 20px;
		background: rgba(255, 255, 255, 0.028);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
		cursor: pointer;
		text-align: left;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}

	.workspace-item:hover {
		background: rgba(255, 255, 255, 0.055);
		border-color: rgba(142, 152, 176, 0.14);
		box-shadow:
			0 10px 24px rgba(0, 0, 0, 0.14),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		transform: translateY(-1px);
	}

	.workspace-item.active {
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent 72%),
			linear-gradient(180deg, rgba(124, 92, 252, 0.12), rgba(255, 255, 255, 0.045));
		border-color: rgba(124, 92, 252, 0.24);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.05),
			0 12px 28px rgba(0, 0, 0, 0.18);
	}

	.workspace-avatar {
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 11px;
		color: var(--avatar-dot);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent 75%),
			var(--avatar-bar);
		border: 1px solid color-mix(in srgb, var(--avatar-border) 72%, rgba(255, 255, 255, 0.08));
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 8px 18px rgba(0, 0, 0, 0.16);
	}

	.workspace-copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.workspace-name {
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		font-weight: 600;
		color: #edf1fb;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.workspace-meta {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: #80879a;
	}

	.workspace-badge {
		flex-shrink: 0;
		min-width: 20px;
		height: 18px;
		padding: 0 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(118, 127, 150, 0.14);
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #bac1d2;
		font-variant-numeric: tabular-nums;
	}

	.workspace-menu {
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-radius: 20px;
		border: 1px solid rgba(118, 127, 150, 0.16);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 52%),
			rgba(21, 22, 28, 0.92);
		box-shadow:
			0 16px 34px rgba(0, 0, 0, 0.18),
			inset 0 1px 0 rgba(255, 255, 255, 0.035);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}

	.workspace-menu-header,
	.workspace-menu-head,
	.workspace-menu-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.workspace-menu-copy,
	.workspace-menu-confirm {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.workspace-menu-title {
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		font-weight: 600;
		color: #f0f4ff;
	}

	.workspace-menu-meta,
	.workspace-menu-value,
	.workspace-menu-confirm-copy {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		line-height: 1.45;
		color: #96a0b5;
	}

	.workspace-menu-status {
		padding: 3px 7px;
		border-radius: 999px;
		border: 1px solid rgba(118, 127, 150, 0.16);
		background: rgba(255, 255, 255, 0.04);
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		font-weight: 600;
		color: #f6d58c;
	}

	.workspace-menu-error {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		line-height: 1.4;
		color: #ff8ea0;
	}

	.workspace-menu-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		border-radius: 15px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.025);
	}

	.workspace-menu-label {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(205, 210, 222, 0.52);
	}

	.workspace-menu-icons,
	.workspace-menu-colors {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.workspace-menu-icon,
	.workspace-menu-swatch {
		width: 28px;
		height: 28px;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.02);
		color: #8892a5;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			transform 0.12s ease;
	}

	.workspace-menu-icon:hover,
	.workspace-menu-swatch:hover,
	.workspace-menu-btn:hover:not(:disabled),
	.workspace-menu-danger:hover {
		transform: translateY(-1px);
	}

	.workspace-menu-icon.active {
		color: #fff;
		border-color: rgba(124, 92, 252, 0.3);
		background: rgba(124, 92, 252, 0.12);
	}

	.workspace-menu-swatch {
		border-radius: 999px;
		border: none;
		background: transparent;
	}

	.workspace-menu-swatch-dot {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: var(--swatch);
		box-shadow:
			0 0 0 2px rgba(10, 12, 18, 0.9),
			0 0 0 4px transparent;
	}

	.workspace-menu-swatch.active .workspace-menu-swatch-dot {
		box-shadow:
			0 0 0 2px rgba(10, 12, 18, 0.9),
			0 0 0 4px var(--ring);
	}

	.workspace-menu-footer {
		padding-top: 2px;
	}

	.workspace-menu-btn,
	.workspace-menu-danger {
		height: 32px;
		padding: 0 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid rgba(118, 127, 150, 0.16);
		background: rgba(255, 255, 255, 0.04);
		color: #dce2f0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			transform 0.12s ease;
	}

	.workspace-menu-danger {
		width: 100%;
		border-color: rgba(255, 122, 140, 0.16);
		background: rgba(255, 107, 128, 0.08);
		color: #ffacb8;
	}

	.workspace-menu-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.07);
		border-color: rgba(142, 152, 176, 0.22);
	}

	.workspace-menu-danger:hover {
		background: rgba(255, 107, 128, 0.12);
		border-color: rgba(255, 122, 140, 0.24);
	}

	.workspace-menu-btn:disabled,
	.workspace-menu-danger:disabled {
		opacity: 0.48;
		cursor: default;
	}

	.workspace-menu-btn--danger {
		border-color: rgba(255, 122, 140, 0.2);
		background: rgba(255, 107, 128, 0.12);
		color: #ffb5c1;
	}

	.workspace-menu-btn--danger:hover:not(:disabled) {
		background: rgba(255, 107, 128, 0.18);
		border-color: rgba(255, 122, 140, 0.28);
		color: #ffdce2;
	}

	.skeleton {
		height: 48px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 20px;
		animation: pulse-dot 1.6s ease-in-out infinite;
	}

	.empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px 12px;
		text-align: center;
	}

	.empty span {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		color: #7c8396;
	}

	.sidebar-foot {
		flex-shrink: 0;
		gap: 12px;
	}

	.foot-error {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		line-height: 1.5;
		color: #ff6b80;
	}

	.stepper-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 2px 2px 2px 2px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
	}

	.stepper-label {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: #8b92a5;
	}

	.stepper {
		display: flex;
		align-items: center;
		border: 1px solid rgba(118, 127, 150, 0.14);
		border-radius: 999px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.035);
	}

	.stepper-btn {
		width: 26px;
		height: 24px;
		background: transparent;
		border: none;
		color: #7d8496;
		font-size: 12px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-family-mono, monospace);
		transition: background 0.1s ease, color 0.1s ease;
	}

	.stepper-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.06);
		color: #f3f6fd;
	}

	.stepper-btn:disabled {
		opacity: 0.2;
		cursor: default;
	}

	.stepper-val {
		width: 30px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #adb5c6;
		border-left: 1px solid rgba(118, 127, 150, 0.16);
		border-right: 1px solid rgba(118, 127, 150, 0.16);
		font-variant-numeric: tabular-nums;
	}

	.hints {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.hint {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
		padding: 5px 9px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.035);
		border: 1px solid rgba(118, 127, 150, 0.12);
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		color: #6b7283;
	}

	.hint i {
		font-style: normal;
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		font-weight: 600;
		color: #8a91a3;
		letter-spacing: 0.02em;
	}
</style>
