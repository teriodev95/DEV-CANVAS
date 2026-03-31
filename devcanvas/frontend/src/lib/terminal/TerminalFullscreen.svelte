<script lang="ts">
	import { onMount } from 'svelte';
	import TerminalPane from './TerminalPane.svelte';
	import {
		fullscreenTerminal,
		exitFullscreen,
		terminalQuickSlots,
	} from './navigation';
	import { sessions } from '$lib/stores/sessions';
	import { detectApplePlatform, getTerminalSlotShortcutLabel } from '$lib/utils/shortcuts';
	import type { TerminalThemeId, TerminalFontFamilyId } from '$lib/terminal/settings';

	type SlotEntry = {
		nodeId: string;
		slot: number;
		sessionId: string;
		sessionName: string;
		active: boolean;
	};

	let isApplePlatform = $state(false);
	let terminalPane: { focus: () => void; blur: () => void; reconnect: () => void } | undefined = $state();
	let visible = $derived($fullscreenTerminal !== null);

	const sessionRecord = $derived(
		$fullscreenTerminal
			? $sessions.find((s) => s.id === $fullscreenTerminal!.sessionId) ?? null
			: null
	);

	const effectiveThemeId = $derived(
		($fullscreenTerminal?.themeId ?? sessionRecord?.appearance?.themeId ?? undefined) as TerminalThemeId | undefined
	);
	const effectiveFontFamily = $derived(
		($fullscreenTerminal?.fontFamily ?? sessionRecord?.appearance?.fontFamily ?? undefined) as TerminalFontFamilyId | undefined
	);
	const effectiveFontSize = $derived(
		$fullscreenTerminal?.fontSize ?? sessionRecord?.appearance?.fontSize ?? undefined
	);

	const slotEntries = $derived.by((): SlotEntry[] => {
		const slots = $terminalQuickSlots;
		const sessionList = $sessions;
		const current = $fullscreenTerminal;

		return Object.entries(slots)
			.sort(([, a], [, b]) => a - b)
			.map(([nodeId, slot]) => {
				const sessionId = nodeId.replace('terminal-', '');
				const session = sessionList.find((s) => s.id === sessionId);
				return {
					nodeId,
					slot,
					sessionId,
					sessionName: session?.name ?? `Terminal ${slot}`,
					active: current?.nodeId === nodeId,
				};
			});
	});

	function switchToSlot(slotNumber: number) {
		const entry = slotEntries.find((e) => e.slot === slotNumber);
		if (!entry || entry.active) return;
		const session = $sessions.find((s) => s.id === entry.sessionId);
		if (!session) return;
		fullscreenTerminal.set({
			nodeId: entry.nodeId,
			sessionId: entry.sessionId,
			sessionName: session.name,
			sessionType: session.type,
			themeId: session.appearance?.themeId ?? undefined,
			fontFamily: session.appearance?.fontFamily ?? undefined,
			fontSize: session.appearance?.fontSize ?? undefined,
		});
	}

	function handleCaptureKeydown(event: KeyboardEvent) {
		if (!$fullscreenTerminal) return;

		const primaryModifier = isApplePlatform
			? event.metaKey && !event.ctrlKey
			: event.ctrlKey && !event.metaKey;

		// Esc exits fullscreen
		if (
			event.key === 'Escape' &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			exitFullscreen();
			return;
		}

		// Cmd+Enter toggles fullscreen off
		if (primaryModifier && event.key === 'Enter' && !event.altKey && !event.shiftKey) {
			event.preventDefault();
			event.stopImmediatePropagation();
			exitFullscreen();
			return;
		}

		// Cmd+1-9 switches terminals
		if (primaryModifier && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			switchToSlot(Number(event.key));
			return;
		}
	}

	// Focus terminal and trigger refit when fullscreen activates or switches
	$effect(() => {
		if ($fullscreenTerminal) {
			// Dispatch resize events so TerminalPane's fitAddon recalculates
			// rows/cols after the overlay layout is settled.
			const timers = [0, 60, 200].map((delay) =>
				setTimeout(() => window.dispatchEvent(new Event('resize')), delay)
			);
			requestAnimationFrame(() => terminalPane?.focus());
			return () => timers.forEach(clearTimeout);
		}
	});

	onMount(() => {
		isApplePlatform = detectApplePlatform();
		window.addEventListener('keydown', handleCaptureKeydown, true);
		return () => window.removeEventListener('keydown', handleCaptureKeydown, true);
	});
</script>

{#if visible}
	<div class="fullscreen-overlay">
		<div class="terminal-container">
			{#key $fullscreenTerminal?.sessionId}
				<TerminalPane
					bind:this={terminalPane}
					sessionId={$fullscreenTerminal?.sessionId ?? ''}
					autoFocus={true}
					showStatus={false}
					embedded={false}
					themeId={effectiveThemeId}
					fontFamily={effectiveFontFamily}
					fontSize={effectiveFontSize}
				/>
			{/key}
		</div>

		<div class="pill-bar">
			{#each slotEntries as entry}
				<button
					class="pill"
					class:pill--active={entry.active}
					type="button"
					title={getTerminalSlotShortcutLabel(entry.slot, isApplePlatform) ?? ''}
					onclick={() => switchToSlot(entry.slot)}
				>
					<span class="pill-slot">{entry.slot}</span>
					<span class="pill-name">{entry.sessionName}</span>
				</button>
			{/each}

			<div class="pill-spacer"></div>

			<button class="pill pill--exit" type="button" onclick={exitFullscreen}>
				<span class="pill-name">Exit</span>
				<kbd class="pill-kbd">esc</kbd>
			</button>
		</div>
	</div>
{/if}

<style>
	.fullscreen-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		background-color: #0d0d0f;
		background-image: radial-gradient(circle, #2a2a35 1px, transparent 1px);
		background-size: 24px 24px;
		animation: fullscreen-fade-in 160ms ease-out;
	}

	@keyframes fullscreen-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.terminal-container {
		flex: 1;
		min-height: 0;
		margin: 12px 12px 0;
		border-radius: 16px;
		overflow: hidden;
		border: 1px solid rgba(124, 92, 252, 0.18);
		box-shadow:
			0 24px 64px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	/*
	 * Strip inner TerminalPane borders / shadows so xterm's FitAddon gets
	 * a clean, pixel-accurate container to measure against.
	 * The outer .terminal-container already provides the visual chrome.
	 */
	.terminal-container :global(.terminal-pane) {
		border: none;
		box-shadow: none;
		border-radius: 0;
	}

	.terminal-container :global(.terminal-pane::before) {
		display: none;
	}

	.terminal-container :global(.terminal-host) {
		border-top: none;
		border-bottom: none;
	}

	.pill-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 14px;
		margin: 10px auto 12px;
		width: fit-content;
		max-width: calc(100% - 24px);
		border-radius: 999px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 64%),
			var(--float-surface, rgba(16, 18, 26, 0.76));
		border: 1px solid var(--float-border, rgba(126, 136, 160, 0.16));
		box-shadow: var(--float-shadow, 0 18px 42px rgba(0, 0, 0, 0.24));
		backdrop-filter: var(--float-blur, blur(18px));
		-webkit-backdrop-filter: var(--float-blur, blur(18px));
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px;
		border-radius: 999px;
		border: 1px solid rgba(118, 127, 150, 0.12);
		background: rgba(255, 255, 255, 0.03);
		color: #9aa4b7;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease,
			transform 0.12s ease;
		white-space: nowrap;
	}

	.pill:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(150, 160, 184, 0.2);
		color: #e0e6f3;
		transform: translateY(-1px);
	}

	.pill--active {
		background: rgba(124, 92, 252, 0.16);
		border-color: rgba(124, 92, 252, 0.32);
		color: #f0f4ff;
	}

	.pill--active:hover {
		background: rgba(124, 92, 252, 0.2);
		border-color: rgba(124, 92, 252, 0.38);
	}

	.pill--exit {
		border-color: rgba(255, 107, 128, 0.14);
		color: #c9929d;
	}

	.pill--exit:hover {
		background: rgba(255, 107, 128, 0.1);
		border-color: rgba(255, 107, 128, 0.22);
		color: #ffd6dc;
	}

	.pill-slot {
		min-width: 16px;
		height: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: rgba(11, 17, 24, 0.42);
		border: 1px solid rgba(255, 255, 255, 0.06);
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.pill--active .pill-slot {
		background: rgba(124, 92, 252, 0.24);
		border-color: rgba(124, 92, 252, 0.3);
		color: #fff;
	}

	.pill-name {
		font-family: var(--font-family-mono, monospace);
		font-size: 11px;
		font-weight: 500;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pill-kbd {
		padding: 2px 6px;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(11, 17, 24, 0.5);
		font-family: var(--font-family-mono, monospace);
		font-size: 9px;
		color: #8892a5;
	}

	.pill-spacer {
		width: 1px;
		height: 20px;
		background: rgba(118, 127, 150, 0.16);
		margin: 0 4px;
	}
</style>
