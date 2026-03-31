<script lang="ts">
	import { useSvelteFlow } from '@xyflow/svelte';
	import type { Viewport } from '@xyflow/system';

	const VISIBILITY_MARGIN_PX = 84;
	const CENTER_DURATION_MS = 170;
	const FIT_PADDING = 0.16;
	const LOAD_DURATION_MS = 0;

	const { getNode, getNodesBounds, getViewport, setCenter, setViewport, fitView } = useSvelteFlow();

	function getVisibleFlowRect() {
		const viewport = getViewport();
		const zoom = viewport.zoom || 1;
		const margin = VISIBILITY_MARGIN_PX / zoom;

		return {
			left: -viewport.x / zoom + margin,
			top: -viewport.y / zoom + margin,
			right: (-viewport.x + window.innerWidth) / zoom - margin,
			bottom: (-viewport.y + window.innerHeight) / zoom - margin,
		};
	}

	function isComfortablyVisible(nodeId: string) {
		if (typeof window === 'undefined' || !getNode(nodeId)) return false;

		const bounds = getNodesBounds([nodeId]);
		const visible = getVisibleFlowRect();

		return (
			bounds.x >= visible.left &&
			bounds.y >= visible.top &&
			bounds.x + bounds.width <= visible.right &&
			bounds.y + bounds.height <= visible.bottom
		);
	}

	export async function focusNode(nodeId: string) {
		const node = getNode(nodeId);
		if (!node) return false;
		if (isComfortablyVisible(nodeId)) return true;

		const bounds = getNodesBounds([nodeId]);
		const viewport = getViewport();

		return setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
			zoom: viewport.zoom,
			duration: CENTER_DURATION_MS,
		});
	}

	export function readViewport(): Viewport {
		return getViewport();
	}

	export async function restoreViewport(viewport: Viewport) {
		return setViewport(viewport, { duration: LOAD_DURATION_MS });
	}

	export async function fitToContent() {
		return fitView({
			padding: FIT_PADDING,
			duration: LOAD_DURATION_MS,
			maxZoom: 1.2,
		});
	}
</script>
