<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import TerminalPane from '$lib/terminal/TerminalPane.svelte';
	import {
		getDefaultWorkspaceSettings,
		resolveTerminalAppearance,
		type EffectiveTerminalAppearance,
	} from '$lib/terminal/settings';

	const sessionId = $derived($page.params.id ?? '');
	const defaultAppearance = resolveTerminalAppearance(getDefaultWorkspaceSettings(), null);

	let appearance = $state<EffectiveTerminalAppearance>(defaultAppearance);

	onMount(() => {
		void (async () => {
			try {
				const session = await api.sessions.get(sessionId);
				const workspace = await api.workspaces.get(session.workspaceId);
				appearance = resolveTerminalAppearance(workspace.settings, session.appearance);
			} catch {
				appearance = defaultAppearance;
			}
		})();
	});
</script>

<svelte:head>
	<title>Terminal · {sessionId}</title>
</svelte:head>

<div class="terminal-route">
	<div class="terminal-shell">
		<TerminalPane
			{sessionId}
			autoFocus={true}
			themeId={appearance.themeId}
			fontFamily={appearance.fontFamily}
			fontSize={appearance.fontSize}
		/>
	</div>
</div>

<style>
	:global(body) {
		overflow: hidden !important;
		background: #0b1118 !important;
	}

	.terminal-route {
		width: 100vw;
		height: 100vh;
		padding: 18px;
		background:
			radial-gradient(circle at top left, rgba(124, 92, 252, 0.1), transparent 25%),
			linear-gradient(180deg, #111923 0%, #0b1118 100%);
		display: flex;
		align-items: stretch;
		justify-content: stretch;
		overflow: hidden;
	}

	.terminal-shell {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		border: 1px solid rgba(109, 122, 149, 0.16);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.03),
			0 24px 60px rgba(0, 0, 0, 0.24);
	}
</style>
