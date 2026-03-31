<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		if ('serviceWorker' in navigator) {
			void navigator.serviceWorker.getRegistrations().then((registrations) =>
				Promise.all(registrations.map((registration) => registration.unregister()))
			);
		}

		if ('caches' in window) {
			void caches.keys().then((keys) =>
				Promise.all(keys.map((key) => caches.delete(key)))
			);
		}
	});
</script>

<svelte:head>
	<title>DevCanvas</title>
	<meta name="description" content="Visual terminal workspace" />
</svelte:head>

{@render children()}
