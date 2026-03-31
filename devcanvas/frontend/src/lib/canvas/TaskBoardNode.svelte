<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { dndzone } from 'svelte-dnd-action';
	import { Handle, NodeResizer, Position } from '@xyflow/svelte';
	import { api, type Task, type TaskActivity, type TaskStatus } from '$lib/api';
	import { DEV_CANVAS_BACKEND_WS_ORIGIN } from '$lib/api/backend';
	import { BufferedReconnectingWebSocket } from '$lib/ws/client';

	interface Props {
		id: string;
		selected?: boolean;
		data: { workspaceId: string };
	}

	type DndItem = { id: string; task: Task };

	const FLIP_MS = 180;

	const columnDefs: Array<{ key: TaskStatus; label: string; tone: string }> = [
		{ key: 'todo', label: 'Pendiente', tone: '#8f98ae' },
		{ key: 'doing', label: 'En curso', tone: '#6d7cff' },
		{ key: 'done', label: 'Hecho', tone: '#39d98a' },
	];

	const statusLabels: Record<TaskStatus, string> = {
		todo: 'Pendiente',
		doing: 'En curso',
		done: 'Hecho',
	};

	let { id, selected = false, data }: Props = $props();

	let ws: BufferedReconnectingWebSocket | null = null;
	let tasks = $state<Task[]>([]);
	let activitiesByTask = $state<Record<string, TaskActivity[]>>({});
	let loading = $state(true);
	let error = $state<string | null>(null);
	let connected = $state(false);
	let creatingTask = $state(false);
	let savingTask = $state(false);
	let postingActivity = $state(false);
	let openingSession = $state(false);
	let deletingTask = $state(false);
	let selectedTaskId = $state<string | null>(null);
	let loadingActivityTaskId = $state<string | null>(null);
	let draftTitle = $state('');
	let draftDescription = $state('');
	let draftWorkdir = $state('');
	let draftLiveNote = $state('');
	let activityDraft = $state('');
	let lastHydratedTaskId = '';
	let showDetail = $state(false);
	let inlineComposerCol = $state<TaskStatus | null>(null);
	let inlineComposerValue = $state('');
	let inlineComposerInput = $state<HTMLInputElement | null>(null);
	let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let savedFeedback = $state(false);
	let flashingTaskId = $state<string | null>(null);
	let contextMenu = $state<{ taskId: string; x: number; y: number } | null>(null);
	let confirmDeleteId = $state<string | null>(null);

	// ─── Mentions ───────────────────────────────────────────────────────────────
	type MentionSuggestion = { type: 'task' | 'note'; id: string; label: string };
	const MENTION_RE = /@\[([^\]]+)\]\((task|note):([^)]+)\)/g;
	let mentionQuery = $state<string | null>(null);
	let mentionAnchor = $state<{ el: HTMLTextAreaElement | HTMLInputElement; start: number } | null>(null);
	let mentionIndex = $state(0);

	const mentionSuggestions = $derived.by(() => {
		if (mentionQuery === null) return [];
		const q = mentionQuery.toLowerCase();
		const results: MentionSuggestion[] = [];
		for (const t of tasks) {
			if (t.id === selectedTaskId) continue;
			if (t.title.toLowerCase().includes(q)) {
				results.push({ type: 'task', id: t.id, label: t.title });
			}
		}
		// Notes from canvas are not directly accessible here — we only suggest tasks
		return results.slice(0, 8);
	});

	function handleMentionInput(e: Event) {
		const el = e.target as HTMLTextAreaElement | HTMLInputElement;
		const val = el.value;
		const pos = el.selectionStart ?? val.length;
		// Look backwards from cursor for an unmatched @
		const before = val.slice(0, pos);
		const atIdx = before.lastIndexOf('@');
		if (atIdx === -1 || (atIdx > 0 && /\w/.test(before[atIdx - 1]))) {
			mentionQuery = null;
			mentionAnchor = null;
			return;
		}
		const query = before.slice(atIdx + 1);
		if (query.includes(' ') && query.length > 20) {
			mentionQuery = null;
			mentionAnchor = null;
			return;
		}
		mentionQuery = query;
		mentionAnchor = { el, start: atIdx };
		mentionIndex = 0;
	}

	function insertMention(suggestion: MentionSuggestion) {
		if (!mentionAnchor) return;
		const el = mentionAnchor.el;
		const val = el.value;
		const pos = el.selectionStart ?? val.length;
		const token = `@[${suggestion.label}](${suggestion.type}:${suggestion.id})`;
		const newVal = val.slice(0, mentionAnchor.start) + token + val.slice(pos);
		// Update the correct draft
		if (el === descTextarea) {
			draftDescription = newVal;
			triggerAutoSave();
		} else {
			activityDraft = newVal;
		}
		mentionQuery = null;
		mentionAnchor = null;
		// Restore cursor after token
		const cursorPos = mentionAnchor ? mentionAnchor.start + token.length : newVal.length;
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(cursorPos, cursorPos);
		});
	}

	function handleMentionKeydown(e: KeyboardEvent) {
		if (mentionQuery === null || mentionSuggestions.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			mentionIndex = (mentionIndex + 1) % mentionSuggestions.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			mentionIndex = (mentionIndex - 1 + mentionSuggestions.length) % mentionSuggestions.length;
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			insertMention(mentionSuggestions[mentionIndex]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			mentionQuery = null;
			mentionAnchor = null;
		}
	}

	function closeMentions() {
		mentionQuery = null;
		mentionAnchor = null;
	}

	// ─── Mention rendering ──────────────────────────────────────────────────────
	type TextSegment = { type: 'text'; value: string } | { type: 'mention'; label: string; refType: 'task' | 'note'; refId: string };

	function parseMentions(text: string): TextSegment[] {
		const segments: TextSegment[] = [];
		let lastIndex = 0;
		const re = new RegExp(MENTION_RE.source, 'g');
		let match;
		while ((match = re.exec(text)) !== null) {
			if (match.index > lastIndex) {
				segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
			}
			segments.push({ type: 'mention', label: match[1], refType: match[2] as 'task' | 'note', refId: match[3] });
			lastIndex = re.lastIndex;
		}
		if (lastIndex < text.length) {
			segments.push({ type: 'text', value: text.slice(lastIndex) });
		}
		return segments;
	}

	function mentionExists(refType: string, refId: string): boolean {
		if (refType === 'task') return tasks.some((t) => t.id === refId);
		return false; // notes not tracked here
	}

	function handleMentionClick(refType: string, refId: string) {
		if (refType === 'task') {
			const task = tasks.find((t) => t.id === refId);
			if (task) void selectTask(task.id);
		}
	}

	let descTextarea = $state<HTMLTextAreaElement | null>(null);
	let editingDesc = $state(false);

	function startEditDesc() {
		editingDesc = true;
		requestAnimationFrame(() => {
			if (descTextarea) {
				descTextarea.focus();
				autoGrow(descTextarea);
			}
		});
	}

	function stopEditDesc() {
		editingDesc = false;
		triggerAutoSave();
	}

	// ─── Auto-grow for description textarea ─────────────────────────────────────
	function autoGrow(el: HTMLTextAreaElement) {
		el.style.height = 'auto';
		el.style.height = Math.max(48, el.scrollHeight) + 'px';
	}

	// ─── DnD column items (derived + mutable on drag) ───────────────────────────
	let columnItems = $state<Record<TaskStatus, DndItem[]>>({
		todo: [],
		doing: [],
		done: [],
	});

	// Rebuild column items whenever tasks change (but not during a drag)
	let isDragging = false;

	$effect(() => {
		if (isDragging) return;
		const grouped: Record<TaskStatus, DndItem[]> = { todo: [], doing: [], done: [] };
		for (const task of tasks) {
			grouped[task.status]?.push({ id: task.id, task });
		}
		for (const key of Object.keys(grouped) as TaskStatus[]) {
			grouped[key].sort((a, b) => b.task.updatedAt - a.task.updatedAt);
		}
		columnItems = grouped;
	});

	const selectedTask = $derived(tasks.find((task) => task.id === selectedTaskId) ?? null);
	const selectedActivities = $derived(
		selectedTask ? activitiesByTask[selectedTask.id] ?? [] : []
	);

	function hydrateTaskDrafts(task: Task | null) {
		if (!task) {
			lastHydratedTaskId = '';
			draftTitle = '';
			draftDescription = '';
			draftWorkdir = '';
			draftLiveNote = '';
			activityDraft = '';
			editingDesc = false;
			return;
		}
		const signature = `${task.id}:${task.updatedAt}:${task.activeSessionId ?? ''}`;
		if (signature === lastHydratedTaskId) return;
		lastHydratedTaskId = signature;
		draftTitle = task.title;
		draftDescription = task.description;
		draftWorkdir = task.workdir ?? '';
		draftLiveNote = task.liveNote;
		editingDesc = false;
	}

	$effect(() => {
		hydrateTaskDrafts(selectedTask);
	});

	$effect(() => {
		if (!inlineComposerCol) return;
		queueMicrotask(() => inlineComposerInput?.focus());
	});

	// ─── Auto-save debounce ─────────────────────────────────────────────────────
	function triggerAutoSave() {
		if (autoSaveTimer) clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			void doAutoSave();
		}, 800);
	}

	async function doAutoSave() {
		if (!selectedTask || savingTask) return;
		const titleChanged = draftTitle.trim() !== selectedTask.title;
		const descChanged = draftDescription.trim() !== selectedTask.description;
		const workdirChanged = (draftWorkdir.trim() || null) !== (selectedTask.workdir ?? null);
		const noteChanged = draftLiveNote.trim() !== selectedTask.liveNote;
		if (!titleChanged && !descChanged && !workdirChanged && !noteChanged) return;
		savingTask = true;
		try {
			await api.tasks.update(selectedTask.id, {
				title: draftTitle.trim(),
				description: draftDescription.trim(),
				workdir: draftWorkdir.trim() || null,
				liveNote: draftLiveNote.trim(),
				actorType: 'user',
				actorLabel: 'Tu',
			});
			savedFeedback = true;
			setTimeout(() => { savedFeedback = false; }, 1200);
		} catch {
			// silent
		} finally {
			savingTask = false;
		}
	}

	// ─── Inline column create ───────────────────────────────────────────────────
	async function createInlineTask(status: TaskStatus) {
		const title = inlineComposerValue.trim();
		if (!title || creatingTask) return;
		creatingTask = true;
		try {
			let task = await api.tasks.create(data.workspaceId, {
				title,
				description: '',
				workdir: null,
				actorType: 'user',
				actorLabel: 'Tu',
			});
			if (status !== 'todo') {
				task = await api.tasks.move(task.id, status, { actorType: 'user', actorLabel: 'Tu' });
			}
			upsertTask(task);
			selectedTaskId = task.id;
			showDetail = true;
			inlineComposerCol = null;
			inlineComposerValue = '';
			await ensureActivity(task.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Error al crear tarea';
		} finally {
			creatingTask = false;
		}
	}

	// ─── DnD handlers ───────────────────────────────────────────────────────────
	function handleConsider(status: TaskStatus, e: CustomEvent<{ items: DndItem[]; info: { source: string; trigger: string } }>) {
		isDragging = true;
		columnItems[status] = e.detail.items;
		columnItems = { ...columnItems };
	}

	function handleFinalize(status: TaskStatus, e: CustomEvent<{ items: DndItem[]; info: { source: string; trigger: string; id: string } }>) {
		columnItems[status] = e.detail.items;
		columnItems = { ...columnItems };

		// Find if a task moved into this column from a different status
		const droppedId = e.detail.info.id;
		const task = tasks.find((t) => t.id === droppedId);
		if (task && task.status !== status) {
			// Keep isDragging true until moveTask updates tasks, so the $effect
			// doesn't rebuild columnItems and break the DnD final state
			void moveTask(task, status).then(() => { isDragging = false; });
		} else {
			isDragging = false;
		}
	}

	// ─── Context menu ───────────────────────────────────────────────────────────
	function openContextMenu(taskId: string, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		const boardEl = (event.currentTarget as HTMLElement).closest('.board');
		const rect = boardEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
		contextMenu = {
			taskId,
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
		confirmDeleteId = null;
	}

	function closeContextMenu() {
		contextMenu = null;
		confirmDeleteId = null;
	}

	async function contextMoveTask(status: TaskStatus) {
		if (!contextMenu) return;
		const task = tasks.find((t) => t.id === contextMenu.taskId);
		if (task) await moveTask(task, status);
		closeContextMenu();
	}

	async function contextDeleteTask() {
		if (!contextMenu) return;
		if (confirmDeleteId !== contextMenu.taskId) {
			confirmDeleteId = contextMenu.taskId;
			return;
		}
		const taskId = contextMenu.taskId;
		closeContextMenu();
		try {
			await api.tasks.delete(taskId);
		} catch {
			// silent
		}
	}

	async function contextOpenTerminal() {
		if (!contextMenu) return;
		const task = tasks.find((t) => t.id === contextMenu.taskId);
		if (!task) return;
		closeContextMenu();
		selectedTaskId = task.id;
		await openTerminalForTask();
	}

	// ─── Helpers ────────────────────────────────────────────────────────────────
	function formatRelative(dateValue: number | null | undefined): string {
		if (!dateValue) return 'ahora';
		const diff = Date.now() - dateValue;
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);
		if (mins < 1) return 'ahora';
		if (mins < 60) return `${mins}m`;
		if (hours < 24) return `${hours}h`;
		if (days < 7) return `${days}d`;
		return new Date(dateValue).toLocaleDateString('es', { month: 'short', day: 'numeric' });
	}

	function titleToSessionName(title: string) {
		const compact = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 24);
		return compact ? `task-${compact}` : `task-${Date.now()}`;
	}

	function sortTasks(nextTasks: Task[]) {
		return [...nextTasks].sort((left, right) => right.updatedAt - left.updatedAt);
	}

	function upsertTask(task: Task) {
		const existing = tasks.find((t) => t.id === task.id);
		const statusChanged = existing && existing.status !== task.status;
		tasks = sortTasks([task, ...tasks.filter((entry) => entry.id !== task.id)]);
		if (!selectedTaskId) selectedTaskId = task.id;
		if (statusChanged) {
			flashingTaskId = task.id;
			setTimeout(() => { if (flashingTaskId === task.id) flashingTaskId = null; }, 1200);
		}
	}

	function removeTask(taskId: string) {
		const remaining = tasks.filter((task) => task.id !== taskId);
		tasks = remaining;
		activitiesByTask = Object.fromEntries(
			Object.entries(activitiesByTask).filter(([key]) => key !== taskId)
		);
		if (selectedTaskId === taskId) {
			selectedTaskId = remaining[0]?.id ?? null;
		}
	}

	function appendActivity(activity: TaskActivity) {
		const current = activitiesByTask[activity.taskId] ?? [];
		activitiesByTask = {
			...activitiesByTask,
			[activity.taskId]: [activity, ...current.filter((item) => item.id !== activity.id)].slice(0, 100),
		};
	}

	// ─── API calls ──────────────────────────────────────────────────────────────
	async function loadTasks() {
		loading = true;
		error = null;
		try {
			const fetched = await api.tasks.list(data.workspaceId);
			tasks = sortTasks(fetched);
			selectedTaskId = selectedTaskId && fetched.some((task) => task.id === selectedTaskId)
				? selectedTaskId
				: fetched[0]?.id ?? null;
			if (selectedTaskId) void ensureActivity(selectedTaskId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Error al cargar tareas';
			tasks = [];
			selectedTaskId = null;
		} finally {
			loading = false;
		}
	}

	async function ensureActivity(taskId: string) {
		if (activitiesByTask[taskId]) return;
		loadingActivityTaskId = taskId;
		try {
			const activity = await api.tasks.getActivity(taskId, 60);
			activitiesByTask = { ...activitiesByTask, [taskId]: activity };
		} catch {
			// silent
		} finally {
			loadingActivityTaskId = null;
		}
	}

	async function selectTask(taskId: string) {
		inlineComposerCol = null;
		inlineComposerValue = '';
		if (selectedTaskId === taskId) {
			showDetail = !showDetail;
			if (showDetail) await ensureActivity(taskId);
			return;
		}
		selectedTaskId = taskId;
		showDetail = true;
		await ensureActivity(taskId);
	}

	async function moveTask(task: Task, status: TaskStatus) {
		if (task.status === status) return;
		const previous = tasks;
		const now = Date.now();
		tasks = sortTasks(
			tasks.map((entry) =>
				entry.id === task.id
					? { ...entry, status, updatedAt: now, resolvedAt: status === 'done' ? now : null }
					: entry
			)
		);
		error = null;
		try {
			await api.tasks.move(task.id, status, { actorType: 'user', actorLabel: 'Tu' });
		} catch (err) {
			tasks = previous;
			error = err instanceof Error ? err.message : 'Error al mover tarea';
		}
	}

	async function saveSelectedTask() {
		if (!selectedTask || savingTask) return;
		savingTask = true;
		error = null;
		try {
			await api.tasks.update(selectedTask.id, {
				title: draftTitle.trim(),
				description: draftDescription.trim(),
				workdir: draftWorkdir.trim() || null,
				liveNote: draftLiveNote.trim(),
				actorType: 'user',
				actorLabel: 'Tu',
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Error al guardar';
		} finally {
			savingTask = false;
		}
	}

	async function postActivity() {
		if (!selectedTask || postingActivity) return;
		const message = activityDraft.trim();
		if (!message) return;
		postingActivity = true;
		error = null;
		try {
			await api.tasks.addActivity(selectedTask.id, {
				message,
				kind: 'note',
				liveNote: message,
				actorType: 'user',
				actorLabel: 'Tu',
			});
			activityDraft = '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Error al publicar';
		} finally {
			postingActivity = false;
		}
	}

	async function resolveSelectedTask() {
		if (!selectedTask || savingTask) return;
		savingTask = true;
		try {
			await api.tasks.resolve(selectedTask.id, {
				note: draftLiveNote.trim(),
				actorType: 'user',
				actorLabel: 'Tu',
			});
		} catch {
			// silent
		} finally {
			savingTask = false;
		}
	}

	async function openTerminalForTask() {
		if (!selectedTask || openingSession) return;
		openingSession = true;
		error = null;
		try {
			const session = await api.sessions.create(
				data.workspaceId,
				titleToSessionName(selectedTask.title),
				'pty',
				undefined,
				selectedTask.workdir ?? undefined
			);
			window.dispatchEvent(
				new CustomEvent('devcanvas:add-terminal-node', {
					detail: { sessionId: session.id, sessionName: session.name, sessionType: session.type },
				})
			);
			await api.tasks.update(selectedTask.id, {
				activeSessionId: session.id,
				actorType: 'system',
				actorLabel: 'DevCanvas',
			});
			if (selectedTask.status === 'todo') {
				await api.tasks.move(selectedTask.id, 'doing', { actorType: 'system', actorLabel: 'DevCanvas' });
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Error al abrir terminal';
		} finally {
			openingSession = false;
		}
	}

	async function deleteSelectedTask() {
		if (!selectedTask || deletingTask) return;
		deletingTask = true;
		try {
			await api.tasks.delete(selectedTask.id);
			removeTask(selectedTask.id);
			showDetail = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Error al eliminar';
		} finally {
			deletingTask = false;
		}
	}

	function removeBoard() {
		window.dispatchEvent(new CustomEvent('devcanvas:remove-node', { detail: { id } }));
	}

	onMount(() => {
		void loadTasks();

		ws = new BufferedReconnectingWebSocket(`${DEV_CANVAS_BACKEND_WS_ORIGIN}/ws`);
		ws.onConnect = () => {
			connected = true;
			ws?.send({
				type: 'tasks:subscribe',
				id: `tasks-${crypto.randomUUID()}`,
				workspaceId: data.workspaceId,
			});
		};
		ws.onDisconnect = () => { connected = false; };
		ws.onMessage = (msg) => {
			if (msg.type === 'task:upsert' && msg.workspaceId === data.workspaceId && msg.task) {
				upsertTask(msg.task as Task);
				return;
			}
			if (msg.type === 'task:delete' && msg.workspaceId === data.workspaceId && typeof msg.taskId === 'string') {
				removeTask(msg.taskId);
				return;
			}
			if (msg.type === 'task:activity' && msg.workspaceId === data.workspaceId && msg.activity) {
				appendActivity(msg.activity as TaskActivity);
			}
		};

		return () => {
			if (ws) {
				ws.send({
					type: 'tasks:unsubscribe',
					id: `unsub-${crypto.randomUUID()}`,
					workspaceId: data.workspaceId,
				});
				ws.destroy();
				ws = null;
			}
		};
	});
</script>

<NodeResizer
	minWidth={720}
	minHeight={420}
	isVisible={selected}
	lineStyle="border: 1px dashed rgba(122, 134, 255, 0.48); border-radius: 20px;"
	handleStyle="background:#6d7cff; border: 2px solid #080b12; width: 10px; height: 10px; border-radius: 3px; cursor: nwse-resize;"
/>

<div class="board nopan nowheel" class:board--offline={!connected}>
	<!-- Header -->
	<header class="bar task-board-drag-handle">
		<div class="bar-left">
			<span class="bar-title">Tareas</span>
			<span class="dot" class:dot--live={connected}></span>
		</div>
		<div class="bar-right nodrag">
			<button class="btn btn--ghost nodrag" aria-label="Cerrar tablero" title="Cerrar tablero" onclick={removeBoard}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>
	</header>

	{#if error}
		<div class="alert">{error}</div>
	{/if}

	{#if !connected && !loading}
		<div class="offline-banner" transition:slide={{ duration: 120 }}>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
			Reconectando...
		</div>
	{/if}

	<!-- Body -->
	<div class="body">
		<!-- Kanban columns -->
		<section class="cols nopan nowheel">
			{#if loading}
				<div class="empty-state">Cargando...</div>
			{:else}
				{#each columnDefs as colDef}
					<div class="col">
						<div class="col-head">
							<span class="col-dot" style={`--t:${colDef.tone}`}></span>
							<span class="col-label">{colDef.label}</span>
							<span class="col-count">{columnItems[colDef.key].length}</span>
							<button
								class="col-add nodrag"
								aria-label={`Crear tarea en ${colDef.label}`}
								title={`Crear tarea en ${colDef.label}`}
								onclick={() => { showDetail = false; inlineComposerCol = colDef.key; inlineComposerValue = ''; }}
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
							</button>
						</div>

						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="col-list nodrag"
							use:dndzone={{
								items: columnItems[colDef.key],
								flipDurationMs: FLIP_MS,
								type: 'task-cards',
								dropTargetStyle: { outline: '1px solid rgba(109, 124, 255, 0.25)', borderRadius: '12px', background: 'rgba(109, 124, 255, 0.04)' },
								centreDraggedOnCursor: true,
							}}
							ondblclick={() => { showDetail = false; inlineComposerCol = colDef.key; inlineComposerValue = ''; }}
							onconsider={(e) => handleConsider(colDef.key, e)}
							onfinalize={(e) => handleFinalize(colDef.key, e)}
						>
							{#if inlineComposerCol === colDef.key}
								<div class="inline-composer nodrag" transition:slide={{ duration: 120 }}>
									<input
										bind:this={inlineComposerInput}
										class="inline-input"
										bind:value={inlineComposerValue}
										placeholder="Escribe y presiona Enter"
										onkeydown={(e) => {
											if (e.key === 'Enter') void createInlineTask(colDef.key);
											if (e.key === 'Escape') { inlineComposerCol = null; inlineComposerValue = ''; }
										}}
										onblur={() => { if (!inlineComposerValue.trim()) { inlineComposerCol = null; inlineComposerValue = ''; } }}
									/>
									<span class="inline-hint">Enter crea · Esc cierra</span>
								</div>
							{/if}

							{#each columnItems[colDef.key] as item (item.id)}
								<div
									class="card"
									class:card--sel={selectedTaskId === item.id}
									class:card--flash={flashingTaskId === item.id}
									animate:flip={{ duration: FLIP_MS }}
									onclick={() => void selectTask(item.id)}
									oncontextmenu={(e) => openContextMenu(item.id, e)}
									onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && void selectTask(item.id)}
									role="button"
									tabindex="0"
								>
									<span class="card-title">{item.task.title}</span>
									{#if item.task.liveNote || item.task.description}
										<p class="card-desc">{#each parseMentions(item.task.liveNote || item.task.description) as seg}{#if seg.type === 'mention'}<button class="mention-chip" class:mention-chip--dead={!mentionExists(seg.refType, seg.refId)} class:mention-chip--task={seg.refType === 'task'} class:mention-chip--note={seg.refType === 'note'} onclick={(e) => { e.stopPropagation(); handleMentionClick(seg.refType, seg.refId); }}>@{seg.label}</button>{:else}{seg.value}{/if}{/each}</p>
									{/if}
									<div class="card-footer">
										<span class="card-time">{formatRelative(item.task.updatedAt)}</span>
										{#if item.task.activeSessionId}
											<span class="card-badge">
												<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
												terminal
											</span>
										{/if}
									</div>
								</div>
							{/each}

							{#if columnItems[colDef.key].length === 0 && inlineComposerCol !== colDef.key}
								<div class="col-empty">
									<span>Sin tareas</span>
								</div>
							{/if}
						</div>

					</div>
				{/each}
			{/if}
		</section>

		<!-- Detail panel (lateral) -->
		{#if showDetail && selectedTask}
			<aside class="detail nopan nowheel" transition:slide={{ duration: 160, axis: 'x' }}>
				<div class="detail-inner">
					<div class="detail-head">
						<div class="detail-head-left">
							<span class="detail-status" style={`--t:${columnDefs.find(c => c.key === selectedTask.status)?.tone ?? '#8f98ae'}`}>
								<span class="detail-status-dot" style={`--t:${columnDefs.find(c => c.key === selectedTask.status)?.tone ?? '#8f98ae'}`}></span>
								{statusLabels[selectedTask.status]}
							</span>
							<span class="detail-time">{formatRelative(selectedTask.updatedAt)}</span>
						</div>
						<button class="detail-close nodrag" onclick={() => (showDetail = false)}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
						</button>
					</div>

					<div class="detail-title-row">
						<input class="detail-title nodrag" bind:value={draftTitle} placeholder="Sin titulo..." oninput={triggerAutoSave} />
						{#if savedFeedback}
							<span class="saved-indicator" transition:slide={{ duration: 150, axis: 'x' }}>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
							</span>
						{/if}
					</div>

					<div class="detail-desc-wrap">
						{#if editingDesc}
							<textarea
								bind:this={descTextarea}
								class="detail-desc detail-desc--editing nodrag"
								bind:value={draftDescription}
								placeholder="Escribe una descripcion... (@ para mencionar)"
								rows="3"
								oninput={(e) => { triggerAutoSave(); handleMentionInput(e); autoGrow(e.target as HTMLTextAreaElement); }}
								onkeydown={(e) => { handleMentionKeydown(e); if (e.key === 'Escape' && mentionQuery === null) stopEditDesc(); }}
								onblur={() => { setTimeout(closeMentions, 150); stopEditDesc(); }}
							></textarea>
							{#if mentionQuery !== null && mentionSuggestions.length > 0 && mentionAnchor?.el === descTextarea}
								<div class="mention-dropdown">
									{#each mentionSuggestions as s, i}
										<button
											class="mention-option"
											class:mention-option--active={i === mentionIndex}
											onmousedown={(e) => {
												e.preventDefault();
												insertMention(s);
											}}
										>
											<span class="mention-option-type">{s.type === 'task' ? 'T' : 'N'}</span>
											<span class="mention-option-label">{s.label}</span>
										</button>
									{/each}
								</div>
							{/if}
						{:else}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="detail-desc-read nodrag" onclick={startEditDesc} onkeydown={(e) => e.key === 'Enter' && startEditDesc()} tabindex="0" role="button">
								{#if draftDescription}
									<p class="detail-desc-text">{#each parseMentions(draftDescription) as seg}{#if seg.type === 'mention'}<button class="mention-chip mention-chip--task" class:mention-chip--dead={!mentionExists(seg.refType, seg.refId)} class:mention-chip--note={seg.refType === 'note'} onclick={(e) => { e.stopPropagation(); handleMentionClick(seg.refType, seg.refId); }}>@{seg.label}</button>{:else}{seg.value}{/if}{/each}</p>
								{:else}
									<span class="detail-desc-placeholder">Agregar descripcion...</span>
								{/if}
							</div>
						{/if}
					</div>

					{#if draftWorkdir || draftLiveNote}
						<div class="detail-meta">
							{#if draftWorkdir}
								<div class="meta-item">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
									<input class="meta-input nodrag" bind:value={draftWorkdir} placeholder="Directorio..." oninput={triggerAutoSave} />
								</div>
							{/if}
							{#if draftLiveNote}
								<div class="meta-item">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
									<span class="meta-text">{draftLiveNote}</span>
								</div>
							{/if}
						</div>
					{/if}

					<div class="pill-row">
						{#each columnDefs as col}
							<button
								class="pill nodrag"
								class:pill--active={selectedTask.status === col.key}
								style={`--t:${col.tone}`}
								onclick={() => void moveTask(selectedTask, col.key)}
							>{col.label}</button>
						{/each}
					</div>

					<div class="detail-actions">
						<button class="action-btn nodrag" onclick={openTerminalForTask} disabled={openingSession}>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
							{openingSession ? '...' : 'Terminal'}
						</button>
						<button class="action-btn nodrag" onclick={resolveSelectedTask}>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="16 8 10 16 8 13"/></svg>
							Resolver
						</button>
					</div>

					<div class="detail-divider"></div>

					<div class="detail-section">
						<span class="detail-label">Actividad</span>
						<div class="activity-input-wrap">
							<div class="activity-input nodrag">
								<input
									bind:value={activityDraft}
									placeholder="Escribe algo... @ para mencionar"
									oninput={handleMentionInput}
									onkeydown={(e) => {
										handleMentionKeydown(e);
										if (mentionQuery === null && e.key === 'Enter' && !e.shiftKey) void postActivity();
									}}
									onblur={() => setTimeout(closeMentions, 150)}
								/>
								<button class="activity-send nodrag" onclick={postActivity} disabled={postingActivity}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
								</button>
							</div>
							{#if mentionQuery !== null && mentionSuggestions.length > 0 && mentionAnchor?.el !== descTextarea}
								<div class="mention-dropdown">
									{#each mentionSuggestions as s, i}
										<button
											class="mention-option"
											class:mention-option--active={i === mentionIndex}
											onmousedown={(e) => {
												e.preventDefault();
												insertMention(s);
											}}
										>
											<span class="mention-option-type">{s.type === 'task' ? 'T' : 'N'}</span>
											<span class="mention-option-label">{s.label}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					{#if loadingActivityTaskId === selectedTask.id}
						<div class="empty-state">Cargando...</div>
					{:else if selectedActivities.length > 0}
						<div class="activity-feed">
							{#each selectedActivities as a (a.id)}
								<div class="activity-entry">
									<div class="activity-head">
										<span class="activity-icon">
											{#if a.actorType === 'agent'}
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="8.5" cy="16" r="1.5"/><circle cx="15.5" cy="16" r="1.5"/><path d="M12 2v4"/><path d="M9 6h6"/></svg>
											{:else if a.actorType === 'user'}
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
											{:else}
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
											{/if}
										</span>
										<span class="activity-who">{a.actorLabel}</span>
										<span class="activity-dot">·</span>
										<span class="activity-when">{formatRelative(a.createdAt)}</span>
									</div>
									<p>{#each parseMentions(a.message) as seg}{#if seg.type === 'mention'}<button class="mention-chip" class:mention-chip--dead={!mentionExists(seg.refType, seg.refId)} class:mention-chip--task={seg.refType === 'task'} class:mention-chip--note={seg.refType === 'note'} onclick={(e) => { e.stopPropagation(); handleMentionClick(seg.refType, seg.refId); }}>@{seg.label}</button>{:else}{seg.value}{/if}{/each}</p>
								</div>
							{/each}
						</div>
					{/if}

					<div class="detail-danger">
						<button class="danger-btn nodrag" onclick={deleteSelectedTask} disabled={deletingTask}>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
							{deletingTask ? '...' : 'Eliminar tarea'}
						</button>
					</div>
				</div>
			</aside>
		{/if}
	</div>

	<!-- Context menu -->
	{#if contextMenu}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="ctx-overlay"
			onclick={closeContextMenu}
			oncontextmenu={(e) => {
				e.preventDefault();
				closeContextMenu();
			}}
			onkeydown={(e) => e.key === 'Escape' && closeContextMenu()}
		></div>
		<div class="ctx-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px`}>
			{#each columnDefs as col}
				{@const task = tasks.find(t => t.id === contextMenu.taskId)}
				{#if task && task.status !== col.key}
					<button class="ctx-item nodrag" onclick={() => void contextMoveTask(col.key)}>
						<span class="ctx-dot" style={`--t:${col.tone}`}></span>
						Mover a {col.label}
					</button>
				{/if}
			{/each}
			<button class="ctx-item nodrag" onclick={() => void contextOpenTerminal()}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
				Terminal
			</button>
			<div class="ctx-divider"></div>
			<button class="ctx-item ctx-item--danger nodrag" onclick={() => void contextDeleteTask()}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
				{confirmDeleteId === contextMenu.taskId ? 'Confirmar eliminar' : 'Eliminar'}
			</button>
		</div>
	{/if}
</div>

<Handle type="source" position={Position.Right} style="opacity:0" />
<Handle type="target" position={Position.Left} style="opacity:0" />

<style>
	/* ── Shell ─────────────────────────────────────────────── */
	.board {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		border-radius: 20px;
		overflow: hidden;
		background: rgba(10, 12, 20, 0.92);
		border: 1px solid rgba(118, 128, 170, 0.14);
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.38);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
	}

	/* ── Header bar ───────────────────────────────────────── */
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		cursor: grab;
		border-bottom: 1px solid rgba(118, 128, 170, 0.1);
		min-height: 42px;
	}

	.bar-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.bar-title {
		font-size: 13px;
		font-weight: 600;
		color: #d4daf0;
		letter-spacing: -0.01em;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: rgba(143, 152, 174, 0.5);
	}

	.dot--live {
		background: #39d98a;
		box-shadow: 0 0 0 3px rgba(57, 217, 138, 0.16);
	}

	.bar-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	/* ── Buttons ──────────────────────────────────────────── */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		height: 30px;
		padding: 0 10px;
		border-radius: 10px;
		border: 1px solid rgba(132, 143, 176, 0.14);
		background: rgba(20, 24, 38, 0.9);
		color: #c8d0e8;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: border-color 0.12s, background 0.12s;
	}

	.btn:hover {
		border-color: rgba(152, 162, 196, 0.24);
		background: rgba(28, 33, 50, 0.95);
	}

	.btn--ghost {
		background: transparent;
		border-color: transparent;
		color: #7a84a6;
	}

	.btn--ghost:hover {
		color: #c3cbdf;
		background: rgba(255, 255, 255, 0.04);
	}

	/* ── Alert ────────────────────────────────────────────── */
	.alert {
		margin: 6px 12px;
		padding: 8px 12px;
		border-radius: 10px;
		background: rgba(83, 31, 48, 0.35);
		border: 1px solid rgba(255, 128, 150, 0.14);
		color: #ffd3dd;
		font-size: 11px;
	}

	/* ── Body ─────────────────────────────────────────────── */
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	/* ── Columns ──────────────────────────────────────────── */
	.cols {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		padding: 10px 12px;
	}

	.col {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 8px;
		border-radius: 14px;
		background: rgba(14, 17, 28, 0.6);
		border: 1px solid rgba(117, 127, 157, 0.08);
	}

	.col-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px 8px;
	}

	.col-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--t);
	}

	.col-label {
		font-size: 11px;
		font-weight: 600;
		color: #c8d0e8;
		flex: 1;
	}

	.col-count {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #6b7694;
	}

	.col-list {
		flex: 1;
		min-height: 40px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 2px;
	}

	/* ── Cards ────────────────────────────────────────────── */
	.card {
		padding: 10px 12px;
		border-radius: 10px;
		border: 1px solid rgba(117, 127, 157, 0.08);
		background: rgba(18, 22, 34, 0.7);
		cursor: grab;
		outline: none;
		transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
	}

	.card:hover {
		background: rgba(24, 29, 46, 0.9);
		border-color: rgba(117, 127, 157, 0.16);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
	}

	.card:focus-visible {
		border-color: rgba(121, 133, 255, 0.3);
		box-shadow: 0 0 0 2px rgba(121, 133, 255, 0.1);
	}

	.card--sel {
		border-color: rgba(121, 133, 255, 0.25);
		background: rgba(24, 29, 46, 0.95);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
	}

	.card:active {
		opacity: 0.9;
		transition: opacity 0.08s ease;
	}

	.card--flash {
		animation: card-flash 1.2s ease-out;
	}

	@keyframes card-flash {
		0% {
			border-color: rgba(109, 124, 255, 0.5);
			box-shadow: 0 0 0 3px rgba(109, 124, 255, 0.15), 0 4px 16px rgba(0, 0, 0, 0.2);
			background: rgba(30, 36, 58, 0.95);
		}
		100% {
			border-color: rgba(117, 127, 157, 0.08);
			box-shadow: none;
			background: rgba(18, 22, 34, 0.7);
		}
	}

	.card-title {
		display: block;
		font-size: 12.5px;
		font-weight: 600;
		color: #e4e9fa;
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-desc {
		margin: 4px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: #7a84a6;
		line-clamp: 2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}

	.card-time {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #525e7a;
	}

	.card-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 6px;
		border-radius: 5px;
		background: rgba(57, 217, 138, 0.08);
		color: #5cd99a;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	/* ── Detail panel ─────────────────────────────────────── */
	.detail {
		width: 280px;
		min-width: 280px;
		border-left: 1px solid rgba(118, 128, 170, 0.08);
		background: rgba(8, 10, 18, 0.8);
		min-height: 0;
	}

	.detail-inner {
		height: 100%;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow-y: auto;
	}

	.detail-inner::-webkit-scrollbar {
		width: 3px;
	}
	.detail-inner::-webkit-scrollbar-thumb {
		background: rgba(118, 128, 170, 0.15);
		border-radius: 3px;
	}

	.detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.detail-head-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.detail-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--t);
	}

	.detail-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--t);
	}

	.detail-time {
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		color: #4a5370;
	}

	.detail-close {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 8px;
		color: #5a6484;
		cursor: pointer;
		transition: all 0.12s;
	}

	.detail-close:hover {
		color: #c3cbdf;
		background: rgba(255, 255, 255, 0.05);
	}

	/* ── Title & Description ──────────────────────────────── */
	.detail-title {
		width: 100%;
		border: none;
		background: transparent;
		color: #e4e9fa;
		font: inherit;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.3;
		padding: 0;
		outline: none;
		border-bottom: 1px solid transparent;
		transition: border-color 0.15s;
	}

	.detail-title::placeholder {
		color: #3d455e;
	}

	.detail-title:focus {
		border-bottom-color: rgba(121, 133, 255, 0.25);
	}

	.detail-desc-wrap {
		position: relative;
	}

	/* ── Description: read mode ──────────────────────────── */
	.detail-desc-read {
		padding: 6px 8px;
		border-radius: 8px;
		cursor: text;
		transition: background 0.12s;
		outline: none;
	}

	.detail-desc-read:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.detail-desc-text {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: #a0a8c8;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.detail-desc-placeholder {
		font-size: 12px;
		color: #3d455e;
		font-style: italic;
	}

	/* ── Description: edit mode ──────────────────────────── */
	.detail-desc {
		width: 100%;
		border: 1px solid rgba(121, 133, 255, 0.18);
		border-radius: 8px;
		background: rgba(14, 17, 28, 0.6);
		color: #c8d0e8;
		font: inherit;
		font-size: 12.5px;
		line-height: 1.55;
		padding: 8px 10px;
		outline: none;
		resize: none;
		min-height: 48px;
	}

	.detail-desc::placeholder {
		color: #3d455e;
	}

	/* ── Mention dropdown ─────────────────────────────────── */
	.mention-dropdown {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(100% + 4px);
		z-index: 80;
		padding: 3px;
		border-radius: 8px;
		background: rgba(16, 19, 30, 0.96);
		border: 1px solid rgba(118, 128, 170, 0.14);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		max-height: 180px;
		overflow-y: auto;
	}

	.activity-input-wrap {
		position: relative;
	}

	.mention-option {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 8px;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.08s;
	}

	.mention-option:hover,
	.mention-option--active {
		background: rgba(255, 255, 255, 0.06);
	}

	.mention-option-type {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 4px;
		font-size: 9px;
		font-weight: 700;
		flex-shrink: 0;
		background: rgba(109, 124, 255, 0.12);
		color: #8a9aff;
	}

	.mention-option-label {
		font-size: 11px;
		color: #c8d0e8;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Mention chips (rendered) ─────────────────────────── */
	.mention-chip {
		all: unset;
		display: inline;
		font-size: inherit;
		font-weight: 600;
		cursor: pointer;
		border-radius: 3px;
		padding: 0 2px;
		transition: opacity 0.1s;
	}

	.mention-chip:hover {
		opacity: 0.8;
	}

	.mention-chip--task {
		color: #7a8aff;
	}

	.mention-chip--note {
		color: #d4a54a;
	}

	.mention-chip--dead {
		color: #4a5370;
		text-decoration: line-through;
		cursor: default;
	}

	/* ── Meta fields ──────────────────────────────────────── */
	.detail-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 10px;
		border-radius: 8px;
		background: rgba(14, 17, 28, 0.5);
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #5a6484;
		flex: 1 1 160px;
		min-width: 0;
	}

	.meta-input {
		all: unset;
		flex: 1;
		font: inherit;
		font-size: 11px;
		color: #7a84a6;
		min-width: 0;
	}

	.meta-text {
		font-size: 11px;
		color: #7a84a6;
		line-height: 1.4;
	}

	/* ── Sections ─────────────────────────────────────────── */
	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.detail-divider {
		height: 1px;
		background: rgba(118, 128, 170, 0.08);
		margin: 2px 0;
	}

	/* ── Status pills ─────────────────────────────────────── */
	.pill-row {
		display: flex;
		gap: 4px;
	}

	.pill {
		all: unset;
		box-sizing: border-box;
		padding: 4px 10px;
		border-radius: 7px;
		font-size: 10px;
		font-weight: 600;
		color: #5a6484;
		background: rgba(20, 24, 38, 0.6);
		border: 1px solid rgba(117, 127, 157, 0.08);
		cursor: pointer;
		transition: all 0.14s ease;
	}

	.pill:hover {
		border-color: rgba(152, 162, 196, 0.16);
		color: #a0a8c4;
		background: rgba(28, 33, 50, 0.8);
	}

	.pill--active {
		border-color: color-mix(in srgb, var(--t) 30%, transparent);
		color: var(--t);
		background: color-mix(in srgb, var(--t) 8%, transparent);
	}

	/* ── Actions ──────────────────────────────────────────── */
	.detail-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 28px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px solid rgba(117, 127, 157, 0.1);
		background: rgba(20, 24, 38, 0.6);
		color: #8a94b8;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.14s ease;
		white-space: nowrap;
	}

	.action-btn:hover {
		border-color: rgba(152, 162, 196, 0.18);
		background: rgba(28, 33, 50, 0.9);
		color: #c3cbdf;
	}

	/* ── Activity ─────────────────────────────────────────── */
	.activity-input {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.activity-input input {
		flex: 1;
		min-width: 0;
		height: 28px;
		padding: 0 10px;
		border-radius: 8px;
		border: 1px solid rgba(123, 133, 164, 0.08);
		background: rgba(14, 17, 28, 0.5);
		color: #dce2f4;
		font: inherit;
		font-size: 11px;
		outline: none;
		transition: border-color 0.15s;
	}

	.activity-input input::placeholder {
		color: #3d455e;
	}

	.activity-input input:focus {
		border-color: rgba(121, 133, 255, 0.25);
	}

	.activity-send {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		color: #5a6484;
		cursor: pointer;
		transition: all 0.12s;
	}

	.activity-send:hover {
		color: #a4b0ff;
		background: rgba(109, 124, 255, 0.1);
	}

	.activity-feed {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
		flex: 1;
	}

	.activity-entry {
		padding: 6px 8px;
		border-radius: 6px;
		transition: background 0.1s;
	}

	.activity-entry:hover {
		background: rgba(14, 17, 28, 0.5);
	}

	.activity-head {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.activity-entry p {
		margin: 2px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: #7a84a6;
	}

	.activity-icon {
		display: flex;
		align-items: center;
		color: #4a5370;
	}

	.activity-who {
		font-size: 10px;
		font-weight: 600;
		color: #8a94b4;
	}

	.activity-dot {
		font-size: 10px;
		color: #3d455e;
	}

	.activity-when {
		font-size: 10px;
		color: #3d455e;
	}

	/* ── Danger zone ──────────────────────────────────────── */
	.detail-danger {
		margin-top: auto;
		padding-top: 2px;
	}

	.danger-btn {
		all: unset;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		font-weight: 500;
		color: #5a3a42;
		cursor: pointer;
		transition: color 0.12s;
	}

	.danger-btn:hover {
		color: #ff7a8f;
	}

	/* ── Column empty state ───────────────────────────────── */
	.col-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60px;
	}

	.col-empty span {
		font-size: 11px;
		color: #2d3348;
		font-style: italic;
	}

	/* ── Inline composer ──────────────────────────────────── */
	.col-add {
		all: unset;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin-left: auto;
		border-radius: 7px;
		color: #59637f;
		cursor: pointer;
		transition: color 0.14s ease, background 0.14s ease;
	}

	.col-add:hover {
		color: #c7cfe4;
		background: rgba(255, 255, 255, 0.04);
	}

	.inline-composer {
		padding: 10px 10px 8px;
		border-radius: 12px;
		border: 1px solid rgba(109, 124, 255, 0.14);
		background:
			linear-gradient(180deg, rgba(109, 124, 255, 0.08), rgba(109, 124, 255, 0.02)),
			rgba(18, 22, 34, 0.92);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.inline-input {
		width: 100%;
		border: none;
		background: transparent;
		color: #e4e9fa;
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1.4;
		padding: 0;
		outline: none;
	}

	.inline-input::placeholder {
		color: #59637f;
	}

	.inline-hint {
		display: block;
		margin-top: 8px;
		font-size: 10px;
		color: #5f6986;
	}

	/* ── Saved indicator ──────────────────────────────────── */
	.detail-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.detail-title-row .detail-title {
		flex: 1;
		min-width: 0;
	}

	.saved-indicator {
		display: flex;
		align-items: center;
		color: #39d98a;
		opacity: 0.7;
		flex-shrink: 0;
	}

	/* ── Offline state ────────────────────────────────────── */
	.board--offline {
		opacity: 0.7;
		transition: opacity 0.3s ease;
	}

	.board--offline .cols {
		pointer-events: none;
	}

	.offline-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 12px;
		background: rgba(255, 180, 50, 0.08);
		border-bottom: 1px solid rgba(255, 180, 50, 0.12);
		color: #d4a54a;
		font-size: 11px;
		font-weight: 500;
	}

	/* ── Context menu ─────────────────────────────────────── */
	.ctx-overlay {
		position: absolute;
		inset: 0;
		z-index: 90;
	}

	.ctx-menu {
		position: absolute;
		z-index: 100;
		min-width: 160px;
		padding: 4px;
		border-radius: 10px;
		background: rgba(16, 19, 30, 0.96);
		border: 1px solid rgba(118, 128, 170, 0.14);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.ctx-item {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		border-radius: 7px;
		font-size: 11px;
		font-weight: 500;
		color: #a0a8c4;
		cursor: pointer;
		transition: background 0.1s;
	}

	.ctx-item:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #dce2f4;
	}

	.ctx-item--danger {
		color: #8a4a56;
	}

	.ctx-item--danger:hover {
		background: rgba(255, 80, 100, 0.1);
		color: #ff7a8f;
	}

	.ctx-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--t);
	}

	.ctx-divider {
		height: 1px;
		margin: 3px 6px;
		background: rgba(118, 128, 170, 0.1);
	}

	/* ── Misc ─────────────────────────────────────────────── */
	.empty-state {
		padding: 16px;
		font-size: 12px;
		color: #6b7694;
		text-align: center;
	}
</style>
