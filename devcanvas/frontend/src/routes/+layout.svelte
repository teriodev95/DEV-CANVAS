<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>DevCanvas</title>
	<meta name="description" content="Visual terminal workspace" />
</svelte:head>

{@render children()}
