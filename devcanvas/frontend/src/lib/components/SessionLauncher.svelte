<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type LiveTmuxSession } from '$lib/api';
	import { sessions, type Session } from '$lib/stores/sessions';

	type SessionType = 'tmux' | 'pty';

	type Props = {
		workspaceId: string;
		onAddTerminal?: (sessionId: string, sessionName: string, sessionType: 'tmux' | 'pty') => void;
	};

	let { workspaceId, onAddTerminal }: Props = $props();

	let showCreateModal = $state(false);
	let tmuxAvailable = $state<boolean | null>(null);
	let createError = $state<string | null>(null);
	let createType = $state<SessionType>('tmux');
	let createName = $state('');
	let creating = $state(false);
	let liveTmuxSessions = $state<LiveTmuxSession[]>([]);
	let liveTmuxLoading = $state(false);
	let liveTmuxError = $state<string | null>(null);
	let attachingTmuxName = $state<string | null>(null);

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}

	function upsertSession(nextSession: Session) {
		sessions.update((current) => [nextSession, ...current.filter((session) => session.id !== nextSession.id)]);
	}

	function getDefaultSessionType(): SessionType {
		return tmuxAvailable === true ? 'tmux' : 'pty';
	}

	function getReservedNames(type: SessionType) {
		const names = new Set(
			$sessions
				.filter((session) => (type === 'tmux' ? session.type === 'tmux' : session.type === 'pty'))
				.map((session) => session.name)
		);

		if (type === 'tmux') {
			for (const session of liveTmuxSessions) names.add(session.name);
		}

		return names;
	}

	function getDefaultName(type: SessionType = createType): string {
		const reservedNames = getReservedNames(type);
		const maxIndex = [...reservedNames]
			.map((name) => {
				const match = /^dev-(\d+)/i.exec(name);
				return match ? Number(match[1]) : NaN;
			})
			.filter((value) => Number.isFinite(value))
			.reduce((max, value) => Math.max(max, value), 0);

		return `dev-${maxIndex + 1}`;
	}

	function closeCreateModal(force = false) {
		if (!force && (creating || attachingTmuxName)) return;
		showCreateModal = false;
		createError = null;
		liveTmuxError = null;
	}

	async function refreshLiveTmuxSessions() {
		if (tmuxAvailable === false) {
			liveTmuxSessions = [];
			liveTmuxError = null;
			return;
		}

		liveTmuxLoading = true;
		liveTmuxError = null;
		try {
			liveTmuxSessions = await api.sessions.listLiveTmux(workspaceId);
		} catch (error) {
			liveTmuxSessions = [];
			liveTmuxError =
				error instanceof Error ? error.message : 'No se pudieron cargar las sesiones tmux abiertas';
		} finally {
			liveTmuxLoading = false;
		}
	}

	async function openCreateModal(type: SessionType = getDefaultSessionType()) {
		createType = type === 'tmux' && tmuxAvailable === false ? 'pty' : type;
		createError = null;
		showCreateModal = true;

		if (createType === 'tmux') {
			await refreshLiveTmuxSessions();
		} else {
			liveTmuxError = null;
		}

		createName = getDefaultName(createType);
	}

	function selectCreateType(type: SessionType) {
		if (type === 'tmux' && tmuxAvailable === false) return;
		createType = type;
		createError = null;
		createName = getDefaultName(type);

		if (type === 'tmux') {
			void refreshLiveTmuxSessions();
		}
	}

	function isCreateReady(): boolean {
		if (creating || attachingTmuxName) return false;
		if (createType === 'tmux' && tmuxAvailable === false) return false;
		return createName.trim().length > 0;
	}

	function openTrackedTmuxSession(session: LiveTmuxSession) {
		if (!session.sessionId || !session.inCurrentWorkspace) return;

		closeCreateModal(true);
		onAddTerminal?.(session.sessionId, session.name, 'tmux');
	}

	async function importLiveTmuxSession(session: LiveTmuxSession) {
		if (attachingTmuxName || session.tracked || !session.name) return;

		attachingTmuxName = session.name;
		createError = null;
		try {
			const imported = await api.sessions.importTmux(workspaceId, session.name);
			upsertSession(imported);
			closeCreateModal(true);
			if (imported.type === 'tmux' || imported.type === 'pty') {
				onAddTerminal?.(imported.id, imported.name, imported.type);
			}
		} catch (error) {
			createError = error instanceof Error ? error.message : 'No se pudo importar la sesion tmux';
		} finally {
			attachingTmuxName = null;
			await refreshLiveTmuxSessions();
		}
	}

	async function createSession() {
		if (!isCreateReady()) return;

		const trimmedName = createName.trim();
		if (createType === 'tmux') {
			const liveMatch = liveTmuxSessions.find((session) => session.name === trimmedName) ?? null;
			if (liveMatch) {
				if (liveMatch.inCurrentWorkspace) {
					openTrackedTmuxSession(liveMatch);
					return;
				}

				if (!liveMatch.tracked) {
					await importLiveTmuxSession(liveMatch);
					return;
				}

				createError = `La sesion "${trimmedName}" ya pertenece a ${liveMatch.workspaceName ?? 'otro workspace'}`;
				return;
			}
		}

		creating = true;
		createError = null;
		try {
			const session = await api.sessions.create(workspaceId, trimmedName, createType);
			upsertSession(session);
			closeCreateModal(true);
			if (session.type === 'tmux' || session.type === 'pty') {
				onAddTerminal?.(session.id, session.name, session.type);
			}
		} catch (error) {
			createError = error instanceof Error ? error.message : 'Failed to create session';
			console.error('Failed to create session:', error);
		} finally {
			creating = false;
			if (showCreateModal && createType === 'tmux') {
				await refreshLiveTmuxSessions();
			}
		}
	}

	function handleModalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeCreateModal();
			return;
		}

		if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
			event.preventDefault();
			void createSession();
		}
	}

	function getLiveSessionMeta(session: LiveTmuxSession) {
		if (session.inCurrentWorkspace) return 'Lista para volver a abrir en este workspace';
		if (!session.tracked) return 'Activa en tmux y lista para importar';
		return `Vinculada a ${session.workspaceName ?? 'otro workspace'}`;
	}

	onMount(() => {
		void api
			.health()
			.then((health) => {
				tmuxAvailable = Boolean(health.tmux);
			})
			.catch(() => {
				tmuxAvailable = false;
			});

		const handler = (event: Event) => {
			const detail = (event as CustomEvent<{ type?: SessionType }>).detail;
			void openCreateModal(detail?.type ?? getDefaultSessionType());
		};

		window.addEventListener('devcanvas:new-session', handler);
		return () => window.removeEventListener('devcanvas:new-session', handler);
	});
</script>

{#if showCreateModal}
	<div
		class="backdrop"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(event) => {
			if (event.target === event.currentTarget) closeCreateModal();
		}}
		onkeydown={handleModalKeydown}
	>
		<div class="modal" role="presentation" onclick={(event) => event.stopPropagation()}>
			<div class="modal-toggle">
				<button
					class="toggle-opt"
					class:active={createType === 'tmux'}
					onclick={() => selectCreateType('tmux')}
					disabled={tmuxAvailable === false}
				>
					tmux
				</button>
				<button
					class="toggle-opt"
					class:active={createType === 'pty'}
					onclick={() => selectCreateType('pty')}
				>
					local
				</button>
			</div>

			<div class="modal-body">
				<p class="modal-desc">
					{#if createType === 'tmux'}
						{#if tmuxAvailable === false}
							tmux no esta disponible en esta maquina. Usa una terminal local.
						{:else}
							Retoma una sesion tmux abierta o crea una nueva sesion persistente.
						{/if}
					{:else}
						Abre un proceso local directo usando el shell por defecto del sistema.
					{/if}
				</p>

				{#if createError}
					<p class="modal-error">{createError}</p>
				{/if}

				{#if createType === 'tmux' && tmuxAvailable !== false}
					<section class="tmux-library">
						<div class="tmux-library-head">
							<div>
								<div class="section-kicker">Sesiones abiertas</div>
								<div class="section-copy">Recupera una sesion viva o importala a este workspace.</div>
							</div>
							<button class="mini-action" type="button" onclick={() => void refreshLiveTmuxSessions()}>
								Actualizar
							</button>
						</div>

						{#if liveTmuxLoading}
							<div class="tmux-empty">Buscando sesiones tmux activas...</div>
						{:else if liveTmuxError}
							<div class="tmux-empty tmux-empty--error">{liveTmuxError}</div>
						{:else if liveTmuxSessions.length === 0}
							<div class="tmux-empty">No hay sesiones tmux abiertas ahora mismo.</div>
						{:else}
							<div class="tmux-list">
								{#each liveTmuxSessions as session (session.name)}
									<div class="tmux-item" class:tmux-item--current={session.inCurrentWorkspace}>
										<div class="tmux-copy">
											<div class="tmux-title-row">
												<span class="tmux-name">{session.name}</span>
												{#if session.inCurrentWorkspace}
													<span class="tmux-tag">este workspace</span>
												{:else if !session.tracked}
													<span class="tmux-tag tmux-tag--ghost">sin vincular</span>
												{/if}
											</div>
											<span class="tmux-meta">{getLiveSessionMeta(session)}</span>
										</div>

										{#if session.inCurrentWorkspace}
											<button class="tmux-action" type="button" onclick={() => openTrackedTmuxSession(session)}>
												Abrir
											</button>
										{:else if !session.tracked}
											<button
												class="tmux-action tmux-action--primary"
												type="button"
												disabled={attachingTmuxName === session.name}
												onclick={() => void importLiveTmuxSession(session)}
											>
												{attachingTmuxName === session.name ? 'Importando…' : 'Importar'}
											</button>
										{:else}
											<span class="tmux-locked">{session.workspaceName ?? 'otro workspace'}</span>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</section>
				{/if}

				<label class="field">
					<span class="field-label">{createType === 'tmux' ? 'Nueva sesion' : 'Nombre'}</span>
					<input
						class="field-input"
						type="text"
						bind:value={createName}
						placeholder={createType === 'tmux' ? 'dev-1' : 'local-1'}
						use:focusOnMount
					/>
				</label>
			</div>

			<div class="modal-foot">
				<button class="btn-ghost" type="button" onclick={() => closeCreateModal()}>Cancelar</button>
				<button class="btn-primary" type="button" onclick={() => void createSession()} disabled={!isCreateReady()}>
					{creating ? 'Creando…' : createType === 'tmux' ? 'Crear tmux' : 'Crear local'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(3, 5, 10, 0.62);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.modal {
		width: min(560px, calc(100vw - 40px));
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 18%),
			var(--surface);
		border: 1px solid rgba(129, 141, 170, 0.16);
		border-radius: 24px;
		overflow: hidden;
		box-shadow:
			0 30px 90px rgba(0, 0, 0, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}

	.modal-toggle {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		padding: 8px;
		gap: 8px;
		border-bottom: 1px solid rgba(126, 136, 160, 0.12);
		background: rgba(255, 255, 255, 0.014);
	}

	.toggle-opt {
		height: 44px;
		border: 1px solid rgba(126, 136, 160, 0.1);
		border-radius: 999px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 60%),
			rgba(14, 18, 27, 0.78);
		font-family: var(--font-family-mono, monospace);
		font-size: 12px;
		color: var(--muted);
		cursor: pointer;
		transition:
			border-color 0.16s ease,
			background 0.16s ease,
			color 0.16s ease,
			transform 0.16s ease;
	}

	.toggle-opt:hover:not(:disabled) {
		color: var(--text);
		transform: translateY(-1px);
	}

	.toggle-opt.active {
		color: #f3f6ff;
		border-color: rgba(124, 92, 252, 0.26);
		background:
			linear-gradient(180deg, rgba(124, 92, 252, 0.22), rgba(124, 92, 252, 0.06)),
			rgba(19, 15, 38, 0.92);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}

	.toggle-opt:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.modal-body {
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.modal-desc,
	.modal-error,
	.section-copy,
	.tmux-meta {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		line-height: 1.6;
	}

	.modal-desc,
	.section-copy,
	.tmux-meta {
		color: var(--muted);
	}

	.modal-error,
	.tmux-empty--error {
		color: #ff7c93;
	}

	.tmux-library {
		padding: 14px;
		border-radius: 18px;
		border: 1px solid rgba(126, 136, 160, 0.12);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent 40%),
			rgba(11, 15, 24, 0.46);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.tmux-library-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.section-kicker,
	.field-label {
		display: block;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 10px;
		font-weight: 600;
		color: #727b92;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.field-label {
		margin-bottom: 6px;
	}

	.mini-action {
		padding: 7px 11px;
		border-radius: 999px;
		border: 1px solid rgba(126, 136, 160, 0.14);
		background: rgba(255, 255, 255, 0.03);
		color: #cad2e5;
		font-family: var(--font-family-mono, monospace);
		font-size: 11px;
		cursor: pointer;
		transition: border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
	}

	.mini-action:hover {
		transform: translateY(-1px);
		border-color: rgba(124, 92, 252, 0.24);
		background: rgba(124, 92, 252, 0.08);
	}

	.tmux-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: 240px;
		overflow: auto;
		padding-right: 2px;
	}

	.tmux-item,
	.tmux-empty {
		border-radius: 16px;
		border: 1px solid rgba(126, 136, 160, 0.11);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 55%),
			rgba(15, 18, 28, 0.72);
	}

	.tmux-item {
		padding: 12px 13px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.tmux-item--current {
		border-color: rgba(124, 92, 252, 0.18);
		background:
			linear-gradient(180deg, rgba(124, 92, 252, 0.08), transparent 60%),
			rgba(16, 19, 31, 0.8);
	}

	.tmux-copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tmux-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.tmux-name {
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		font-weight: 600;
		color: #f3f6ff;
	}

	.tmux-tag,
	.tmux-locked {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 10px;
		border-radius: 999px;
		font-family: var(--font-family-mono, monospace);
		font-size: 11px;
		border: 1px solid rgba(126, 136, 160, 0.12);
		background: rgba(124, 92, 252, 0.08);
		color: #d9ddf5;
		white-space: nowrap;
	}

	.tmux-tag--ghost,
	.tmux-locked {
		background: rgba(255, 255, 255, 0.025);
		color: #9ba6c1;
	}

	.tmux-action {
		height: 32px;
		padding: 0 14px;
		border-radius: 999px;
		border: 1px solid rgba(126, 136, 160, 0.14);
		background: rgba(255, 255, 255, 0.03);
		color: #eef2ff;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			transform 0.12s ease,
			opacity 0.12s ease;
	}

	.tmux-action:hover:not(:disabled) {
		transform: translateY(-1px);
		border-color: rgba(124, 92, 252, 0.24);
	}

	.tmux-action--primary,
	.btn-primary {
		background: linear-gradient(180deg, rgba(124, 92, 252, 0.96), rgba(103, 72, 241, 0.96));
		border-color: transparent;
		color: #fff;
	}

	.tmux-action:disabled,
	.btn-primary:disabled {
		opacity: 0.45;
		cursor: default;
		transform: none;
	}

	.tmux-empty {
		padding: 14px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		line-height: 1.6;
		color: var(--muted);
	}

	.field {
		display: block;
	}

	.field-input {
		width: 100%;
		padding: 11px 14px;
		background: rgba(255, 255, 255, 0.028);
		border: 1px solid rgba(126, 136, 160, 0.14);
		border-radius: 14px;
		color: var(--text);
		font-family: var(--font-family-mono, monospace);
		font-size: 13px;
		outline: none;
		box-sizing: border-box;
		transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
	}

	.field-input:focus {
		border-color: rgba(124, 92, 252, 0.34);
		box-shadow: 0 0 0 4px rgba(124, 92, 252, 0.12);
		background: rgba(255, 255, 255, 0.04);
	}

	.modal-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding: 16px 22px 20px;
		border-top: 1px solid rgba(126, 136, 160, 0.1);
		background: rgba(255, 255, 255, 0.015);
	}

	.btn-ghost,
	.btn-primary {
		height: 40px;
		padding: 0 18px;
		border-radius: 999px;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			transform 0.12s ease,
			opacity 0.12s ease;
	}

	.btn-ghost {
		background: transparent;
		border: 1px solid rgba(126, 136, 160, 0.14);
		color: var(--muted);
	}

	.btn-ghost:hover {
		transform: translateY(-1px);
		border-color: rgba(126, 136, 160, 0.24);
		color: var(--text);
	}

	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.05);
	}
</style>
