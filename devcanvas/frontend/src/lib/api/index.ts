import type { Session } from '$lib/stores/sessions';
import type { Workspace } from '$lib/stores/workspace';
import type { WorkspaceSettings } from '$lib/terminal/settings';
import { DEV_CANVAS_BACKEND_ORIGIN } from '$lib/api/backend';

const BASE = `${DEV_CANVAS_BACKEND_ORIGIN}/api`;
const HEALTH = `${DEV_CANVAS_BACKEND_ORIGIN}/health`;

type HealthResponse = {
	ok: boolean;
	tmux: boolean;
	timestamp: number;
};

type CanvasResponse = {
	id: string;
	snapshot: unknown;
	updatedAt: number;
};

type DeleteResponse = {
	ok: boolean;
	id: string;
};

type WorkspaceDeleteResponse = DeleteResponse & {
	deletedSessionIds?: string[];
};

export type TaskStatus = 'todo' | 'doing' | 'done';

export type Task = {
	id: string;
	workspaceId: string;
	title: string;
	description: string;
	status: TaskStatus;
	workdir?: string | null;
	activeSessionId?: string | null;
	liveNote: string;
	createdAt: number;
	updatedAt: number;
	resolvedAt?: number | null;
};

export type TaskActivity = {
	id: string;
	taskId: string;
	actorType: string;
	actorLabel: string;
	kind: string;
	message: string;
	createdAt: number;
};

export type LiveTmuxSession = {
	name: string;
	tracked: boolean;
	sessionId: string | null;
	workspaceId: string | null;
	workspaceName: string | null;
	inCurrentWorkspace: boolean;
	lastActivity: number | null;
};

async function handleResponse<T>(r: Response): Promise<T> {
	const contentType = r.headers.get('content-type') ?? '';
	let payload: unknown = null;

	try {
		if (contentType.includes('application/json')) {
			payload = await r.json();
		} else {
			const text = await r.text();
			payload = text || null;
		}
	} catch {
		payload = null;
	}

	if (!r.ok) {
		const detail =
			payload && typeof payload === 'object'
				? (payload as { error?: string; message?: string }).error ??
					(payload as { error?: string; message?: string }).message
				: typeof payload === 'string'
					? payload
					: null;
		throw new Error(`API error ${r.status}: ${detail ?? r.statusText}`);
	}

	return payload as T;
}

export const api = {
	health: () =>
		fetch(HEALTH).then((r) => handleResponse<HealthResponse>(r)),

	workspaces: {
		list: () =>
			fetch(`${BASE}/workspaces`).then((r) => handleResponse<Workspace[]>(r)),

		create: (name: string, settings?: Partial<WorkspaceSettings>) =>
			fetch(`${BASE}/workspaces`, {
				method: 'POST',
				body: JSON.stringify({ name, settings }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Workspace>(r)),

		get: (id: string) =>
			fetch(`${BASE}/workspaces/${id}`).then((r) => handleResponse<Workspace>(r)),

		rename: (id: string, name: string) =>
			fetch(`${BASE}/workspaces/${id}`, {
				method: 'PATCH',
				body: JSON.stringify({ name }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Workspace>(r)),

		delete: (id: string) =>
			fetch(`${BASE}/workspaces/${id}`, {
				method: 'DELETE',
			}).then((r) => handleResponse<WorkspaceDeleteResponse>(r)),

		updateSettings: (id: string, settings: unknown) =>
			fetch(`${BASE}/workspaces/${id}/settings`, {
				method: 'PATCH',
				body: JSON.stringify({ settings }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Workspace>(r)),

		saveCanvas: (id: string, snapshot: unknown) =>
			fetch(`${BASE}/workspaces/${id}/canvas`, {
				method: 'PUT',
				body: JSON.stringify({ snapshot }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Workspace>(r)),

		getCanvas: (id: string) =>
			fetch(`${BASE}/workspaces/${id}/canvas`).then((r) => handleResponse<CanvasResponse>(r)),
	},

	sessions: {
		list: (workspaceId: string) =>
			fetch(`${BASE}/sessions?workspaceId=${workspaceId}`).then((r) => handleResponse<Session[]>(r)),

		get: (id: string) =>
			fetch(`${BASE}/sessions/${id}`).then((r) => handleResponse<Session>(r)),

		create: (
			workspaceId: string,
			name: string,
			type: 'tmux' | 'pty' | 'ssh',
			sshConfig?: {
				lookup?: string;
				label?: string;
				host?: string;
				user?: string;
				port?: number;
				durable?: boolean;
				remoteSessionName?: string;
				identityFile?: string;
			},
			workingDir?: string
		) =>
			fetch(`${BASE}/sessions`, {
				method: 'POST',
				body: JSON.stringify({ workspaceId, name, type, sshConfig, workingDir }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Session>(r)),

		update: (id: string, payload: { name?: string; appearance?: unknown }) =>
			fetch(`${BASE}/sessions/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(payload),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Session>(r)),

		listLiveTmux: (workspaceId: string) =>
			fetch(`${BASE}/sessions/tmux/live?workspaceId=${encodeURIComponent(workspaceId)}`).then((r) =>
				handleResponse<LiveTmuxSession[]>(r)
			),

		importTmux: (workspaceId: string, tmuxSessionName: string, name?: string) =>
			fetch(`${BASE}/sessions/tmux/import`, {
				method: 'POST',
				body: JSON.stringify({ workspaceId, tmuxSessionName, name }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Session>(r)),

		delete: (id: string) =>
			fetch(`${BASE}/sessions/${id}`, { method: 'DELETE' }).then((r) => handleResponse<DeleteResponse>(r)),
	},

	tasks: {
		list: (workspaceId: string) =>
			fetch(`${BASE}/tasks?workspaceId=${encodeURIComponent(workspaceId)}`).then((r) =>
				handleResponse<Task[]>(r)
			),

		get: (id: string) =>
			fetch(`${BASE}/tasks/${id}`).then((r) => handleResponse<Task>(r)),

		getActivity: (id: string, limit = 100) =>
			fetch(`${BASE}/tasks/${id}/activity?limit=${limit}`).then((r) =>
				handleResponse<TaskActivity[]>(r)
			),

		create: (
			workspaceId: string,
			payload: {
				title: string;
				description?: string;
				workdir?: string | null;
				actorType?: string;
				actorLabel?: string;
			}
		) =>
			fetch(`${BASE}/tasks`, {
				method: 'POST',
				body: JSON.stringify({ workspaceId, ...payload }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Task>(r)),

		update: (
			id: string,
			payload: {
				title?: string;
				description?: string;
				workdir?: string | null;
				liveNote?: string;
				activeSessionId?: string | null;
				actorType?: string;
				actorLabel?: string;
			}
		) =>
			fetch(`${BASE}/tasks/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(payload),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Task>(r)),

		move: (
			id: string,
			status: TaskStatus,
			payload?: { actorType?: string; actorLabel?: string }
		) =>
			fetch(`${BASE}/tasks/${id}/move`, {
				method: 'POST',
				body: JSON.stringify({ status, ...payload }),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Task>(r)),

		resolve: (
			id: string,
			payload?: { note?: string; actorType?: string; actorLabel?: string }
		) =>
			fetch(`${BASE}/tasks/${id}/resolve`, {
				method: 'POST',
				body: JSON.stringify(payload ?? {}),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<Task>(r)),

		addActivity: (
			id: string,
			payload: {
				message: string;
				kind?: string;
				liveNote?: string;
				actorType?: string;
				actorLabel?: string;
			}
		) =>
			fetch(`${BASE}/tasks/${id}/activity`, {
				method: 'POST',
				body: JSON.stringify(payload),
				headers: { 'Content-Type': 'application/json' },
			}).then((r) => handleResponse<TaskActivity>(r)),

		delete: (id: string) =>
			fetch(`${BASE}/tasks/${id}`, {
				method: 'DELETE',
			}).then((r) => handleResponse<DeleteResponse>(r)),
	},
};
