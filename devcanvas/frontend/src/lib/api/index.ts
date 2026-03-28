// Use the same host as the frontend so it works via Tailscale or localhost
const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const BASE = `http://${HOST}:3001/api`;

function handleResponse(r: Response) {
	if (!r.ok) throw new Error(`API error ${r.status}: ${r.statusText}`);
	return r.json();
}

export const api = {
	workspaces: {
		list: () =>
			fetch(`${BASE}/workspaces`).then(handleResponse),

		create: (name: string) =>
			fetch(`${BASE}/workspaces`, {
				method: 'POST',
				body: JSON.stringify({ name }),
				headers: { 'Content-Type': 'application/json' },
			}).then(handleResponse),

		get: (id: string) =>
			fetch(`${BASE}/workspaces/${id}`).then(handleResponse),

		saveCanvas: (id: string, snapshot: unknown) =>
			fetch(`${BASE}/workspaces/${id}/canvas`, {
				method: 'PUT',
				body: JSON.stringify({ snapshot: JSON.stringify(snapshot) }),
				headers: { 'Content-Type': 'application/json' },
			}).then(handleResponse),

		getCanvas: (id: string) =>
			fetch(`${BASE}/workspaces/${id}/canvas`).then(handleResponse),
	},

	sessions: {
		list: (workspaceId: string) =>
			fetch(`${BASE}/sessions?workspaceId=${workspaceId}`).then(handleResponse),

		create: (workspaceId: string, name: string, type: 'tmux' | 'pty') =>
			fetch(`${BASE}/sessions`, {
				method: 'POST',
				body: JSON.stringify({ workspaceId, name, type }),
				headers: { 'Content-Type': 'application/json' },
			}).then(handleResponse),

		delete: (id: string) =>
			fetch(`${BASE}/sessions/${id}`, { method: 'DELETE' }).then(handleResponse),
	},
};
