<script lang="ts">
	import { onMount } from 'svelte';
	import PageHeader from '../PageHeader.svelte';
	import ChecklistEditor from './ChecklistEditor.svelte';

	let editChecklistId = $state<string | null>(null);
	let pageTitle = $derived(editChecklistId ? 'Edit Checklist' : 'Create Checklist');

	onMount(() => {
		editChecklistId = new URLSearchParams(window.location.search).get('edit');
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content="Create or edit a recurring checklist." />
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
		<PageHeader title={pageTitle} description="Set up sections, tasks, and reset windows." />

		<ChecklistEditor />
	</section>
</main>
