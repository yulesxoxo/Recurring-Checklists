<script lang="ts">
	import { onMount } from 'svelte';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import { AlertTriangle } from '@lucide/svelte';
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
		{#if appStateStorage.hasOtherOpenTabs}
			<div class="border-b border-warning-700 bg-warning-950 px-4 py-3 text-warning-50">
				<div class="mx-auto flex max-w-5xl gap-3 text-sm sm:px-2">
					<AlertTriangle class="mt-0.5 shrink-0" size={18} aria-hidden="true" />
					<p>
						This checklist app is already open in another tab. Keeping multiple tabs open can cause
						older local state to overwrite newer changes.
					</p>
				</div>
			</div>
		{/if}
		<ChecklistManage />
	{/if}
</main>
