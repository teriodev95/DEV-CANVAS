export type TerminalColorKey = '' | 'indigo' | 'blue' | 'emerald' | 'amber' | 'rose' | 'sky';
export type TerminalIconKey =
	| ''
	| 'git'
	| 'node'
	| 'py'
	| 'db'
	| 'dock'
	| 'proc'
	| 'brain'
	| 'code'
	| 'tool';
export type TerminalThemeId = 'default-dark' | 'onedarkpro' | 'rosepine';
export type TerminalFontFamilyId = 'sfmono' | 'jetbrains' | 'menlo';
export type WorkspaceIconKey = 'terminal' | 'folder' | 'grid' | 'layers';

export type TerminalSessionAppearance = {
	icon?: TerminalIconKey | null;
	color?: TerminalColorKey | null;
	themeId?: TerminalThemeId | null;
	fontFamily?: TerminalFontFamilyId | null;
	fontSize?: number | null;
};

export type WorkspaceSettings = {
	appearance: {
		icon: WorkspaceIconKey;
		color: TerminalColorKey;
	};
	terminalDefaults: {
		themeId: TerminalThemeId;
		fontFamily: TerminalFontFamilyId;
		fontSize: number;
	};
};

export type EffectiveTerminalAppearance = {
	icon: TerminalIconKey;
	color: TerminalColorKey;
	themeId: TerminalThemeId;
	fontFamily: TerminalFontFamilyId;
	fontSize: number;
};

type TerminalThemePreset = {
	id: TerminalThemeId;
	label: string;
	previewBg: string;
	previewFg: string;
	chromeBg: string;
	surfaceBg: string;
	border: string;
	accent: string;
	xtermTheme: {
		background: string;
		foreground: string;
		cursor: string;
		cursorAccent: string;
		selectionBackground: string;
		selectionInactiveBackground: string;
		black: string;
		red: string;
		green: string;
		yellow: string;
		blue: string;
		magenta: string;
		cyan: string;
		white: string;
		brightBlack: string;
		brightRed: string;
		brightGreen: string;
		brightYellow: string;
		brightBlue: string;
		brightMagenta: string;
		brightCyan: string;
		brightWhite: string;
	};
};

type FontFamilyPreset = {
	id: TerminalFontFamilyId;
	label: string;
	stack: string;
	preview: string;
};

export const TERMINAL_FONT_SIZE_MIN = 11;
export const TERMINAL_FONT_SIZE_MAX = 18;

export const TERMINAL_COLORS: Array<{
	key: TerminalColorKey;
	label: string;
	bar: string;
	dot: string;
	glow: string;
	border: string;
}> = [
	{ key: '', label: 'Default', bar: '#141418', dot: '#3dd68c', glow: '#3dd68c66', border: '#2a2a35' },
	{ key: 'indigo', label: 'Indigo', bar: '#18152a', dot: '#9575ff', glow: '#9575ff55', border: '#3a2a55' },
	{ key: 'blue', label: 'Blue', bar: '#101d2e', dot: '#5aa8ff', glow: '#5aa8ff55', border: '#1e3555' },
	{ key: 'emerald', label: 'Emerald', bar: '#0e1e18', dot: '#3dd68c', glow: '#3dd68c55', border: '#1a3a28' },
	{ key: 'amber', label: 'Amber', bar: '#201c0e', dot: '#f5a623', glow: '#f5a62355', border: '#3a3010' },
	{ key: 'rose', label: 'Rose', bar: '#201015', dot: '#ff6b80', glow: '#ff6b8055', border: '#3a1525' },
	{ key: 'sky', label: 'Sky', bar: '#0e1e24', dot: '#22d3ee', glow: '#22d3ee55', border: '#103540' },
];

export const TERMINAL_THEMES: TerminalThemePreset[] = [
	{
		id: 'default-dark',
		label: 'Default Dark',
		previewBg: '#0f1217',
		previewFg: '#c7cad1',
		chromeBg: '#161a20',
		surfaceBg: '#0c1016',
		border: 'rgba(122, 131, 148, 0.22)',
		accent: '#7c5cfc',
		xtermTheme: {
			background: '#000000',
			foreground: '#c1c1c1',
			cursor: '#f0f0f0',
			cursorAccent: '#000000',
			selectionBackground: 'rgba(124,92,252,0.24)',
			selectionInactiveBackground: 'rgba(124,92,252,0.14)',
			black: '#757575',
			red: '#cc685c',
			green: '#76c266',
			yellow: '#cbca9b',
			blue: '#85aacb',
			magenta: '#cc72ca',
			cyan: '#74a7cb',
			white: '#c1c1c1',
			brightBlack: '#727272',
			brightRed: '#cc9d97',
			brightGreen: '#a3dd97',
			brightYellow: '#cbcaaa',
			brightBlue: '#9ab6cb',
			brightMagenta: '#cc8ecb',
			brightCyan: '#b7b8cb',
			brightWhite: '#f0f0f0',
		},
	},
	{
		id: 'onedarkpro',
		label: 'One Dark',
		previewBg: '#20242b',
		previewFg: '#abb2bf',
		chromeBg: '#1b1f26',
		surfaceBg: '#12161d',
		border: 'rgba(97, 175, 239, 0.22)',
		accent: '#61afef',
		xtermTheme: {
			background: '#21252B',
			foreground: '#ABB2BF',
			cursor: '#D7DAE0',
			cursorAccent: '#21252B',
			selectionBackground: 'rgba(97,175,239,0.24)',
			selectionInactiveBackground: 'rgba(97,175,239,0.14)',
			black: '#3F4451',
			red: '#E06C75',
			green: '#98C379',
			yellow: '#D18F52',
			blue: '#61AFEF',
			magenta: '#C678DD',
			cyan: '#42B3C2',
			white: '#D7DAE0',
			brightBlack: '#4F5666',
			brightRed: '#FF616E',
			brightGreen: '#A5E075',
			brightYellow: '#F0A45D',
			brightBlue: '#4DC4FF',
			brightMagenta: '#DE73FF',
			brightCyan: '#4CD1E0',
			brightWhite: '#E6E6E6',
		},
	},
	{
		id: 'rosepine',
		label: 'Rose Pine',
		previewBg: '#191724',
		previewFg: '#e0def4',
		chromeBg: '#171522',
		surfaceBg: '#0f0d18',
		border: 'rgba(196, 167, 231, 0.24)',
		accent: '#c4a7e7',
		xtermTheme: {
			background: '#191724',
			foreground: '#e0def4',
			cursor: '#524f67',
			cursorAccent: '#191724',
			selectionBackground: 'rgba(196,167,231,0.22)',
			selectionInactiveBackground: 'rgba(196,167,231,0.12)',
			black: '#26233a',
			red: '#eb6f92',
			green: '#3e8fb0',
			yellow: '#f6c177',
			blue: '#9ccfd8',
			magenta: '#c4a7e7',
			cyan: '#ebbcba',
			white: '#e0def4',
			brightBlack: '#908caa',
			brightRed: '#ff8cab',
			brightGreen: '#9ccfb0',
			brightYellow: '#ffd196',
			brightBlue: '#bee6e0',
			brightMagenta: '#e2c4ff',
			brightCyan: '#ffd1d0',
			brightWhite: '#fffaf3',
		},
	},
];

export const TERMINAL_FONT_FAMILIES: FontFamilyPreset[] = [
	{
		id: 'sfmono',
		label: 'SF Mono',
		stack: 'SFMono-Regular, SF Mono, ui-monospace, Menlo, Monaco, monospace',
		preview: 'abc 012 →|←',
	},
	{
		id: 'jetbrains',
		label: 'JetBrains Mono',
		stack: 'JetBrains Mono, Fira Code, ui-monospace, monospace',
		preview: 'const shell = 42',
	},
	{
		id: 'menlo',
		label: 'Menlo',
		stack: 'Menlo, Monaco, Consolas, ui-monospace, monospace',
		preview: '~/dev $ ls -la',
	},
];

export function clampTerminalFontSize(size: number | null | undefined): number {
	const next = Math.round(Number(size ?? 13));
	return Math.min(Math.max(next, TERMINAL_FONT_SIZE_MIN), TERMINAL_FONT_SIZE_MAX);
}

export function getDefaultWorkspaceSettings(): WorkspaceSettings {
	return {
		appearance: {
			icon: 'terminal',
			color: '',
		},
		terminalDefaults: {
			themeId: 'default-dark',
			fontFamily: 'sfmono',
			fontSize: 13,
		},
	};
}

export function normalizeWorkspaceSettings(input: unknown): WorkspaceSettings {
	const defaults = getDefaultWorkspaceSettings();
	if (!input || typeof input !== 'object') return defaults;

	const candidate = input as {
		appearance?: Partial<WorkspaceSettings['appearance']>;
		terminalDefaults?: Partial<WorkspaceSettings['terminalDefaults']>;
	};
	const appearance = candidate.appearance ?? {};
	const terminalDefaults = candidate.terminalDefaults ?? {};

	return {
		appearance: {
			icon: isWorkspaceIconKey(appearance.icon) ? appearance.icon : defaults.appearance.icon,
			color: isTerminalColorKey(appearance.color) ? appearance.color : defaults.appearance.color,
		},
		terminalDefaults: {
			themeId: isTerminalThemeId(terminalDefaults.themeId) ? terminalDefaults.themeId : defaults.terminalDefaults.themeId,
			fontFamily: isTerminalFontFamilyId(terminalDefaults.fontFamily) ? terminalDefaults.fontFamily : defaults.terminalDefaults.fontFamily,
			fontSize: clampTerminalFontSize(terminalDefaults.fontSize ?? defaults.terminalDefaults.fontSize),
		},
	};
}

export function normalizeSessionAppearance(input: unknown): TerminalSessionAppearance {
	if (!input || typeof input !== 'object') return {};
	const candidate = input as TerminalSessionAppearance;
	return {
		icon: isNullableIconKey(candidate.icon) ? candidate.icon : undefined,
		color: isNullableColorKey(candidate.color) ? candidate.color : undefined,
		themeId: isNullableThemeId(candidate.themeId) ? candidate.themeId : undefined,
		fontFamily: isNullableFontFamilyId(candidate.fontFamily) ? candidate.fontFamily : undefined,
		fontSize: candidate.fontSize == null ? undefined : clampTerminalFontSize(candidate.fontSize),
	};
}

export function resolveTerminalAppearance(
	workspaceSettings?: WorkspaceSettings | null,
	sessionAppearance?: TerminalSessionAppearance | null,
	legacy?: { icon?: TerminalIconKey | string; color?: TerminalColorKey | string }
): EffectiveTerminalAppearance {
	const normalizedWorkspace = normalizeWorkspaceSettings(workspaceSettings);
	const normalizedSession = normalizeSessionAppearance(sessionAppearance);
	return {
		icon: normalizedSession.icon ?? (isTerminalIconKey(legacy?.icon) ? legacy.icon : ''),
		color: normalizedSession.color ?? (isTerminalColorKey(legacy?.color) ? legacy.color : ''),
		themeId: normalizedSession.themeId ?? normalizedWorkspace.terminalDefaults.themeId,
		fontFamily: normalizedSession.fontFamily ?? normalizedWorkspace.terminalDefaults.fontFamily,
		fontSize: normalizedSession.fontSize ?? normalizedWorkspace.terminalDefaults.fontSize,
	};
}

export function getTerminalTheme(themeId: TerminalThemeId): TerminalThemePreset {
	return TERMINAL_THEMES.find((theme) => theme.id === themeId) ?? TERMINAL_THEMES[0];
}

export function getTerminalFontFamily(fontFamily: TerminalFontFamilyId): FontFamilyPreset {
	return TERMINAL_FONT_FAMILIES.find((font) => font.id === fontFamily) ?? TERMINAL_FONT_FAMILIES[0];
}

export function getTerminalColor(color: TerminalColorKey) {
	return TERMINAL_COLORS.find((item) => item.key === color) ?? TERMINAL_COLORS[0];
}

function isTerminalColorKey(value: unknown): value is TerminalColorKey {
	return TERMINAL_COLORS.some((item) => item.key === value);
}

function isNullableColorKey(value: unknown): value is TerminalColorKey | null {
	return value == null || isTerminalColorKey(value);
}

function isTerminalIconKey(value: unknown): value is TerminalIconKey {
	return (
		value === '' ||
		value === 'git' ||
		value === 'node' ||
		value === 'py' ||
		value === 'db' ||
		value === 'dock' ||
		value === 'proc' ||
		value === 'brain' ||
		value === 'code' ||
		value === 'tool'
	);
}

function isNullableIconKey(value: unknown): value is TerminalIconKey | null {
	return value == null || isTerminalIconKey(value);
}

function isTerminalThemeId(value: unknown): value is TerminalThemeId {
	return TERMINAL_THEMES.some((item) => item.id === value);
}

function isNullableThemeId(value: unknown): value is TerminalThemeId | null {
	return value == null || isTerminalThemeId(value);
}

function isTerminalFontFamilyId(value: unknown): value is TerminalFontFamilyId {
	return TERMINAL_FONT_FAMILIES.some((item) => item.id === value);
}

function isNullableFontFamilyId(value: unknown): value is TerminalFontFamilyId | null {
	return value == null || isTerminalFontFamilyId(value);
}

function isWorkspaceIconKey(value: unknown): value is WorkspaceIconKey {
	return value === 'terminal' || value === 'folder' || value === 'grid' || value === 'layers';
}
