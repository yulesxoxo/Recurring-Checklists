<script lang="ts">
	import { browser } from '$app/environment';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	if (browser) {
		console.info(`Build time: ${__BUILD_TIME__}`);
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
