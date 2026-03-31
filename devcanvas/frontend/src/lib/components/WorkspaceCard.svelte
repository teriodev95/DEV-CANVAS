<script lang="ts">
	import { getWorkspaceIcon } from '$lib/terminal/icons';
	import {
		getDefaultWorkspaceSettings,
		getTerminalColor,
		normalizeWorkspaceSettings,
	} from '$lib/terminal/settings';
	import type { Workspace } from '$lib/stores/workspace';

	type Props = {
		workspace: Workspace;
		onclick?: () => void;
	};

	let { workspace, onclick }: Props = $props();
	const defaultWorkspaceSettings = getDefaultWorkspaceSettings();

	function formatDate(dateStr: string): string {
		try {
			const d = new Date(dateStr);
			const diff = Date.now() - d.getTime();
			const mins  = Math.floor(diff / 60000);
			const hours = Math.floor(diff / 3600000);
			const days  = Math.floor(diff / 86400000);
			if (mins  < 1)  return 'just now';
			if (mins  < 60) return `${mins}m ago`;
			if (hours < 24) return `${hours}h ago`;
			if (days  === 1) return 'yesterday';
			if (days  < 7)  return `${days}d ago`;
			return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		} catch { return dateStr; }
	}

	const workspaceSettings = $derived(
		normalizeWorkspaceSettings(workspace.settings ?? defaultWorkspaceSettings)
	);
	const workspaceColor = $derived(getTerminalColor(workspaceSettings.appearance.color));
	const workspaceIcon = $derived(getWorkspaceIcon(workspaceSettings.appearance.icon));
	const WorkspaceIcon = $derived(workspaceIcon.component);
</script>

<button class="card fade-in" type="button" {onclick}>
	<!-- Session count -->
	{#if workspace.sessionCount !== undefined && workspace.sessionCount > 0}
		<span class="session-badge">{workspace.sessionCount}</span>
	{/if}

	<!-- Header -->
	<div class="card-head">
		<div
			class="avatar"
			style={`--avatar-bar:${workspaceColor.bar}; --avatar-dot:${workspaceColor.dot}; --avatar-border:${workspaceColor.border};`}
		>
			<WorkspaceIcon size={18} strokeWidth={1.9} />
		</div>
		<div class="card-meta">
			<span class="ws-name">{workspace.name}</span>
			<span class="ws-date">{formatDate(workspace.updatedAt ?? workspace.createdAt)}</span>
		</div>
	</div>

	<!-- Footer row -->
	<div class="card-foot">
		<span class="created-tag">Created {formatDate(workspace.createdAt)}</span>
	</div>
</button>

<style>
	.card {
		position: relative;
		width: 100%;
		padding: 18px 18px 14px;
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 14px;
		transition: border-color 0.15s ease, transform 0.12s ease,
		            box-shadow 0.15s ease, background 0.15s ease;
	}
	.card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(124, 92, 252, 0.12);
		background: linear-gradient(135deg, #141418, #191920);
	}

	/* Session count badge */
	.session-badge {
		position: absolute;
		top: 14px;
		right: 14px;
		font-family: var(--font-family-mono, monospace);
		font-size: 10px;
		font-weight: 600;
		color: var(--green);
		background: rgba(61, 214, 140, 0.1);
		border: 1px solid rgba(61, 214, 140, 0.22);
		padding: 1px 7px;
		border-radius: 20px;
		font-variant-numeric: tabular-nums;
	}

	/* Header */
	.card-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-right: 36px; /* avoid overlap with badge */
	}

	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--avatar-dot);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 78%),
			var(--avatar-bar);
		border: 1px solid color-mix(in srgb, var(--avatar-border) 72%, rgba(255, 255, 255, 0.08));
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 8px 18px rgba(0, 0, 0, 0.16);
		flex-shrink: 0;
	}

	.card-meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.ws-name {
		font-family: var(--font-family-mono, monospace);
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ws-date {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: var(--muted);
	}

	/* Footer */
	.card-foot {
		display: flex;
		align-items: center;
	}

	.created-tag {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 11px;
		color: #3a3a50;
	}
</style>
