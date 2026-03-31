import { writable, get } from 'svelte/store';

export const TERMINAL_INTERACTION_EVENT = 'devcanvas:terminal-interaction';
export const TERMINAL_FOCUS_EVENT = 'devcanvas:terminal-focus';
export const TERMINAL_FULLSCREEN_EVENT = 'devcanvas:terminal-fullscreen';

export type TerminalFocusOrigin = 'slot' | 'cycle' | 'programmatic';

export type FullscreenTerminal = {
	nodeId: string;
	sessionId: string;
	sessionName: string;
	sessionType: string;
	themeId?: string;
	fontFamily?: string;
	fontSize?: number;
};

export const activeTerminalNodeId = writable<string | null>(null);
export const terminalQuickSlots = writable<Record<string, number>>({});
export const fullscreenTerminal = writable<FullscreenTerminal | null>(null);

export function isFullscreen() {
	return get(fullscreenTerminal) !== null;
}

export function enterFullscreen(terminal: FullscreenTerminal) {
	fullscreenTerminal.set(terminal);
}

export function exitFullscreen() {
	fullscreenTerminal.set(null);
}

export function toggleFullscreen(terminal: FullscreenTerminal) {
	const current = get(fullscreenTerminal);
	if (current && current.nodeId === terminal.nodeId) {
		fullscreenTerminal.set(null);
	} else {
		fullscreenTerminal.set(terminal);
	}
}

export function resetTerminalNavigation() {
	activeTerminalNodeId.set(null);
	terminalQuickSlots.set({});
	fullscreenTerminal.set(null);
}
