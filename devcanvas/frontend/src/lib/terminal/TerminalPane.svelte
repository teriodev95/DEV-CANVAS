<script lang="ts">
	import { onMount } from 'svelte';
	import { DEV_CANVAS_BACKEND_WS_ORIGIN } from '$lib/api/backend';
	import { sessions } from '$lib/stores/sessions';
	import { BufferedReconnectingWebSocket } from '$lib/ws/client';
	import {
		clampTerminalFontSize,
		getDefaultWorkspaceSettings,
		getTerminalFontFamily,
		getTerminalTheme,
		type TerminalFontFamilyId,
		type TerminalThemeId,
	} from '$lib/terminal/settings';

	interface Props {
		sessionId: string;
		autoFocus?: boolean;
		showStatus?: boolean;
		embedded?: boolean;
		themeId?: TerminalThemeId;
		fontFamily?: TerminalFontFamilyId;
		fontSize?: number;
	}

	type XTermTerminal = import('xterm').Terminal;
	type XTermFitAddon = import('@xterm/addon-fit').FitAddon;

	const terminalDefaults = getDefaultWorkspaceSettings().terminalDefaults;

	let {
		sessionId,
		autoFocus = false,
		showStatus = true,
		embedded = false,
		themeId = terminalDefaults.themeId,
		fontFamily = terminalDefaults.fontFamily,
		fontSize = terminalDefaults.fontSize,
	}: Props = $props();

	let paneEl: HTMLDivElement | undefined = $state();
	let terminalContainer: HTMLDivElement | undefined = $state();
	let connected = $state(false);
	let sessionReady = $state(false);
	let statusText = $state('Connecting');
	let term: XTermTerminal | null = $state(null);
	let fitAddon: XTermFitAddon | null = $state(null);

	let ws: BufferedReconnectingWebSocket | null = null;
	let shouldRefocus = false;
	let focusTerminal = () => {};
	let sendInput = (_data: string) => {};
	let sendResize = () => {};

	const themePreset = $derived(getTerminalTheme(themeId));
	const fontPreset = $derived(getTerminalFontFamily(fontFamily));
	const resolvedFontSize = $derived(clampTerminalFontSize(fontSize));
	const paneStyle = $derived(
		[
			`--terminal-bg:${themePreset.surfaceBg}`,
			`--terminal-panel:${themePreset.surfaceBg}`,
			`--terminal-border:${themePreset.border}`,
			`--terminal-border-strong:${themePreset.accent}33`,
			`--terminal-text:${themePreset.previewFg}`,
			`--terminal-accent:${themePreset.accent}`,
			`--terminal-chrome:${themePreset.chromeBg}`,
		].join(';')
	);

	function nextMessageId(prefix: string) {
		return `${prefix}-${sessionId}-${crypto.randomUUID()}`;
	}

	export function focus() {
		shouldRefocus = true;
		focusTerminal();
	}

	export function blur() {
		shouldRefocus = false;
	}

	function getNativeInputTarget() {
		return term?.textarea ?? null;
	}

	function shouldUseWrapperInputFallback() {
		const nativeInput = getNativeInputTarget();
		return !!paneEl && document.activeElement === paneEl && !nativeInput;
	}

	onMount(() => {
		let cleanup = () => {};

		void (async () => {
			const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
				import('xterm'),
				import('@xterm/addon-fit'),
				import('@xterm/addon-web-links'),
			]);

			await import('xterm/css/xterm.css');

			term = new Terminal({
				theme: themePreset.xtermTheme,
				fontFamily: fontPreset.stack,
				fontSize: resolvedFontSize,
				fontWeight: '400',
				lineHeight: 1,
				letterSpacing: 0,
				drawBoldTextInBrightColors: false,
				cursorBlink: true,
				allowTransparency: true,
				scrollback: 5000,
				convertEol: true,
				smoothScrollDuration: 60,
			});

			fitAddon = new FitAddon();
			const webLinksAddon = new WebLinksAddon();
			term.loadAddon(fitAddon);
			term.loadAddon(webLinksAddon);

			sendInput = (data: string) => {
				if (!sessionReady) return;
				ws?.send({
					type: 'terminal:input',
					id: nextMessageId('input'),
					sessionId,
					data,
				});
			};

			focusTerminal = () => {
				requestAnimationFrame(() => {
					term?.focus();
					const nativeInput = getNativeInputTarget();
					if (nativeInput) {
						nativeInput.focus({ preventScroll: true });
						return;
					}
					paneEl?.focus({ preventScroll: true });
				});
			};

			sendResize = () => {
				if (!term || !fitAddon) return;
				try {
					fitAddon.fit();
				} catch {}
				if (!sessionReady) return;

				ws?.send({
					type: 'terminal:resize',
					id: nextMessageId('resize'),
					sessionId,
					cols: term.cols,
					rows: term.rows,
				});
			};

			const scheduleInitialFits = () => {
				sendResize();
				requestAnimationFrame(() => sendResize());
				const timers = [60, 180, 360].map((delay) => setTimeout(() => sendResize(), delay));
				void document.fonts?.ready?.then(() => sendResize());
				return () => timers.forEach((timer) => clearTimeout(timer));
			};

			let clearInitialFits = () => {};

			if (terminalContainer && term) {
				term.open(terminalContainer);
				clearInitialFits = scheduleInitialFits();
				if (autoFocus) {
					shouldRefocus = true;
					focusTerminal();
				}
			}

			const subscribeToSession = () => {
				sessionReady = false;
				statusText = 'Negotiating session';
				ws?.send({
					type: 'session:subscribe',
					id: nextMessageId('subscribe'),
					sessionId,
				});
			};

			ws = new BufferedReconnectingWebSocket(`${DEV_CANVAS_BACKEND_WS_ORIGIN}/ws`);
			ws.setOutputHandler((data) => term?.write(data));

			ws.onConnect = () => {
				connected = true;
				subscribeToSession();
			};

			ws.onDisconnect = () => {
				connected = false;
				sessionReady = false;
				statusText = 'Reconnecting';
			};

			ws.onMessage = (msg) => {
				if (msg.type === 'session:ready') {
					sessionReady = true;
					statusText = 'Ready';
					sendResize();
					if (shouldRefocus || autoFocus) focusTerminal();
					return;
				}

				if (msg.type === 'error') {
					const message = typeof msg.message === 'string' ? msg.message : 'Unknown terminal error';
					const code = typeof msg.code === 'string' ? msg.code : 'ERROR';
					statusText = `Error · ${code}`;
					term?.writeln(`\r\n\x1b[31mError: ${message}\x1b[0m`);
					return;
				}

				if (
					msg.type === 'session:cwd' &&
					msg.sessionId === sessionId &&
					typeof msg.workingDir === 'string'
				) {
					const nextWorkingDir = msg.workingDir;
					sessions.update((current) =>
						current.map((session) =>
							session.id === sessionId ? { ...session, workingDir: nextWorkingDir } : session
						)
					);
				}
			};

			term.onData((data) => {
				sendInput(data);
			});

			const handleWindowFocus = () => {
				if (shouldRefocus || autoFocus) focusTerminal();
			};

			window.addEventListener('focus', handleWindowFocus);
			window.addEventListener('resize', sendResize);

			let resizeObserver: ResizeObserver | undefined;
			if (terminalContainer) {
				resizeObserver = new ResizeObserver(() => sendResize());
				resizeObserver.observe(terminalContainer);
			}

			cleanup = () => {
				clearInitialFits();
				window.removeEventListener('focus', handleWindowFocus);
				window.removeEventListener('resize', sendResize);
				resizeObserver?.disconnect();
				ws?.destroy();
				ws = null;
				term?.dispose();
				term = null;
				fitAddon = null;
			};
		})();

		return () => cleanup();
	});

	$effect(() => {
		if (!term) return;
		term.options.theme = themePreset.xtermTheme;
		term.options.fontFamily = fontPreset.stack;
		term.options.fontSize = resolvedFontSize;
		requestAnimationFrame(() => sendResize());
		void document.fonts?.ready?.then(() => sendResize());
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!sessionReady || !shouldUseWrapperInputFallback()) return;
		if (event.metaKey) return;

		let data: string | null = null;

		if (event.ctrlKey && event.key.length === 1) {
			const upper = event.key.toUpperCase();
			const code = upper.charCodeAt(0);
			if (code >= 64 && code <= 95) {
				data = String.fromCharCode(code - 64);
			}
		} else if (event.altKey && event.key.length === 1) {
			data = `\x1b${event.key}`;
		} else if (event.key.length === 1 && !event.altKey && !event.ctrlKey) {
			data = event.key;
		} else {
			switch (event.key) {
				case 'Enter':
					data = '\r';
					break;
				case 'Backspace':
					data = '\x7f';
					break;
				case 'Tab':
					data = '\t';
					break;
				case 'Escape':
					data = '\x1b';
					break;
				case 'ArrowUp':
					data = '\x1b[A';
					break;
				case 'ArrowDown':
					data = '\x1b[B';
					break;
				case 'ArrowRight':
					data = '\x1b[C';
					break;
				case 'ArrowLeft':
					data = '\x1b[D';
					break;
				case 'Home':
					data = '\x1b[H';
					break;
				case 'End':
					data = '\x1b[F';
					break;
				case 'Delete':
					data = '\x1b[3~';
					break;
				case 'PageUp':
					data = '\x1b[5~';
					break;
				case 'PageDown':
					data = '\x1b[6~';
					break;
			}
		}

		if (!data) return;

		event.preventDefault();
		event.stopPropagation();
		sendInput(data);
	}

	function handlePaste(event: ClipboardEvent) {
		if (!sessionReady || !shouldUseWrapperInputFallback()) return;
		const text = event.clipboardData?.getData('text/plain');
		if (!text) return;
		event.preventDefault();
		sendInput(text.replace(/\n/g, '\r'));
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={paneEl}
	class="terminal-pane"
	class:embedded
	style={paneStyle}
	role="application"
	tabindex="0"
	onpointerdown={() => focus()}
	onkeydown={handleKeydown}
	onpaste={handlePaste}
>
	{#if showStatus}
		<div class="status-bar">
			<div class="status-side">
				<div class="status-dot" class:connected={connected && sessionReady}></div>
				<span class="status-label">{connected && sessionReady ? 'Live session' : statusText}</span>
			</div>
			<div class="status-side status-side--right">
				<span class="status-chip">{sessionId}</span>
			</div>
		</div>
	{/if}

	<div class="terminal-stage">
		<div bind:this={terminalContainer} class="terminal-host"></div>
	</div>
</div>

<style>
	.terminal-pane {
		--terminal-bg: #0b1118;
		--terminal-panel: #0f151f;
		--terminal-border: rgba(105, 122, 155, 0.16);
		--terminal-border-strong: rgba(124, 92, 252, 0.2);
		--terminal-chrome: #161a20;
		--terminal-text: #d9e1f2;
		--terminal-muted: #7b879d;
		--terminal-accent: #7c5cfc;
		width: 100%;
		height: 100%;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.012), transparent 16%),
			var(--terminal-bg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
		border: 1px solid var(--terminal-border);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.03),
			0 10px 30px rgba(0, 0, 0, 0.22);
	}

	.terminal-pane::before {
		content: '';
		position: absolute;
		inset: 0;
		border: 1px solid rgba(255, 255, 255, 0.025);
		pointer-events: none;
	}

	.embedded {
		border: none;
		box-shadow: none;
	}

	.status-bar {
		position: absolute;
		top: 10px;
		left: 12px;
		right: 12px;
		z-index: 12;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		pointer-events: none;
	}

	.status-side {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.status-side--right {
		justify-content: flex-end;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #e7c980;
		flex-shrink: 0;
		animation: pulse-dot 1.5s ease-in-out infinite;
		box-shadow: 0 0 0 4px rgba(231, 201, 128, 0.12);
	}

	.status-dot.connected {
		background: #8bd49c;
		box-shadow: 0 0 0 4px rgba(139, 212, 156, 0.12);
		animation: none;
	}

	.status-label {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 10px;
		color: var(--terminal-muted);
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.status-chip {
		max-width: 240px;
		padding: 5px 10px;
		border-radius: 999px;
		border: 1px solid var(--terminal-border);
		background: rgba(12, 16, 24, 0.82);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
		color: #a9b4c8;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.terminal-stage {
		flex: 1;
		overflow: hidden;
	}

	.terminal-host {
		width: 100%;
		height: 100%;
		background: var(--terminal-panel);
		border-top: 1px solid var(--terminal-border);
		border-bottom: 1px solid var(--terminal-border);
		overflow: hidden;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
	}

	/*
	 * Counter-transform for SvelteFlow zoom.
	 *
	 * SvelteFlow applies `transform: scale(zoom)` on the viewport.  xterm.js
	 * computes mouse → cell coordinates by dividing screen-pixel offsets by
	 * CSS-pixel cell dimensions, which diverge under a CSS scale → selection
	 * appears shifted vertically.
	 *
	 * Fix: scale the terminal host by `1/zoom` (cancelling the viewport zoom)
	 * and enlarge CSS dimensions by `zoom` so the element still fills its
	 * parent visually.  The result is 1:1 CSS↔screen pixels inside the
	 * terminal, making xterm coordinate math correct at every zoom level.
	 *
	 * --flow-zoom is set on CanvasEditor's wrapper and inherited via CSS.
	 */
	.embedded .terminal-host {
		transform: scale(calc(1 / var(--flow-zoom, 1)));
		transform-origin: top left;
		width: calc(100% * var(--flow-zoom, 1));
		height: calc(100% * var(--flow-zoom, 1));
	}

	.embedded .terminal-stage {
		padding: 0;
	}

	.embedded .terminal-host {
		border-top-color: rgba(105, 122, 155, 0.12);
		border-bottom-color: rgba(105, 122, 155, 0.12);
		background: var(--terminal-panel);
	}

	:global(.xterm) {
		height: 100%;
		padding: 0;
		font-variant-ligatures: none;
		-webkit-font-smoothing: antialiased;
		text-rendering: auto;
	}

	:global(.xterm-viewport) {
		background: transparent !important;
		scrollbar-width: thin;
		scrollbar-color: rgba(123, 135, 157, 0.55) transparent;
	}

	:global(.xterm-viewport::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
	}

	:global(.xterm-viewport::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(.xterm-viewport::-webkit-scrollbar-thumb) {
		background: rgba(123, 135, 157, 0.42);
		border: 3px solid transparent;
		background-clip: padding-box;
		border-radius: 999px;
	}

	:global(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
		background: rgba(169, 180, 200, 0.62);
		border: 3px solid transparent;
		background-clip: padding-box;
	}

	:global(.xterm .xterm-rows) {
		color: var(--terminal-text);
	}

	:global(.xterm .xterm-cursor-layer) {
		filter: drop-shadow(0 0 8px rgba(124, 92, 252, 0.22));
	}

	:global(.xterm .xterm-selection div) {
		background-color: rgba(124, 92, 252, 0.2) !important;
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
</style>
