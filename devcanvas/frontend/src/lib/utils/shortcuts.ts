export function detectApplePlatform() {
	if (typeof navigator === 'undefined') return false;
	return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

export function getTerminalSlotShortcutLabel(slot: number, isApplePlatform: boolean) {
	return isApplePlatform ? `⌘${slot}` : `Ctrl+${slot}`;
}

export function getTerminalCycleShortcutLabel(isApplePlatform: boolean, direction: 'next' | 'prev' = 'next') {
	if (!isApplePlatform) {
		return direction === 'next' ? 'Ctrl+Tab' : 'Ctrl+Shift+Tab';
	}

	return direction === 'next' ? '⌘⇧]' : '⌘⇧[';
}
