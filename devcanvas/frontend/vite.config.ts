import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');
	const host = env.TAURI_DEV_HOST;
	const target = env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13';
	const tauriDebug = Boolean(env.TAURI_ENV_DEBUG);

	return {
	plugins: [
		tailwindcss(),
		sveltekit(),
	],
	// Tauri dev server config: bind to TAURI_DEV_HOST if set, strict port
	server: {
		port: 5173,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 5183,
				}
			: undefined,
	},
	// Prevent Vite from obscuring Rust errors in production
	clearScreen: false,
	// Enable environment variables in import.meta.env
	envPrefix: ['VITE_', 'TAURI_ENV_*'],
	build: {
		// Tauri supports es2021
		target,
		// Avoid minification errors in Tauri
		minify: !tauriDebug ? 'esbuild' : false,
		sourcemap: tauriDebug,
	},
	};
});
