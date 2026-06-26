<script lang="ts">
	import { onMount } from 'svelte';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import ChecklistManage from './ChecklistManage.svelte';
	import { appStateStorage, initializeAppState } from '$lib/appState.svelte';

	onMount(() => {
		void initializeAppState();
	});
</script>

<svelte:head>
	<title>Recurring Checklists</title>
	<meta
		name="description"
		content="Client-side recurring checklists with local completion state and UTC reset windows."
	/>
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	{#if !appStateStorage.initialized}
		<section class="flex min-h-screen items-center justify-center px-4 py-10">
			<Progress class="w-fit" value={null} aria-label="Loading checklists">
				<Progress.Circle class="[--size:--spacing(16)]">
					<Progress.CircleTrack />
					<Progress.CircleRange />
				</Progress.Circle>
			</Progress>
		</section>
	{:else}
		<ChecklistManage />
	{/if}
</main>
