import { writable } from 'svelte/store';
import type { WorkspaceSettings } from '$lib/terminal/settings';

export type Workspace = {
	id: string;
	name: string;
	createdAt: string;
	updatedAt?: string;
	sessionCount?: number;
	settings?: WorkspaceSettings;
};

export const currentWorkspace = writable<Workspace | null>(null);
export const workspaceLoading = writable(false);
export const workspaceError = writable<string | null>(null);
