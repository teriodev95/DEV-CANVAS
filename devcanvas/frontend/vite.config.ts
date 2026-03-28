import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'DevCanvas',
				short_name: 'DevCanvas',
				description: 'Visual terminal workspace — tmux + canvas + realtime',
				start_url: '/',
				display: 'standalone',
				background_color: '#0d0d0f',
				theme_color: '#0d0d0f',
				icons: [
					{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
				],
			},
			workbox: {
				globPatterns: ['client/**/*.{js,css,html,svg,png,woff2}'],
				navigateFallback: '/',
				navigateFallbackDenylist: [/^\/api/, /^\/ws/],
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/fonts\.googleapis\.com/,
						handler: 'StaleWhileRevalidate',
						options: { cacheName: 'google-fonts-stylesheets' },
					},
					{
						urlPattern: /^https:\/\/fonts\.gstatic\.com/,
						handler: 'CacheFirst',
						options: {
							cacheName: 'google-fonts-webfonts',
							expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
						},
					},
				],
			},
			devOptions: {
				enabled: false,
			},
		}),
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
		target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
		// Avoid minification errors in Tauri
		minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
	},
});
