<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { BufferedReconnectingWebSocket } from '$lib/ws/client';

	const sessionId = $derived($page.params.id);

	let terminalContainer: HTMLDivElement | undefined = $state();
	let ws: BufferedReconnectingWebSocket | null = null;
	let connected = $state(false);
	let statusText = $state('Connecting...');

	onMount(async () => {
		// Dynamic imports to avoid SSR issues
		const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
			import('xterm'),
			import('@xterm/addon-fit'),
			import('@xterm/addon-web-links'),
		]);

		// Import xterm CSS
		await import('xterm/css/xterm.css');

		const FONT_KEY = 'devcanvas:fontSize';
		const storedSize = parseInt(localStorage.getItem(FONT_KEY) ?? '', 10);
		const initialFontSize = isNaN(storedSize) ? 13 : Math.min(Math.max(storedSize, 9), 22);

		const term = new Terminal({
			theme: {
				background: '#0d0d0f',
				foreground: '#e8e8f0',
				cursor: '#7c5cfc',
				cursorAccent: '#0d0d0f',
				selectionBackground: 'rgba(124,92,252,0.3)',
				black: '#1c1c22',
				red: '#ff5555',
				green: '#3dd68c',
				yellow: '#f1c40f',
				blue: '#5b8dee',
				magenta: '#c678dd',
				cyan: '#56b6c2',
				white: '#e8e8f0',
				brightBlack: '#6b6b80',
				brightRed: '#ff6e6e',
				brightGreen: '#4df9a8',
				brightYellow: '#ffd97d',
				brightBlue: '#7ea8f8',
				brightMagenta: '#d198e8',
				brightCyan: '#7ecbcf',
				brightWhite: '#ffffff',
			},
			fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
			fontSize: initialFontSize,
			lineHeight: 1.5,
			cursorBlink: true,
			allowTransparency: true,
			scrollback: 5000,
			convertEol: true,
		});

		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();

		term.loadAddon(fitAddon);
		term.loadAddon(webLinksAddon);

		if (terminalContainer) {
			term.open(terminalContainer);
			fitAddon.fit();
		}

		// Connect WebSocket
		const wsUrl = `ws://${window.location.hostname}:3001/ws`;
		ws = new BufferedReconnectingWebSocket(wsUrl);

		ws.setOutputHandler((data) => {
			term.write(data);
		});

		ws.onConnect = () => {
			connected = true;
			statusText = 'Connected';
			// Subscribe to session
			ws?.send({
				type: 'session:subscribe',
				sessionId,
			});
		};

		ws.onDisconnect = () => {
			connected = false;
			statusText = 'Reconnecting...';
		};

		ws.onMessage = (msg) => {
			if (msg.type === 'terminal:error') {
				term.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
			} else if (msg.type === 'session:ready') {
				term.clear();
				statusText = `Connected · ${sessionId}`;
			}
		};

		// Forward terminal input to WS
		term.onData((data) => {
			ws?.send({
				type: 'terminal:input',
				sessionId,
				data,
			});
		});

		// Handle resize
		const handleResize = () => {
			fitAddon.fit();
			ws?.send({
				type: 'terminal:resize',
				sessionId,
				cols: term.cols,
				rows: term.rows,
			});
		};

		window.addEventListener('resize', handleResize);

		// React to font size changes from parent (localStorage)
		const handleStorage = (e: StorageEvent) => {
			if (e.key !== FONT_KEY || !e.newValue) return;
			const size = parseInt(e.newValue, 10);
			if (!isNaN(size)) {
				term.options.fontSize = size;
				fitAddon.fit();
			}
		};
		window.addEventListener('storage', handleStorage);

		// Initial resize after fit
		setTimeout(() => {
			fitAddon.fit();
		}, 100);

		return () => {
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('storage', handleStorage);
		};
	});

	onDestroy(() => {
		ws?.destroy();
		ws = null;
	});
</script>

<svelte:head>
	<title>Terminal · {sessionId}</title>
</svelte:head>

<div
	style="
		width: 100vw;
		height: 100vh;
		background: #0d0d0f;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	"
>
	<!-- Minimal status pill in top-right corner -->
	<div
		style="
			position: absolute;
			top: 10px;
			right: 12px;
			z-index: 10;
			display: flex;
			align-items: center;
			gap: 5px;
			background: rgba(20,20,24,0.85);
			border: 1px solid #2a2a35;
			border-radius: 20px;
			padding: 3px 10px 3px 7px;
			backdrop-filter: blur(6px);
		"
	>
		<!-- Status dot -->
		<div
			style="
				width: 6px; height: 6px;
				border-radius: 50%;
				background: {connected ? '#3dd68c' : '#f1c40f'};
				animation: {connected ? 'none' : 'pulse-dot 1.5s ease-in-out infinite'};
				flex-shrink: 0;
			"
		></div>
		<span
			style="
				font-family: JetBrains Mono, Fira Code, monospace;
				font-size: 10px;
				color: #6b6b80;
				white-space: nowrap;
			"
		>
			{statusText}
		</span>
	</div>

	<!-- Terminal container — full 100vh, no extra chrome -->
	<div
		bind:this={terminalContainer}
		id="terminal-container"
		style="flex: 1; width: 100%; height: 100%; background: #0d0d0f; overflow: hidden;"
	></div>
</div>

<style>
	:global(body) {
		overflow: hidden !important;
		background: #0d0d0f !important;
	}

	:global(.xterm) {
		height: 100%;
	}

	:global(.xterm-viewport) {
		background: #0d0d0f !important;
	}

	:global(.xterm-screen) {
		padding: 6px;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}
</style>
