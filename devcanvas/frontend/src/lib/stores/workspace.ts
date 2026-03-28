import { writable } from 'svelte/store';

export type Workspace = {
	id: string;
	name: string;
	createdAt: string;
	updatedAt?: string;
	sessionCount?: number;
};

export const currentWorkspace = writable<Workspace | null>(null);
export const workspaceLoading = writable(false);
export const workspaceError = writable<string | null>(null);
