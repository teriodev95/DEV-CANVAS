<script lang="ts">
	import type { Workspace } from '$lib/stores/workspace';

	type Props = {
		workspace: Workspace;
		onclick?: () => void;
	};

	let { workspace, onclick }: Props = $props();

	function formatDate(dateStr: string): string {
		try {
			const d = new Date(dateStr);
			const now = new Date();
			const diff = now.getTime() - d.getTime();
			const mins = Math.floor(diff / 60000);
			const hours = Math.floor(diff / 3600000);
			const days = Math.floor(diff / 86400000);
			if (mins < 1) return 'just now';
			if (mins < 60) return `${mins} min ago`;
			if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
			if (days === 1) return 'yesterday';
			if (days < 7) return `${days} days ago`;
			return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		} catch {
			return dateStr;
		}
	}

	// Deterministic hue from workspace name for avatar gradient
	function nameHue(name: string): number {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
		}
		return Math.abs(hash) % 360;
	}

	const initials = $derived(
		workspace.name
			.split(/[\s\-_]+/)
			.slice(0, 2)
			.map((w) => w.slice(0, 1).toUpperCase())
			.join(''),
	);

	const avatarHue = $derived(nameHue(workspace.name));
	const avatarGradient = $derived(
		`linear-gradient(135deg, hsl(${avatarHue},60%,30%), hsl(${(avatarHue + 40) % 360},70%,22%))`
	);
</script>

<button
	class="workspace-card fade-in"
	onclick={onclick}
	style="
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 20px;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease, background 0.15s ease;
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		position: relative;
	"
	onmouseenter={(e) => {
		const el = e.currentTarget as HTMLElement;
		el.style.borderColor = 'var(--accent)';
		el.style.transform = 'translateY(-2px)';
		el.style.boxShadow = '0 8px 24px rgba(124,92,252,0.15)';
		el.style.background = 'linear-gradient(135deg, #141418, #1c1c22)';
	}}
	onmouseleave={(e) => {
		const el = e.currentTarget as HTMLElement;
		el.style.borderColor = 'var(--border)';
		el.style.transform = 'translateY(0)';
		el.style.boxShadow = 'none';
		el.style.background = 'var(--surface)';
	}}
>
	<!-- Session count badge in top-right -->
	{#if workspace.sessionCount !== undefined}
		<span
			style="
				position: absolute;
				top: 14px; right: 14px;
				background: rgba(61,214,140,0.12);
				border: 1px solid rgba(61,214,140,0.25);
				color: #3dd68c;
				font-size: 10px;
				font-weight: 600;
				padding: 1px 7px;
				border-radius: 20px;
				font-family: var(--font-family-mono, monospace);
				font-variant-numeric: tabular-nums;
			"
		>
			{workspace.sessionCount}
		</span>
	{/if}

	<!-- Header -->
	<div style="display:flex;align-items:center;gap:12px;padding-right: 40px;">
		<!-- Avatar with name-hash gradient -->
		<div
			style="
				width: 40px; height: 40px;
				border-radius: 8px;
				background: {avatarGradient};
				border: 1px solid rgba(255,255,255,0.08);
				display: flex; align-items: center; justify-content: center;
				font-family: var(--font-family-mono, monospace);
				font-size: 14px;
				font-weight: 600;
				color: rgba(255,255,255,0.9);
				flex-shrink: 0;
				letter-spacing: 0.5px;
			"
		>
			{initials}
		</div>
		<div style="min-width:0;">
			<div
				style="
					font-size: 15px;
					font-weight: 600;
					color: var(--text);
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
					font-family: var(--font-family-mono, monospace);
				"
			>
				{workspace.name}
			</div>
			<div style="font-size: 12px; color: var(--muted); margin-top: 2px; font-family: 'Inter', system-ui, sans-serif;">
				{formatDate(workspace.updatedAt ?? workspace.createdAt)}
			</div>
		</div>
	</div>

	<!-- Meta -->
	<div style="display:flex;align-items:center;gap:8px;">
		<span
			style="
				background: var(--surface2);
				color: var(--muted);
				font-size: 11px;
				padding: 2px 8px;
				border-radius: 20px;
				font-family: 'Inter', system-ui, sans-serif;
			"
		>
			Created {formatDate(workspace.createdAt)}
		</span>
	</div>
</button>
