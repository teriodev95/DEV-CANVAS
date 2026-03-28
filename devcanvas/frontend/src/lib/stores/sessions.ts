import { writable } from 'svelte/store';

export type Session = {
	id: string;
	name: string;
	type: 'tmux' | 'pty';
	status: 'active' | 'idle' | 'dead';
	workspaceId: string;
	createdAt: string;
};

export const sessions = writable<Session[]>([]);
export const sessionsLoading = writable(false);
