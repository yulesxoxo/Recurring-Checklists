<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		ClipboardList,
		Copy,
		DoorOpen,
		Download,
		Pencil,
		Plus,
		RotateCcw,
		Trash2,
		Upload
	} from '@lucide/svelte';
	import {
		DIRECT_LINK_PARAM,
		type AppState,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type Frequency,
		countTasks,
		exportPortableChecklist,
		importPortableChecklists,
		linkKeyConflict,
		normalizeSchedule
	} from '$lib/checklists';
	import { alignDateToWeekday, todayUtc } from '$lib/date-time';
	import { createId } from '$lib/id';

	let {
		appState = $bindable<AppState>(),
		onPersist,
		onEnterChecklist
	}: {
		appState: AppState;
		onEnterChecklist: (checklist: Checklist) => void;
		onPersist: () => void;
	} = $props();

	let importInput = $state<HTMLInputElement>();
	let importFeedback = $state('');
	let copyFeedback = $state('');

	function checklistUrl(checklist: Checklist): string {
		const url = new URL(window.location.href);
		url.pathname = '/';
		url.searchParams.set(DIRECT_LINK_PARAM, checklist.linkKey || checklist.id);

		const search = url.searchParams.toString();
		return `${url.origin}?${search}`;
	}

	async function copyChecklistLink(checklist: Checklist): Promise<void> {
		copyFeedback = '';
		await navigator.clipboard.writeText(checklistUrl(checklist));
		copyFeedback = `Copied link for "${checklist.name}".`;
	}

	function exportDefinition(checklist: Checklist): void {
		importFeedback = '';
		const portable = exportPortableChecklist(checklist);
		const blob = new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${filenameSlug(checklist.name)}-checklist.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	function openImportPicker(): void {
		importInput?.click();
	}

	async function importDefinitions(event: Event): Promise<void> {
		importFeedback = '';
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const result = importPortableChecklists(await file.text());

		if (!result.ok) {
			importFeedback = result.error;
			return;
		}

		const conflict = linkKeyConflict(appState.checklists, result.checklist.linkKey);
		if (conflict) {
			importFeedback = `Imported checklist link key is already used by "${conflict.name}".`;
			return;
		}

		appState.checklists = [...appState.checklists, result.checklist];
		importFeedback = `Imported "${result.checklist.name}".`;
		onPersist();
	}

	function createChecklist(): void {
		void goto('/create');
	}

	function editChecklist(checklist: Checklist): void {
		void goto(`/create?edit=${encodeURIComponent(checklist.id)}`);
	}

	function deleteChecklist(checklist: Checklist): void {
		if (
			!window.confirm(`Delete "${checklist.name}"? Completion history for it will also be removed.`)
		) {
			return;
		}

		appState.checklists = appState.checklists.filter((item) => item.id !== checklist.id);
		delete appState.completions[checklist.id];
		onPersist();
	}

	function addStarterTemplate(): void {
		const checklist: Checklist = {
			id: createId(),
			name: 'NTE Recurring Checklist',
			description: 'Daily, weekly, and bi-weekly operating checks with UTC reset windows.',
			linkKey: 'NTE',
			sections: [
				{
					...createSection('Daily', 'daily'),
					tasks: [
						createTask('Review open exceptions'),
						createTask('Confirm required reports were generated'),
						createTask('Record follow-ups for blocked items')
					]
				},
				{
					...createSection('Weekly', 'weekly'),
					tasks: [
						createTask('Audit recurring checklist coverage'),
						createTask('Review aged unresolved items'),
						createTask('Update weekly summary')
					]
				},
				{
					...createSection('Bi-Weekly', 'biweekly'),
					tasks: [
						createTask('Review process drift'),
						createTask('Refresh escalation owners'),
						createTask('Validate bi-weekly reporting inputs')
					]
				}
			]
		};

		const conflict = linkKeyConflict(appState.checklists, checklist.linkKey);
		if (conflict) {
			importFeedback = `The starter template link key is already used by "${conflict.name}".`;
			return;
		}

		appState.checklists = [...appState.checklists, checklist];
		onPersist();
	}

	function createSection(name: string, frequency: Frequency): ChecklistSection {
		const resetWeekday = frequency === 'weekly' || frequency === 'biweekly' ? 'monday' : undefined;

		return {
			id: createId(),
			name,
			schedule: normalizeSchedule(
				{
					frequency,
					resetWeekday,
					anchorDateTimeUtc:
						frequency === 'biweekly'
							? `${alignDateToWeekday(todayUtc(), resetWeekday ?? 'monday')}T05:00:00.000Z`
							: `${todayUtc()}T05:00:00.000Z`
				},
				{}
			) ?? {
				frequency: 'daily',
				anchorDateTimeUtc: `${todayUtc()}T05:00:00.000Z`
			},
			tasks: [createTask('New task')]
		};
	}

	function createTask(title: string): ChecklistTask {
		return {
			id: createId(),
			title,
			notes: ''
		};
	}

	function filenameSlug(value: string): string {
		return (
			value
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '') || 'checklist'
		);
	}
</script>

<section class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
	<header
		class="flex flex-col gap-4 border-b border-surface-800 pb-5 md:flex-row md:items-end md:justify-between"
	>
		<div class="min-w-0">
			<div class="mb-2 flex items-center gap-2 text-sm font-medium text-surface-400">
				<ClipboardList size={18} aria-hidden="true" />
				<span>{appState.checklists.length} checklists</span>
			</div>
			<h1 class="text-3xl font-semibold tracking-normal text-surface-50">Manage Checklists</h1>
		</div>
		<div class="flex flex-col gap-2 sm:flex-row">
			<input
				bind:this={importInput}
				class="hidden"
				type="file"
				accept="application/json,.json"
				onchange={importDefinitions}
			/>
			<button class="btn preset-tonal-surface" type="button" onclick={openImportPicker}>
				<Upload size={18} aria-hidden="true" />
				Import
			</button>
			<button class="btn preset-tonal-surface" type="button" onclick={addStarterTemplate}>
				<RotateCcw size={18} aria-hidden="true" />
				NTE Template
			</button>
			<button class="btn preset-filled-primary-500" type="button" onclick={createChecklist}>
				<Plus size={18} aria-hidden="true" />
				Create new Checklist
			</button>
		</div>
	</header>

	{#if importFeedback || copyFeedback}
		<p
			class="rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300"
		>
			{importFeedback || copyFeedback}
		</p>
	{/if}

	<div class="flex flex-col gap-6">
		<section class="min-w-0">
			{#if appState.checklists.length === 0}
				<div
					class="rounded-container border border-dashed border-surface-700 bg-surface-900 p-8 text-center shadow-sm"
				>
					<ClipboardList class="mx-auto mb-4 text-surface-400" size={36} aria-hidden="true" />
					<h2 class="text-xl font-semibold text-surface-50">No checklists yet</h2>
					<p class="mx-auto mt-2 max-w-xl text-sm text-surface-400">
						Create a checklist from scratch or add the NTE template to start with daily, weekly, and
						bi-weekly reset sections.
					</p>
				</div>
			{:else}
				<div
					class="overflow-hidden rounded-container border border-surface-800 bg-surface-900 shadow-sm"
				>
					<div
						class="hidden grid-cols-[minmax(220px,1fr)_120px_100px_260px] gap-4 border-b border-surface-800 bg-surface-800 px-4 py-3 text-xs font-semibold uppercase text-surface-300 md:grid"
					>
						<span>Checklist</span>
						<span>Sections</span>
						<span>Tasks</span>
						<span class="text-right">Actions</span>
					</div>
					<div class="divide-y divide-surface-800">
						{#each appState.checklists as checklist (checklist.id)}
							<article
								class="grid gap-3 px-4 py-4 md:grid-cols-[minmax(220px,1fr)_120px_100px_260px] md:items-center"
							>
								<div class="min-w-0">
									<h2 class="truncate text-base font-semibold text-surface-50">
										{checklist.name}
									</h2>
									<p class="mt-1 line-clamp-2 text-sm text-surface-400">
										{checklist.description || 'No description'}
									</p>
								</div>
								<div>
									<span class="badge preset-tonal-primary"
										>{checklist.sections.length} sections</span
									>
								</div>
								<div>
									<span class="badge preset-tonal-surface">{countTasks(checklist)} tasks</span>
								</div>
								<div class="flex justify-start gap-2 md:justify-end">
									<button
										class="btn btn-sm preset-filled-primary-500"
										type="button"
										onclick={() => onEnterChecklist(checklist)}
									>
										<DoorOpen size={16} aria-hidden="true" />
										Enter
									</button>
									<button
										class="btn-icon btn-icon-sm preset-tonal-surface"
										type="button"
										title="Copy direct link"
										aria-label="Copy direct link"
										onclick={() => copyChecklistLink(checklist)}
									>
										<Copy size={16} aria-hidden="true" />
									</button>
									<button
										class="btn-icon btn-icon-sm preset-tonal-surface"
										type="button"
										title="Export checklist"
										aria-label="Export checklist"
										onclick={() => exportDefinition(checklist)}
									>
										<Download size={16} aria-hidden="true" />
									</button>
									<button
										class="btn-icon btn-icon-sm preset-tonal-surface"
										type="button"
										title="Edit checklist"
										aria-label="Edit checklist"
										onclick={() => editChecklist(checklist)}
									>
										<Pencil size={16} aria-hidden="true" />
									</button>
									<button
										class="btn-icon btn-icon-sm preset-tonal-error"
										type="button"
										title="Delete checklist"
										aria-label="Delete checklist"
										onclick={() => deleteChecklist(checklist)}
									>
										<Trash2 size={16} aria-hidden="true" />
									</button>
								</div>
							</article>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	</div>
</section>
