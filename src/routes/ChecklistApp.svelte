<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import ChecklistManage from './ChecklistManage.svelte';
	import ChecklistView from './ChecklistView.svelte';
	import {
		DIRECT_LINK_PARAM,
		type AppState,
		type Checklist,
		createEmptyAppState,
		loadAppState,
		saveAppState
	} from '$lib/checklists';

	type Mode = 'manage' | 'view';

	let appState = $state<AppState>(createEmptyAppState());
	let mode = $state<Mode>('manage');
	let selectedChecklistId = $state<string | null>(null);
	let mounted = false;
	let now = $state(new Date());

	let selectedChecklist = $derived(
		appState.checklists.find((checklist) => checklist.id === selectedChecklistId) ?? null
	);

	onMount(() => {
		appState = loadAppState(localStorage, { allowDevFrequencies: import.meta.env.DEV });
		mounted = true;
		persist();
		enterChecklistFromUrl(true);

		let timer: number | undefined;
		const delayToNextMinute = 60_000 - (Date.now() % 60_000);
		const timeout = window.setTimeout(() => {
			now = new Date();
			timer = window.setInterval(() => {
				now = new Date();
			}, 60_000);
		}, delayToNextMinute);

		const onPopState = () => enterChecklistFromUrl(false);
		window.addEventListener('popstate', onPopState);

		return () => {
			window.clearTimeout(timeout);
			if (timer !== undefined) window.clearInterval(timer);
			window.removeEventListener('popstate', onPopState);
		};
	});

	function persist(): void {
		if (mounted) saveAppState(localStorage, appState);
	}

	function enterChecklistFromUrl(replaceHistory: boolean): void {
		const checklistId = checklistIdFromSearch(window.location.search, appState.checklists);
		const checklist = appState.checklists.find((item) => item.id === checklistId);

		if (checklist) {
			enterChecklist(checklist, false);
			if (replaceHistory) updateChecklistQuery(directLinkValue(checklist), true);
			return;
		}

		mode = 'manage';
		selectedChecklistId = null;
		const params = new URLSearchParams(window.location.search);
		if (params.has(DIRECT_LINK_PARAM) && replaceHistory) {
			updateChecklistQuery(null, true);
		}
	}

	function updateChecklistQuery(checklistValue: string | null, replace = false): void {
		if (!mounted) return;

		const url = new URL(window.location.href);
		url.pathname = '/';
		if (checklistValue) {
			url.searchParams.set(DIRECT_LINK_PARAM, checklistValue);
		} else {
			url.searchParams.delete(DIRECT_LINK_PARAM);
		}

		const method = replace ? 'replaceState' : 'pushState';
		window.history[method]({}, '', url);
	}

	function updateManagePath(replace = false): void {
		if (!mounted) return;

		const url = new URL(window.location.href);
		url.pathname = '/';
		url.search = '';

		const method = replace ? 'replaceState' : 'pushState';
		window.history[method]({}, '', url);
	}

	function checklistIdFromSearch(search: string, checklists: Checklist[]): string | null {
		const params = new URLSearchParams(search);
		const directValue = params.get(DIRECT_LINK_PARAM);
		if (!directValue) return null;

		const directValueLower = directValue.toLowerCase();
		const checklist = checklists.find(
			(item) => item.id === directValue || item.linkKey?.toLowerCase() === directValueLower
		);
		return checklist?.id ?? null;
	}

	function directLinkValue(checklist: Checklist): string {
		return checklist.linkKey || checklist.id;
	}

	function enterChecklist(checklist: Checklist, updateUrl = true): void {
		selectedChecklistId = checklist.id;
		mode = 'view';
		now = new Date();
		if (updateUrl) updateChecklistQuery(directLinkValue(checklist));
	}

	function backToManage(): void {
		mode = 'manage';
		selectedChecklistId = null;
		now = new Date();
		updateManagePath();
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
	{#if mode === 'manage'}
		<ChecklistManage bind:appState onPersist={persist} onEnterChecklist={enterChecklist} />
	{:else if selectedChecklist}
		<ChecklistView
			bind:appState
			checklist={selectedChecklist}
			bind:now
			onBack={backToManage}
			onPersist={persist}
		/>
	{:else}
		<section class="mx-auto max-w-3xl px-4 py-10">
			<button class="btn preset-tonal-surface mb-4" type="button" onclick={backToManage}>
				<ArrowLeft size={18} aria-hidden="true" />
				Back to Manage
			</button>
			<div
				class="rounded-container border border-surface-800 bg-surface-900 p-8 text-center shadow-sm"
			>
				<h1 class="text-2xl font-semibold text-surface-50">Checklist not found</h1>
				<p class="mt-2 text-sm text-surface-400">
					Return to manage mode and choose an available checklist.
				</p>
			</div>
		</section>
	{/if}
</main>
