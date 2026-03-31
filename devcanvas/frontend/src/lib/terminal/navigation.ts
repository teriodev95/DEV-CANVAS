import { writable } from 'svelte/store';

export const TERMINAL_INTERACTION_EVENT = 'devcanvas:terminal-interaction';
export const TERMINAL_FOCUS_EVENT = 'devcanvas:terminal-focus';

export type TerminalFocusOrigin = 'slot' | 'cycle' | 'programmatic';

export const activeTerminalNodeId = writable<string | null>(null);
export const terminalQuickSlots = writable<Record<string, number>>({});

export function resetTerminalNavigation() {
	activeTerminalNodeId.set(null);
	terminalQuickSlots.set({});
}
