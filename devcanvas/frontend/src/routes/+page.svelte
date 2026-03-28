<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import WorkspaceCard from '$lib/components/WorkspaceCard.svelte';
	import { api } from '$lib/api';
	import type { Workspace } from '$lib/stores/workspace';

	let workspaces = $state<Workspace[]>([]);
	let loading = $state(true);
	let showCreateModal = $state(false);
	let newWorkspaceName = $state('');
	let creating = $state(false);

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}

	onMount(async () => {
		try {
			const data = await api.workspaces.list();
			workspaces = Array.isArray(data) ? data : (data.workspaces ?? []);
		} catch {
			// Demo mode
			workspaces = [
				{
					id: 'demo-1',
					name: 'my-project',
					createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
					updatedAt: new Date(Date.now() - 3600000).toISOString(),
					sessionCount: 3,
				},
				{
					id: 'demo-2',
					name: 'infra-setup',
					createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
					updatedAt: new Date(Date.now() - 86400000).toISOString(),
					sessionCount: 1,
				},
			];
		} finally {
			loading = false;
		}
	});

	async function createWorkspace() {
		if (!newWorkspaceName.trim() || creating) return;
		creating = true;
		try {
			const workspace = await api.workspaces.create(newWorkspaceName.trim());
			workspaces = [...workspaces, workspace];
			showCreateModal = false;
			newWorkspaceName = '';
			goto(`/workspace/${workspace.id}`);
		} catch {
			const demoId = `demo-${Date.now()}`;
			const demoWorkspace: Workspace = {
				id: demoId,
				name: newWorkspaceName.trim(),
				createdAt: new Date().toISOString(),
				sessionCount: 0,
			};
			workspaces = [...workspaces, demoWorkspace];
			showCreateModal = false;
			newWorkspaceName = '';
			goto(`/workspace/${demoId}`);
		} finally {
			creating = false;
		}
	}

	function openCreate() {
		newWorkspaceName = '';
		showCreateModal = true;
	}
</script>

<div style="min-height: 100vh; background: var(--bg); overflow-y: auto; overflow-x: hidden; background-image: radial-gradient(circle, #2a2a35 1px, transparent 1px); background-size: 28px 28px;">
	<!-- Top Bar -->
	<header
		style="
			position: sticky; top: 0; z-index: 10;
			background: rgba(13,13,15,0.9);
			backdrop-filter: blur(12px);
			border-bottom: 1px solid var(--border);
			padding: 0 32px; height: 56px;
			display: flex; align-items: center; justify-content: space-between;
		"
	>
		<div style="display: flex; align-items: center; gap: 10px;">
			<span style="font-family: var(--font-family-mono, monospace); font-size: 18px; font-weight: 500; color: var(--accent); letter-spacing: -0.5px;">
				<span style="color: #3a3a50; font-weight: 400;">&gt;_</span> DevCanvas
			</span>
			<span style="background: rgba(124,92,252,0.12); border: 1px solid rgba(124,92,252,0.2); color: var(--accent); font-size: 10px; font-weight: 500; padding: 2px 7px; border-radius: 10px; font-family: var(--font-family-mono, monospace);">v0.1</span>
		</div>
		<button
			onclick={openCreate}
			style="background: var(--accent); border: none; color: #fff; font-size: 13px; font-weight: 500; padding: 8px 16px; border-radius: 7px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.15s ease, transform 0.1s ease;"
			onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--accent-hover)'; el.style.transform = 'translateY(-1px)'; }}
			onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--accent)'; el.style.transform = 'translateY(0)'; }}
		>
			<span style="font-size:16px;line-height:1;">+</span> New Workspace
			<span style="font-family: var(--font-family-mono, monospace); font-size: 10px; color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.1); padding: 1px 5px; border-radius: 3px; margin-left: 2px;">N</span>
		</button>
	</header>

	<main style="max-width: 1200px; margin: 0 auto; padding: 48px 32px;">
		<div style="margin-bottom: 32px;">
			<h1 style="margin: 0 0 8px; font-size: 28px; font-weight: 600; color: var(--text); letter-spacing: -0.5px; font-family: var(--font-family-mono, monospace);">Workspaces</h1>
			<p style="margin: 0; font-size: 14px; color: var(--muted); font-family: 'Inter', system-ui, sans-serif;">Your visual terminal workspaces</p>
		</div>

		{#if loading}
			<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
				{#each { length: 4 } as _}
					<div style="height: 120px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; animation: pulse-dot 1.5s ease-in-out infinite;"></div>
				{/each}
			</div>
		{:else if workspaces.length === 0}
			<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 32px; text-align: center;">
				<div style="background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px 28px; margin-bottom: 24px; font-family: var(--font-family-mono, monospace); font-size: 13px; color: var(--muted); line-height: 1.8; text-align: left;">
					<div><span style="color: #3dd68c;">~/devcanvas</span> <span style="color: var(--accent);">$</span> ls workspaces/</div>
					<div style="color: #3a3a50; font-style: italic;">total 0</div>
					<div><span style="color: var(--accent);">$</span> <span class="blink-cursor" style="display:inline-block;width:8px;height:13px;background:var(--accent);vertical-align:middle;animation:pulse-dot 1s step-end infinite;opacity:0.8;"></span></div>
				</div>
				<h2 style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: var(--text);">No workspaces yet</h2>
				<p style="margin: 0 0 24px; font-size: 14px; color: var(--muted); font-family: 'Inter', system-ui, sans-serif; max-width: 320px; line-height: 1.6;">Create a workspace to get started. Each workspace is an infinite canvas where you can arrange terminals and notes.</p>
				<button
					onclick={openCreate}
					style="background: var(--accent); border: none; color: #fff; font-size: 14px; font-weight: 500; padding: 10px 24px; border-radius: 8px; cursor: pointer; transition: background 0.15s ease;"
					onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)')}
					onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--accent)')}
				>Create your first workspace</button>
			</div>
		{:else}
			<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
				{#each workspaces as workspace (workspace.id)}
					<WorkspaceCard {workspace} onclick={() => goto(`/workspace/${workspace.id}`)} />
				{/each}
			</div>
		{/if}
	</main>
</div>

{#if showCreateModal}
	<div
		style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px); z-index: 1000; display: flex; align-items: center; justify-content: center;"
		role="dialog" aria-modal="true"
		onclick={(e) => { if (e.target === e.currentTarget) showCreateModal = false; }}
		onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
		tabindex="-1"
	>
		<div
			style="background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 28px; width: 380px; box-shadow: 0 24px 64px rgba(0,0,0,0.5);"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Enter' && createWorkspace()}
			role="presentation"
		>
			<h2 style="margin: 0 0 6px; font-size: 18px; font-weight: 600; color: var(--text);">New Workspace</h2>
			<p style="margin: 0 0 20px; font-size: 13px; color: var(--muted);">An infinite canvas for your terminals and notes.</p>

			<label style="display: block; margin-bottom: 20px;">
				<span style="font-size: 11px; font-weight: 500; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; display: block; margin-bottom: 6px;">Workspace name</span>
				<input
					type="text"
					bind:value={newWorkspaceName}
					placeholder="my-project"
					style="width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 7px; padding: 10px 14px; color: var(--text); font-family: var(--font-family-mono, monospace); font-size: 14px; outline: none; transition: border-color 0.1s ease;"
					onfocus={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = 'var(--accent)')}
					onblur={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)')}
					use:focusOnMount
				/>
			</label>

			<div style="display: flex; gap: 8px; justify-content: flex-end;">
				<button
					onclick={() => (showCreateModal = false)}
					style="background: transparent; border: 1px solid var(--border); color: var(--muted); padding: 8px 18px; border-radius: 7px; font-size: 13px; cursor: pointer; transition: border-color 0.1s, color 0.1s;"
					onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--muted)'; el.style.color = 'var(--text)'; }}
					onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--muted)'; }}
				>Cancel</button>
				<button
					onclick={createWorkspace}
					disabled={creating || !newWorkspaceName.trim()}
					style="background: var(--accent); border: none; color: #fff; padding: 8px 18px; border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer; opacity: {creating || !newWorkspaceName.trim() ? '0.5' : '1'}; transition: background 0.15s ease;"
					onmouseenter={(e) => { if (!creating) (e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
				>
					{creating ? 'Creating...' : 'Create Workspace'}
				</button>
			</div>
		</div>
	</div>
{/if}
