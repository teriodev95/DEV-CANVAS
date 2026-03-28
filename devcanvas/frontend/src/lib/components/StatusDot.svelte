<script lang="ts">
	type Props = {
		status?: 'active' | 'idle' | 'dead' | 'connecting';
		size?: 'sm' | 'md';
	};

	let { status = 'idle', size = 'sm' }: Props = $props();

	const colors: Record<string, string> = {
		active: '#3dd68c',
		idle: '#6b6b80',
		dead: '#ff5555',
		connecting: '#f1c40f',
	};

	const sizes: Record<string, string> = {
		sm: '6px',
		md: '8px',
	};

	const color = $derived(colors[status] ?? colors.idle);
	const dotSize = $derived(sizes[size] ?? sizes.sm);
</script>

<span
	class="status-dot"
	class:pulse={status === 'active' || status === 'connecting'}
	style="
		width: {dotSize};
		height: {dotSize};
		background: {color};
		border-radius: 50%;
		display: inline-block;
		flex-shrink: 0;
	"
	aria-label="Status: {status}"
></span>
