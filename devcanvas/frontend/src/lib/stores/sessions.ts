import { writable } from 'svelte/store';
import type { TerminalSessionAppearance } from '$lib/terminal/settings';

export type Session = {
	id: string;
	name: string;
	type: 'tmux' | 'pty' | 'ssh';
	status: 'active' | 'idle' | 'dead';
	workspaceId: string;
	createdAt: string;
	lastActivity?: string;
	workingDir?: string | null;
	appearance?: TerminalSessionAppearance;
};

export const sessions = writable<Session[]>([]);
export const sessionsLoading = writable(false);
