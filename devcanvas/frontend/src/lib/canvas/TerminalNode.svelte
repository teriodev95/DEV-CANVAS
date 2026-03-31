<script lang="ts">
	import { Handle, Position, NodeResizer } from '@xyflow/svelte';
	import { api } from '$lib/api';
	import { sessions, type Session } from '$lib/stores/sessions';
	import { currentWorkspace } from '$lib/stores/workspace';
	import TerminalPane from '$lib/terminal/TerminalPane.svelte';
	import { getTerminalIcon, TERMINAL_ICONS } from '$lib/terminal/icons';
	import {
		TERMINAL_FOCUS_EVENT,
		TERMINAL_INTERACTION_EVENT,
		activeTerminalNodeId,
		terminalQuickSlots,
		fullscreenTerminal,
	} from '$lib/terminal/navigation';
	import { detectApplePlatform, getTerminalSlotShortcutLabel } from '$lib/utils/shortcuts';
	import {
		clampTerminalFontSize,
		getDefaultWorkspaceSettings,
		getTerminalColor,
		getTerminalFontFamily,
		getTerminalTheme,
		resolveTerminalAppearance,
		TERMINAL_COLORS,
		TERMINAL_FONT_FAMILIES,
		TERMINAL_FONT_SIZE_MAX,
		TERMINAL_FONT_SIZE_MIN,
		TERMINAL_THEMES,
		type EffectiveTerminalAppearance,
		type TerminalColorKey,
		type TerminalIconKey,
		type TerminalSessionAppearance,
	} from '$lib/terminal/settings';

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

	type EditorMenu = { x: number; y: number };
	type SaveState = 'idle' | 'saving' | 'saved' | 'error';

	const defaultWorkspaceSettings = getDefaultWorkspaceSettings();

	let { id, selected = false, data }: Props = $props();

	let menu = $state<EditorMenu | null>(null);
	let closeConfirmOpen = $state(false);
	let closingSession = $state(false);
	let interacting = $state(false);
	let isApplePlatform = $state(false);
	let pulseActive = $state(false);
	let savingState = $state<SaveState>('idle');
	let settingsError = $state<string | null>(null);
	let closeError = $state<string | null>(null);
	let draftName = $state('');
	let draftAppearance = $state<EffectiveTerminalAppearance>(
		resolveTerminalAppearance(defaultWorkspaceSettings, null)
	);
	let nodeEl: HTMLDivElement | undefined = $state();
	let terminalPane: { focus: () => void; blur: () => void; reconnect: () => void } | undefined = $state();
	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	let statusTimer: ReturnType<typeof setTimeout> | null = null;
	let pulseTimer: ReturnType<typeof setTimeout> | null = null;
	let persistRequestId = 0;

	const sessionRecord = $derived($sessions.find((session) => session.id === data.sessionId) ?? null);
	const workspaceSettings = $derived($currentWorkspace?.settings ?? defaultWorkspaceSettings);
	const effectiveAppearance = $derived(
		resolveTerminalAppearance(workspaceSettings, sessionRecord?.appearance, {
			icon: data.icon,
			color: data.color,
		})
	);
	const liveAppearance = $derived(menu ? draftAppearance : effectiveAppearance);
	const colorPreset = $derived(getTerminalColor(liveAppearance.color));
	const iconPreset = $derived(getTerminalIcon(liveAppearance.icon));
	const HeaderIcon = $derived(iconPreset.component);
	const displayName = $derived(sessionRecord?.name ?? data.sessionName);
	const displayType = $derived(sessionRecord?.type ?? data.sessionType);
	const workingDir = $derived(sessionRecord?.workingDir ?? null);
	const connectionLabel = $derived(displayType === 'ssh' ? 'SSH' : 'Local');
	const themePreset = $derived(getTerminalTheme(draftAppearance.themeId));
	const fontPreset = $derived(getTerminalFontFamily(draftAppearance.fontFamily));
	const slotIndex = $derived($terminalQuickSlots[id] ?? null);
	const slotShortcutLabel = $derived(
		slotIndex ? getTerminalSlotShortcutLabel(slotIndex, isApplePlatform) : null
	);
	const isActiveTerminal = $derived($activeTerminalNodeId === id);
	const isThisFullscreen = $derived($fullscreenTerminal?.nodeId === id);
	const saveStatusLabel = $derived.by(() => {
		if (savingState === 'saving') return 'Guardando...';
		if (savingState === 'saved') return 'Listo';
		if (savingState === 'error') return 'Error';
		return '';
	});
	const workingDirLabel = $derived(formatWorkingDirLabel(workingDir));
	const workingDirTitle = $derived(workingDir ?? undefined);

	function formatWorkingDirLabel(nextPath: string | null): string | null {
		if (!nextPath) return null;
		if (nextPath === '/') return '/';

		const segments = nextPath.split('/').filter(Boolean);
		if (segments.length === 0) return '/';
		if (segments.length === 1) return `/${segments[0]}`;
		if (segments.length === 2) return `/${segments.join('/')}`;
		return `.../${segments.slice(-2).join('/')}`;
	}

	function focusTerminal() {
		requestAnimationFrame(() => {
			terminalPane?.focus();
		});
	}

	function enterInteraction() {
		interacting = true;
		window.dispatchEvent(new CustomEvent(TERMINAL_INTERACTION_EVENT, { detail: { id } }));
		focusTerminal();
	}

	function handleBarDoubleClick() {
		fullscreenTerminal.set({
			nodeId: id,
			sessionId: data.sessionId,
			sessionName: displayName,
			sessionType: displayType,
			themeId: liveAppearance.themeId,
			fontFamily: liveAppearance.fontFamily,
			fontSize: liveAppearance.fontSize,
		});
	}

	function triggerPulse() {
		if (pulseTimer) clearTimeout(pulseTimer);
		pulseActive = false;
		requestAnimationFrame(() => {
			pulseActive = true;
		});
		pulseTimer = setTimeout(() => {
			pulseActive = false;
		}, 240);
	}

	function handleBodyPointerDown() {
		if (!interacting) enterInteraction();
	}

	function seedEditor() {
		draftName = displayName;
		draftAppearance = { ...effectiveAppearance };
		settingsError = null;
		savingState = 'idle';
	}

	function clampMenuPosition(x: number, y: number): EditorMenu {
		const menuWidth = 356;
		const menuHeight = 478;
		const insetX = 12;
		const insetY = 44;
		const width = nodeEl?.clientWidth ?? menuWidth + insetX * 2;
		const height = nodeEl?.clientHeight ?? menuHeight + insetY + 12;
		const maxX = Math.max(insetX, width - menuWidth - insetX);
		const maxY = Math.max(insetY, height - menuHeight - 12);
		return {
			x: Math.min(Math.max(x, insetX), maxX),
			y: Math.min(Math.max(y, insetY), maxY),
		};
	}

	function openEditorAt(x: number, y: number) {
		seedEditor();
		menu = clampMenuPosition(x, y);
	}

	function openEditorFromContext(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		openEditorAt(event.offsetX, event.offsetY);
	}

	function openEditorFromButton(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		const width = nodeEl?.clientWidth ?? 420;
		openEditorAt(width - 368, 42);
	}

	function clearTimers() {
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = null;
		}
		if (statusTimer) {
			clearTimeout(statusTimer);
			statusTimer = null;
		}
		if (pulseTimer) {
			clearTimeout(pulseTimer);
			pulseTimer = null;
		}
	}

	function hasPendingChanges() {
		return (
			draftName.trim() !== displayName.trim() ||
			draftAppearance.icon !== effectiveAppearance.icon ||
			draftAppearance.color !== effectiveAppearance.color ||
			draftAppearance.themeId !== effectiveAppearance.themeId ||
			draftAppearance.fontFamily !== effectiveAppearance.fontFamily ||
			draftAppearance.fontSize !== effectiveAppearance.fontSize
		);
	}

	function closeMenu() {
		if (!menu) return;
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = null;
			if (hasPendingChanges()) {
				void persistEditor();
			}
		}
		menu = null;
	}

	function openCloseConfirm(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		closeMenu();
		closeError = null;
		closeConfirmOpen = true;
	}

	function closeCloseConfirm() {
		if (closingSession) return;
		closeError = null;
		closeConfirmOpen = false;
	}

	async function confirmCloseSession() {
		if (closingSession) return;
		closingSession = true;
		closeError = null;

		try {
			await api.sessions.delete(data.sessionId);
			sessions.update((current) => current.filter((session) => session.id !== data.sessionId));
			currentWorkspace.update((workspace) =>
				workspace
					? {
							...workspace,
							sessionCount:
								workspace.sessionCount === undefined
									? undefined
									: Math.max(0, workspace.sessionCount - 1),
						}
					: workspace
			);
			closeConfirmOpen = false;
			window.dispatchEvent(new CustomEvent('devcanvas:remove-node', { detail: { id } }));
		} catch (error) {
			closeError =
				error instanceof Error ? error.message : 'No se pudo cerrar la terminal';
		} finally {
			closingSession = false;
		}
	}

	function removeNode() {
		closeMenu();
		closeCloseConfirm();
		window.dispatchEvent(new CustomEvent('devcanvas:remove-node', { detail: { id } }));
	}

	function dismissPanels() {
		if (menu) closeMenu();
		if (closeConfirmOpen) closeCloseConfirm();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (closeConfirmOpen) {
			closeCloseConfirm();
			return;
		}
		if (menu) {
			closeMenu();
			return;
		}
		if (interacting) {
			interacting = false;
			terminalPane?.blur();
		}
	}

	function toStoredAppearance(appearance: EffectiveTerminalAppearance): TerminalSessionAppearance {
		return {
			icon: appearance.icon,
			color: appearance.color,
			themeId:
				appearance.themeId === workspaceSettings.terminalDefaults.themeId ? null : appearance.themeId,
			fontFamily:
				appearance.fontFamily === workspaceSettings.terminalDefaults.fontFamily
					? null
					: appearance.fontFamily,
			fontSize:
				appearance.fontSize === workspaceSettings.terminalDefaults.fontSize ? null : appearance.fontSize,
		};
	}

	function applyUpdatedSession(
		updated: Pick<Session, 'id' | 'name' | 'type'> & {
			appearance?: TerminalSessionAppearance;
		}
	) {
		sessions.update((current) =>
			current.map((session) => (session.id === updated.id ? { ...session, ...updated } : session))
		);

		window.dispatchEvent(
			new CustomEvent('devcanvas:update-node', {
				detail: {
					id,
					data: {
						...data,
						sessionName: updated.name,
						sessionType: updated.type,
						color: draftAppearance.color,
						icon: draftAppearance.icon,
					},
				},
			})
		);
	}

	async function persistEditor() {
		if (!hasPendingChanges()) return;

		const nextName = draftName.trim();
		if (!nextName) {
			settingsError = 'El nombre no puede estar vacío';
			savingState = 'error';
			return;
		}

		const requestId = ++persistRequestId;
		const nextAppearance = toStoredAppearance(draftAppearance);
		settingsError = null;
		savingState = 'saving';

		try {
			const updated = await api.sessions.update(data.sessionId, {
				name: nextName,
				appearance: nextAppearance,
			});

			if (requestId !== persistRequestId) return;

			applyUpdatedSession(updated);
			savingState = 'saved';
			if (statusTimer) clearTimeout(statusTimer);
			statusTimer = setTimeout(() => {
				if (savingState === 'saved') savingState = 'idle';
			}, 1100);
		} catch (error) {
			if (requestId !== persistRequestId) return;
			settingsError =
				error instanceof Error ? error.message : 'No se pudieron guardar los ajustes';
			savingState = 'error';
		}
	}

	function queueAppearancePersist() {
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistTimer = null;
			void persistEditor();
		}, 140);
	}

	function updateDraftAppearance(patch: Partial<EffectiveTerminalAppearance>) {
		draftAppearance = {
			...draftAppearance,
			...patch,
		};
		settingsError = null;
		savingState = 'idle';
		queueAppearancePersist();
	}

	function handleNameInput() {
		settingsError = null;
		savingState = 'idle';
	}

	function handleNameCommit(event?: KeyboardEvent) {
		if (event && event.key !== 'Enter') return;
		if (event) {
			event.preventDefault();
			(event.currentTarget as HTMLInputElement | null)?.blur();
		}
		void persistEditor();
	}

	function stepFontSize(delta: number) {
		updateDraftAppearance({
			fontSize: clampTerminalFontSize(draftAppearance.fontSize + delta),
		});
	}

	$effect(() => {
		isApplePlatform = detectApplePlatform();

		const handleInteraction = (event: Event) => {
			const nextId = (event as CustomEvent<{ id?: string }>).detail?.id;
			if (nextId !== id) {
				closeCloseConfirm();
				interacting = false;
				terminalPane?.blur();
			}
		};

		const handleFocusRequest = (event: Event) => {
			const nextId = (event as CustomEvent<{ id?: string }>).detail?.id;
			if (nextId !== id) {
				closeCloseConfirm();
				if (menu) closeMenu();
				return;
			}

			enterInteraction();
			triggerPulse();
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (!interacting || !nodeEl) return;
			const target = event.target;
			if (target instanceof Node && !nodeEl.contains(target)) {
				interacting = false;
				terminalPane?.blur();
			}
		};

		window.addEventListener(TERMINAL_INTERACTION_EVENT, handleInteraction);
		window.addEventListener(TERMINAL_FOCUS_EVENT, handleFocusRequest);
		window.addEventListener('pointerdown', handlePointerDown, true);

		return () => {
			window.removeEventListener(TERMINAL_INTERACTION_EVENT, handleInteraction);
			window.removeEventListener(TERMINAL_FOCUS_EVENT, handleFocusRequest);
			window.removeEventListener('pointerdown', handlePointerDown, true);
			clearTimers();
		};
	});
</script>

<svelte:window onclick={dismissPanels} onkeydown={onKeydown} />

<NodeResizer
	minWidth={320}
	minHeight={200}
	isVisible={selected}
	lineStyle="border: 1px dashed #7c5cfc55; border-radius: 8px;"
	handleStyle="background:#7c5cfc; border: 2px solid #0d0d0f; width: 10px; height: 10px; border-radius: 3px; cursor: nwse-resize;"
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={nodeEl}
	class="node"
	class:is-active={isActiveTerminal}
	class:shortcut-pulse={pulseActive}
	oncontextmenu={openEditorFromContext}
	style="--bar-bg:{colorPreset.bar}; --dot-color:{colorPreset.dot}; --dot-glow:{colorPreset.glow}; --border-color:{colorPreset.border}"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="bar terminal-drag-handle" onclick={() => { interacting = false; terminalPane?.blur(); }} ondblclick={handleBarDoubleClick}>
		<span class="icon" aria-hidden="true">
			<HeaderIcon size={11} strokeWidth={1.9} />
		</span>
		<span class="dot active"></span>
		<span class="name">{displayName}</span>
		{#if workingDirLabel}
			<span class="cwd" title={workingDirTitle}>{workingDirLabel}</span>
		{/if}
		<span class="type">{displayType}</span>
		{#if slotIndex}
			<span class="slot" class:slot--active={isActiveTerminal} title={slotShortcutLabel ?? undefined}>
				{slotIndex}
			</span>
		{/if}
		<button
			class="bar-action nodrag nopan nowheel"
			type="button"
			title="Reconectar terminal"
			onclick={(e) => { e.stopPropagation(); terminalPane?.reconnect(); }}
		>
			<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path d="M1.5 8a6.5 6.5 0 0 1 11.48-4.16" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
				<path d="M14.5 8A6.5 6.5 0 0 1 3.02 12.16" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
				<path d="M13 1.5v2.5h-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M3 14.5V12h2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		<button
			class="bar-action bar-action--danger nodrag nopan nowheel"
			type="button"
			title="Cerrar terminal"
			aria-label="Cerrar terminal"
			onclick={openCloseConfirm}
		>
			<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path d="M4 4L12 12" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
				<path d="M12 4L4 12" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
			</svg>
		</button>
		{#if interacting}
			<span class="hint">esc · drag</span>
		{/if}
	</div>

	<div class="body nodrag nopan nowheel" onpointerdown={handleBodyPointerDown}>
		{#if isThisFullscreen}
			<div class="fullscreen-placeholder">Fullscreen activo</div>
		{:else}
			<TerminalPane
				bind:this={terminalPane}
				sessionId={data.sessionId}
				showStatus={false}
				embedded={true}
				themeId={liveAppearance.themeId}
				fontFamily={liveAppearance.fontFamily}
				fontSize={liveAppearance.fontSize}
			/>
		{/if}

		{#if !interacting && !isThisFullscreen}
			<div class="hint-badge">click to type</div>
		{/if}
	</div>

	{#if closeConfirmOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div
			class="close-confirm nodrag nopan nowheel"
			role="alertdialog"
			aria-label="Cerrar terminal"
			tabindex="-1"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => event.stopPropagation()}
		>
			<div class="close-confirm-copy">
				<span class="close-confirm-title">Cerrar terminal</span>
				<span class="close-confirm-body">Se finalizará la sesión y se quitará del canvas.</span>
				{#if closeError}
					<p class="close-confirm-error">{closeError}</p>
				{/if}
			</div>
			<div class="close-confirm-actions">
				<button
					class="close-confirm-btn"
					type="button"
					disabled={closingSession}
					onclick={closeCloseConfirm}
				>Cancelar</button>
				<button
					class="close-confirm-btn close-confirm-btn--danger"
					type="button"
					disabled={closingSession}
					onclick={() => void confirmCloseSession()}
				>{closingSession ? 'Cerrando...' : 'Cerrar'}</button>
			</div>
		</div>
	{/if}

	{#if menu}
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
		<div
			class="ctx-menu nodrag nopan nowheel"
			style="left:{menu.x}px;top:{menu.y}px"
			role="dialog"
			aria-label="Editar terminal"
			tabindex="-1"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => event.stopPropagation()}
			oncontextmenu={(event) => event.preventDefault()}
		>
			<div class="ctx-header">
				<div class="ctx-header-copy">
					<span class="ctx-title">Editar terminal</span>
					<div class="ctx-meta">
						<span class="ctx-chip">{connectionLabel}</span>
						<span class="ctx-chip">{displayType}</span>
					</div>
				</div>
				{#if saveStatusLabel}
					<span class="ctx-status" class:saving={savingState === 'saving'} class:error={savingState === 'error'}>{saveStatusLabel}</span>
				{/if}
			</div>

			{#if settingsError}
				<p class="ctx-error">{settingsError}</p>
			{/if}

			<label class="ctx-field">
				<span class="ctx-label">Nombre</span>
				<input
					class="ctx-input"
					type="text"
					bind:value={draftName}
					placeholder="Shell"
					oninput={handleNameInput}
					onblur={() => void persistEditor()}
					onkeydown={handleNameCommit}
				/>
			</label>

			<div class="ctx-block">
				<div class="ctx-block-head">
					<span class="ctx-label">Color</span>
					<span class="ctx-value">{getTerminalColor(draftAppearance.color).label}</span>
				</div>
				<div class="ctx-swatch-row">
					{#each TERMINAL_COLORS as color}
						<button
							class="ctx-swatch"
							class:active={draftAppearance.color === color.key}
							type="button"
							title={color.label}
							onclick={() => updateDraftAppearance({ color: color.key })}
						>
							<span
								class="ctx-swatch-dot"
								style="--swatch:{color.dot}; --ring:{color.border}"
							></span>
						</button>
					{/each}
				</div>
			</div>

			<div class="ctx-block">
				<div class="ctx-block-head">
					<span class="ctx-label">Icono</span>
					<span class="ctx-value">{getTerminalIcon(draftAppearance.icon).label}</span>
				</div>
				<div class="ctx-icon-row">
					{#each TERMINAL_ICONS as icon}
						{@const IconComponent = icon.component}
						<button
							class="ctx-icon-btn"
							class:active={draftAppearance.icon === icon.key}
							type="button"
							title={icon.label}
							onclick={() => updateDraftAppearance({ icon: icon.key })}
						>
							<IconComponent size={14} strokeWidth={1.9} />
						</button>
					{/each}
				</div>
			</div>

			<div class="ctx-block">
				<div class="ctx-block-head">
					<span class="ctx-label">Tema</span>
					<span class="ctx-value">{themePreset.label}</span>
				</div>
				<div class="ctx-theme-grid">
					{#each TERMINAL_THEMES as theme}
						<button
							class="ctx-theme-card"
							class:active={draftAppearance.themeId === theme.id}
							type="button"
							onclick={() => updateDraftAppearance({ themeId: theme.id })}
						>
							<div
								class="ctx-theme-preview"
								style="--preview-bg:{theme.surfaceBg}; --preview-fg:{theme.previewFg}; --preview-accent:{theme.accent}; --preview-border:{theme.border}"
							>
								<span class="ctx-theme-line">~/dev <b>$</b></span>
								<span class="ctx-theme-line">npm run dev</span>
							</div>
							<span class="ctx-theme-name">{theme.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="ctx-block">
				<div class="ctx-block-head">
					<span class="ctx-label">Fuente</span>
					<span class="ctx-value">{fontPreset.label}</span>
				</div>
				<div class="ctx-font-grid">
					{#each TERMINAL_FONT_FAMILIES as font}
						<button
							class="ctx-font-card"
							class:active={draftAppearance.fontFamily === font.id}
							type="button"
							onclick={() => updateDraftAppearance({ fontFamily: font.id })}
						>
							<span class="ctx-font-name">{font.label}</span>
							<span class="ctx-font-preview" style="font-family:{font.stack};">{font.preview}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="ctx-block">
				<div class="ctx-block-head">
					<span class="ctx-label">Tamaño</span>
					<span class="ctx-value">{draftAppearance.fontSize} pt</span>
				</div>
				<div class="ctx-size-row">
					<div class="ctx-stepper">
						<button
							class="ctx-step-btn"
							type="button"
							disabled={draftAppearance.fontSize <= TERMINAL_FONT_SIZE_MIN}
							onclick={() => stepFontSize(-1)}
						>−</button>
						<div class="ctx-step-value">{draftAppearance.fontSize}</div>
						<button
							class="ctx-step-btn"
							type="button"
							disabled={draftAppearance.fontSize >= TERMINAL_FONT_SIZE_MAX}
							onclick={() => stepFontSize(1)}
						>+</button>
					</div>
					<div class="ctx-font-sample" style="font-family:{fontPreset.stack}; font-size:{draftAppearance.fontSize}px;">
						<span>abc</span>
						<span>012</span>
						<span>-&gt;|&lt;-</span>
					</div>
				</div>
			</div>

			<div class="ctx-footer">
				<button class="ctx-danger-btn" type="button" onclick={removeNode}>Quitar del canvas</button>
			</div>
		</div>
	{/if}
</div>

<Handle type="source" position={Position.Right} style="opacity:0" />
<Handle type="target" position={Position.Left} style="opacity:0" />

<style>
	.node {
		width: 100%;
		height: 100%;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.018), transparent 20%),
			#0b1118;
		border: 1px solid rgba(74, 87, 110, 0.56);
		border-radius: 12px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		position: relative;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.03),
			0 10px 28px rgba(0, 0, 0, 0.18);
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.node.is-active {
		border-color: rgba(124, 92, 252, 0.46);
	}

	.node.shortcut-pulse {
		animation: terminal-shortcut-pulse 220ms ease-out;
	}

	@keyframes terminal-shortcut-pulse {
		0% {
			box-shadow:
				inset 0 1px 0 rgba(255, 255, 255, 0.03),
				0 10px 28px rgba(0, 0, 0, 0.18),
				0 0 0 0 rgba(124, 92, 252, 0);
		}

		40% {
			box-shadow:
				inset 0 1px 0 rgba(255, 255, 255, 0.05),
				0 18px 38px rgba(0, 0, 0, 0.24),
				0 0 0 3px rgba(124, 92, 252, 0.16);
		}

		100% {
			box-shadow:
				inset 0 1px 0 rgba(255, 255, 255, 0.03),
				0 10px 28px rgba(0, 0, 0, 0.18),
				0 0 0 0 rgba(124, 92, 252, 0);
		}
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 12px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 130%),
			var(--bar-bg, #141418);
		border-bottom: 1px solid rgba(74, 87, 110, 0.46);
		cursor: grab;
		flex-shrink: 0;
		user-select: none;
		transition: background 0.2s, border-color 0.2s;
		backdrop-filter: blur(10px);
	}

	.terminal-drag-handle {
		touch-action: none;
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		color: var(--dot-color, #3dd68c);
		opacity: 0.7;
		flex-shrink: 0;
		line-height: 1;
	}

	.icon :global(svg) {
		display: block;
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
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	.name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		font-weight: 500;
		color: #b8c2d4;
		flex: 0 1 auto;
		max-width: 34%;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cwd {
		flex: 1;
		min-width: 0;
		height: 20px;
		padding: 0 8px;
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		background: rgba(11, 17, 24, 0.34);
		border: 1px solid rgba(255, 255, 255, 0.05);
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		color: #8c97ad;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		letter-spacing: 0.01em;
	}

	.type {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #77839a;
		flex-shrink: 0;
		text-transform: lowercase;
		letter-spacing: 0.03em;
	}

	.slot {
		flex-shrink: 0;
		min-width: 18px;
		height: 18px;
		padding: 0 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(11, 17, 24, 0.42);
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		font-weight: 700;
		color: #76829a;
		font-variant-numeric: tabular-nums;
		transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
	}

	.slot--active {
		color: #f0f4ff;
		border-color: rgba(124, 92, 252, 0.34);
		background: rgba(124, 92, 252, 0.18);
	}

	.bar-action {
		width: 22px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 9px;
		background: rgba(11, 17, 24, 0.36);
		color: #7d88a0;
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
		flex-shrink: 0;
	}

	.bar-action:hover {
		color: #edf2fb;
		border-color: rgba(255, 255, 255, 0.12);
		background: rgba(11, 17, 24, 0.58);
	}

	.bar-action--danger {
		color: #c9929d;
	}

	.bar-action--danger:hover {
		color: #ffd6dc;
		border-color: rgba(255, 128, 148, 0.22);
		background: rgba(71, 21, 31, 0.68);
	}

	.hint {
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #66738d;
		flex-shrink: 0;
	}

	.body {
		flex: 1;
		overflow: hidden;
		position: relative;
		background:
			radial-gradient(circle at top left, rgba(124, 92, 252, 0.06), transparent 28%),
			#0b1118;
	}

	.fullscreen-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: #4a5568;
		letter-spacing: 0.04em;
	}

	.hint-badge {
		position: absolute;
		right: 10px;
		bottom: 8px;
		z-index: 2;
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		color: #66738d;
		pointer-events: none;
		background: rgba(10, 16, 24, 0.78);
		border: 1px solid rgba(109, 122, 149, 0.12);
		border-radius: 999px;
		padding: 3px 8px;
		backdrop-filter: blur(4px);
	}

	.close-confirm {
		position: absolute;
		top: 46px;
		right: 12px;
		z-index: 230;
		width: min(264px, calc(100% - 24px));
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-radius: 18px;
		border: 1px solid rgba(255, 122, 140, 0.16);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 26%),
			rgba(19, 18, 24, 0.95);
		box-shadow:
			0 20px 44px rgba(0, 0, 0, 0.34),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
	}

	.close-confirm-copy {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.close-confirm-title {
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		font-weight: 600;
		color: #f3f6ff;
	}

	.close-confirm-body {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		line-height: 1.45;
		color: #9ea8bd;
	}

	.close-confirm-error {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		line-height: 1.4;
		color: #ff8ea0;
	}

	.close-confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.close-confirm-btn {
		height: 34px;
		padding: 0 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid rgba(118, 127, 150, 0.16);
		background: rgba(255, 255, 255, 0.04);
		color: #d8deeb;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			transform 0.12s ease;
	}

	.close-confirm-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		background: rgba(255, 255, 255, 0.07);
		border-color: rgba(142, 152, 176, 0.24);
	}

	.close-confirm-btn:disabled {
		opacity: 0.52;
		cursor: default;
	}

	.close-confirm-btn--danger {
		border-color: rgba(255, 122, 140, 0.2);
		background: rgba(255, 107, 128, 0.12);
		color: #ffb0bd;
	}

	.close-confirm-btn--danger:hover:not(:disabled) {
		background: rgba(255, 107, 128, 0.18);
		border-color: rgba(255, 122, 140, 0.28);
		color: #ffd7dd;
	}

	.ctx-menu {
		position: absolute;
		z-index: 220;
		width: min(356px, calc(100% - 24px));
		max-height: min(490px, calc(100% - 56px));
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 18%),
			rgba(18, 20, 29, 0.94);
		border: 1px solid rgba(118, 127, 150, 0.18);
		border-radius: 20px;
		box-shadow:
			0 24px 52px rgba(0, 0, 0, 0.42),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		backdrop-filter: blur(22px);
		overflow: auto;
	}

	.ctx-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.ctx-header-copy {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.ctx-title {
		font-family: var(--font-family-mono, monospace);
		font-size: 14px;
		font-weight: 600;
		color: #eef3fc;
	}

	.ctx-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.ctx-chip {
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid rgba(118, 127, 150, 0.16);
		background: rgba(255, 255, 255, 0.035);
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #aab4c7;
	}

	.ctx-status {
		padding: 4px 8px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.045);
		border: 1px solid rgba(118, 127, 150, 0.16);
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 600;
		color: #aab4c7;
		white-space: nowrap;
	}

	.ctx-status.saving {
		color: #f6d58c;
	}

	.ctx-status.error {
		color: #ff8ea0;
	}

	.ctx-error {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		line-height: 1.45;
		color: #ff8ea0;
	}

	.ctx-field,
	.ctx-block {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border-radius: 16px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.03);
	}

	.ctx-block-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}

	.ctx-label {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(205, 210, 222, 0.52);
	}

	.ctx-value {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		color: rgba(205, 210, 222, 0.72);
	}

	.ctx-input {
		width: 100%;
		height: 40px;
		padding: 0 12px;
		border-radius: 14px;
		border: 1px solid rgba(118, 127, 150, 0.16);
		background: rgba(255, 255, 255, 0.04);
		color: #eef3fc;
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		outline: none;
	}

	.ctx-input:focus {
		border-color: rgba(124, 92, 252, 0.34);
		box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.12);
	}

	.ctx-swatch-row,
	.ctx-icon-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.ctx-swatch {
		width: 28px;
		height: 28px;
		padding: 0;
		display: grid;
		place-items: center;
		border: none;
		border-radius: 999px;
		background: transparent;
		cursor: pointer;
		transition: transform 0.12s ease;
	}

	.ctx-swatch:hover,
	.ctx-icon-btn:hover,
	.ctx-theme-card:hover,
	.ctx-font-card:hover,
	.ctx-danger-btn:hover {
		transform: translateY(-1px);
	}

	.ctx-swatch-dot {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: var(--swatch);
		box-shadow:
			0 0 0 2px rgba(10, 12, 18, 0.9),
			0 0 0 4px transparent;
	}

	.ctx-swatch.active .ctx-swatch-dot {
		box-shadow:
			0 0 0 2px rgba(10, 12, 18, 0.9),
			0 0 0 4px var(--ring);
	}

	.ctx-icon-btn {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: 10px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.02);
		color: #8892a5;
		cursor: pointer;
		transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease, transform 0.12s ease;
	}

	.ctx-icon-btn :global(svg) {
		display: block;
	}

	.ctx-icon-btn.active {
		color: #fff;
		border-color: rgba(124, 92, 252, 0.3);
		background: rgba(124, 92, 252, 0.12);
	}

	.ctx-theme-grid,
	.ctx-font-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}

	.ctx-theme-card,
	.ctx-font-card {
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-radius: 14px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.02);
		color: #d6deed;
		cursor: pointer;
		text-align: left;
		transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
	}

	.ctx-theme-card.active,
	.ctx-font-card.active {
		border-color: rgba(124, 92, 252, 0.3);
		background: rgba(124, 92, 252, 0.08);
		box-shadow: 0 10px 20px rgba(12, 16, 24, 0.22);
	}

	.ctx-theme-preview {
		padding: 8px;
		border-radius: 10px;
		border: 1px solid var(--preview-border);
		background: var(--preview-bg);
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: var(--preview-fg);
	}

	.ctx-theme-line {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ctx-theme-line b {
		color: var(--preview-accent);
	}

	.ctx-theme-name,
	.ctx-font-name {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		font-weight: 600;
	}

	.ctx-font-preview {
		color: #9aa4b7;
		font-size: 11px;
		line-height: 1.45;
	}

	.ctx-size-row {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.ctx-stepper {
		display: inline-flex;
		align-items: center;
		width: fit-content;
		border-radius: 14px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.03);
		overflow: hidden;
	}

	.ctx-step-btn {
		width: 36px;
		height: 34px;
		border: none;
		background: transparent;
		color: #e7ecf7;
		font-size: 17px;
		cursor: pointer;
	}

	.ctx-step-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.ctx-step-value {
		min-width: 40px;
		height: 34px;
		display: grid;
		place-items: center;
		border-left: 1px solid rgba(118, 127, 150, 0.14);
		border-right: 1px solid rgba(118, 127, 150, 0.14);
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		color: #eef3fc;
	}

	.ctx-font-sample {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid rgba(118, 127, 150, 0.14);
		background: rgba(255, 255, 255, 0.02);
		color: #e0e6f3;
	}

	.ctx-footer {
		padding-top: 2px;
	}

	.ctx-danger-btn {
		width: 100%;
		height: 40px;
		border: 1px solid rgba(255, 107, 128, 0.14);
		border-radius: 14px;
		background: rgba(255, 107, 128, 0.08);
		color: #ff8ea0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
	}

	.ctx-danger-btn:hover {
		background: rgba(255, 107, 128, 0.12);
		border-color: rgba(255, 107, 128, 0.24);
	}
</style>
