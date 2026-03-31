import {
	BrainCircuit,
	Code2,
	Container,
	Cpu,
	Database,
	FileCode2,
	FolderKanban,
	GitBranch,
	Hexagon,
	LayoutGrid,
	Layers3,
	SquareTerminal,
	Wrench,
} from 'lucide-svelte';
import type { ComponentType } from 'svelte';
import type { TerminalIconKey, WorkspaceIconKey } from './settings';

export type TerminalIconPreset = {
	key: TerminalIconKey;
	label: string;
	component: ComponentType;
};

export type WorkspaceIconPreset = {
	key: WorkspaceIconKey;
	label: string;
	component: ComponentType;
};

export const TERMINAL_ICONS: TerminalIconPreset[] = [
	{ key: '', label: 'Shell', component: SquareTerminal },
	{ key: 'git', label: 'Git', component: GitBranch },
	{ key: 'node', label: 'Node', component: Hexagon },
	{ key: 'py', label: 'Python', component: FileCode2 },
	{ key: 'db', label: 'Database', component: Database },
	{ key: 'dock', label: 'Docker', component: Container },
	{ key: 'proc', label: 'Process', component: Cpu },
	{ key: 'brain', label: 'AI', component: BrainCircuit },
	{ key: 'code', label: 'Code', component: Code2 },
	{ key: 'tool', label: 'Tools', component: Wrench },
];

export const WORKSPACE_ICONS: WorkspaceIconPreset[] = [
	{ key: 'terminal', label: 'Terminal', component: SquareTerminal },
	{ key: 'folder', label: 'Folder', component: FolderKanban },
	{ key: 'grid', label: 'Grid', component: LayoutGrid },
	{ key: 'layers', label: 'Layers', component: Layers3 },
];

export function getTerminalIcon(icon: TerminalIconKey): TerminalIconPreset {
	return TERMINAL_ICONS.find((item) => item.key === icon) ?? TERMINAL_ICONS[0];
}

export function getWorkspaceIcon(icon: WorkspaceIconKey): WorkspaceIconPreset {
	return WORKSPACE_ICONS.find((item) => item.key === icon) ?? WORKSPACE_ICONS[0];
}
