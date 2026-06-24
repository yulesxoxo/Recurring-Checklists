<script lang="ts">
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
		type AppState,
		type Checklist,
		countTasks
	} from '$lib/checklists';

	let {
		appState,
		importInput = $bindable<HTMLInputElement | undefined>(),
		importFeedback,
		copyFeedback,
		onImportDefinitions,
		onOpenImportPicker,
		onAddStarterTemplate,
		onCreateChecklist,
		onEnterChecklist,
		onCopyChecklistLink,
		onExportDefinition,
		onEditChecklist,
		onDeleteChecklist
	}: {
		appState: AppState;
		importInput: HTMLInputElement | undefined;
		importFeedback: string;
		copyFeedback: string;
		onImportDefinitions: (event: Event) => Promise<void>;
		onOpenImportPicker: () => void;
		onAddStarterTemplate: () => void;
		onCreateChecklist: () => void;
		onEnterChecklist: (checklist: Checklist) => void;
		onCopyChecklistLink: (checklist: Checklist) => Promise<void>;
		onExportDefinition: (checklist: Checklist) => void;
		onEditChecklist: (checklist: Checklist) => void;
		onDeleteChecklist: (checklist: Checklist) => void;
	} = $props();
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
				onchange={onImportDefinitions}
			/>
			<button class="btn preset-tonal-surface" type="button" onclick={onOpenImportPicker}>
				<Upload size={18} aria-hidden="true" />
				Import
			</button>
			<button class="btn preset-tonal-surface" type="button" onclick={onAddStarterTemplate}>
				<RotateCcw size={18} aria-hidden="true" />
				NTE Template
			</button>
			<button class="btn preset-filled-primary-500" type="button" onclick={onCreateChecklist}>
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
										onclick={() => onCopyChecklistLink(checklist)}
									>
										<Copy size={16} aria-hidden="true" />
									</button>
									<button
										class="btn-icon btn-icon-sm preset-tonal-surface"
										type="button"
										title="Export checklist"
										aria-label="Export checklist"
										onclick={() => onExportDefinition(checklist)}
									>
										<Download size={16} aria-hidden="true" />
									</button>
									<button
										class="btn-icon btn-icon-sm preset-tonal-surface"
										type="button"
										title="Edit checklist"
										aria-label="Edit checklist"
										onclick={() => onEditChecklist(checklist)}
									>
										<Pencil size={16} aria-hidden="true" />
									</button>
									<button
										class="btn-icon btn-icon-sm preset-tonal-error"
										type="button"
										title="Delete checklist"
										aria-label="Delete checklist"
										onclick={() => onDeleteChecklist(checklist)}
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
