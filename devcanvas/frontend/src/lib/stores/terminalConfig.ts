import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'devcanvas:fontSize';
const MIN = 9;
const MAX = 22;
const DEFAULT = 13;

function load(): number {
	if (!browser) return DEFAULT;
	const v = parseInt(localStorage.getItem(KEY) ?? '', 10);
	return isNaN(v) ? DEFAULT : Math.min(Math.max(v, MIN), MAX);
}

function createStore() {
	const { subscribe, update } = writable({ fontSize: load() });

	return {
		subscribe,
		MIN,
		MAX,
		setFontSize(size: number) {
			const v = Math.min(Math.max(Math.round(size), MIN), MAX);
			update((s) => ({ ...s, fontSize: v }));
			if (browser) localStorage.setItem(KEY, String(v));
		},
	};
}

export const terminalConfig = createStore();
