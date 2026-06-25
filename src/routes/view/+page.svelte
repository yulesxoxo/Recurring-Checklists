<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import ChecklistNotFound from '../ChecklistNotFound.svelte';
	import ChecklistView from '../ChecklistView.svelte';
	import PageHeader from '../PageHeader.svelte';
	import {
		DIRECT_LINK_PARAM,
		type AppState,
		type Checklist,
		createEmptyAppState,
		loadAppState,
		saveAppState
	} from '$lib/checklists';

	let appState = $state<AppState>(createEmptyAppState());
	let mounted = $state(false);
	let now = $state(new Date());
	let link = $derived(page.url.searchParams.get(DIRECT_LINK_PARAM));
	let checklist = $derived(findChecklist(link, appState.checklists));
	let pageTitle = $derived(checklist?.name ?? 'Checklist not found');
	let pageDescription = $derived(checklist?.description || 'No description');

	onMount(() => {
		appState = loadAppState(localStorage);
		mounted = true;

		let timer: number | undefined;
		const delayToNextMinute = 60_000 - (Date.now() % 60_000);
		const timeout = window.setTimeout(() => {
			now = new Date();
			timer = window.setInterval(() => {
				now = new Date();
			}, 60_000);
		}, delayToNextMinute);

		return () => {
			window.clearTimeout(timeout);
			if (timer !== undefined) window.clearInterval(timer);
		};
	});

	function persist(): void {
		if (mounted) saveAppState(localStorage, appState);
	}

	function findChecklist(value: string | null, checklists: Checklist[]): Checklist | null {
		if (!value) return null;

		const valueLower = value.toLowerCase();
		return (
			checklists.find((item) => item.id === value || item.linkKey?.toLowerCase() === valueLower) ??
			null
		);
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content="View a recurring checklist." />
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
		{#if !mounted}
			<div class="flex min-h-80 items-center justify-center">
				<Progress class="w-fit" value={null} aria-label="Loading checklist">
					<Progress.Circle class="[--size:--spacing(16)]">
						<Progress.CircleTrack />
						<Progress.CircleRange />
					</Progress.Circle>
				</Progress>
			</div>
		{:else}
			<PageHeader title={pageTitle} description={pageDescription} />
			{#if checklist}
				<ChecklistView bind:appState {checklist} bind:now onPersist={persist} />
			{:else}
				<ChecklistNotFound />
			{/if}
		{/if}
	</section>
</main>
