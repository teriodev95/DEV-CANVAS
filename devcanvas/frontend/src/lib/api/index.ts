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
			}
		) =>
			fetch(`${BASE}/sessions`, {
				method: 'POST',
				body: JSON.stringify({ workspaceId, name, type, sshConfig }),
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
};
