<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ArrowLeft } from '@lucide/svelte';
	import ChecklistEditor from './ChecklistEditor.svelte';

	let editChecklistId = $derived(page.url.searchParams.get('edit'));
	let pageTitle = $derived(editChecklistId ? 'Edit Checklist' : 'Create Checklist');

	function cancelEditing(): void {
		void goto('/');
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content="Create or edit a recurring checklist." />
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
		<header
			class="flex flex-col gap-4 border-b border-surface-800 pb-5 md:flex-row md:items-center md:justify-between"
		>
			<div class="min-w-0">
				<h1 class="text-3xl font-semibold tracking-normal text-surface-50">{pageTitle}</h1>
				<p class="mt-1 text-sm text-surface-400">Set up sections, tasks, and reset windows.</p>
			</div>
			<button
				class="btn preset-tonal-surface self-start md:self-auto"
				type="button"
				onclick={cancelEditing}
			>
				<ArrowLeft size={18} aria-hidden="true" />
				Back to Manage
			</button>
		</header>

		<ChecklistEditor />
	</section>
</main>
