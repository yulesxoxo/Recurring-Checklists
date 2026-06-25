<script lang="ts">
	import { onMount } from 'svelte';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import ChecklistManage from './ChecklistManage.svelte';
	import { type AppState, createEmptyAppState, loadAppState, saveAppState } from '$lib/checklists';

	let appState = $state<AppState>(createEmptyAppState());
	let mounted = $state(false);

	onMount(() => {
		appState = loadAppState(localStorage);
		mounted = true;
		persist();
	});

	function persist(): void {
		if (mounted) saveAppState(localStorage, appState);
	}
</script>

<svelte:head>
	<title>Recurring Checklists</title>
	<meta
		name="description"
		content="Client-side recurring checklists with local completion state and UTC reset windows."
	/>
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	{#if !mounted}
		<section class="flex min-h-screen items-center justify-center px-4 py-10">
			<Progress class="w-fit" value={null} aria-label="Loading checklists">
				<Progress.Circle class="[--size:--spacing(16)]">
					<Progress.CircleTrack />
					<Progress.CircleRange />
				</Progress.Circle>
			</Progress>
		</section>
	{:else}
		<ChecklistManage bind:appState onPersist={persist} />
	{/if}
</main>
