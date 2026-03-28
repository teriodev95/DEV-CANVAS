import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

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
				// Cache app shell; skip API and WS endpoints
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
				enabled: false, // disable SW in dev to avoid caching issues
			},
		}),
	],
});
