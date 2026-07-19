<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import {
		ChevronDown,
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
	import { SvelteURL } from 'svelte/reactivity';
	import PageHeader from './PageHeader.svelte';
	import { appState } from '$lib/appState.svelte';
	import {
		DIRECT_LINK_PARAM,
		type Checklist,
		countTasks,
		exportPortableChecklist,
		formatPortableChecklistExport,
		importPortableChecklists,
		uniqueLinkKey
	} from '$lib/checklists';

	type TemplateModule = { default: unknown };
	type ChecklistTemplate = {
		id: string;
		name: string;
		source: unknown;
	};

	const templateModules = import.meta.glob('../lib/checklists/templates/*.json', {
		eager: true
	}) as Record<string, TemplateModule>;
	const checklistTemplates: ChecklistTemplate[] = Object.entries(templateModules)
		.map(([path, module]) => ({
			id: path,
			name: templateName(module.default, path),
			source: module.default
		}))
		.sort((left, right) => left.name.localeCompare(right.name));

	let importInput = $state<HTMLInputElement>();
	let importFeedback = $state('');
	let copyFeedback = $state('');

	function checklistUrl(checklist: Checklist): string {
		const url = new SvelteURL(window.location.href);
		url.pathname = '/view/';
		url.search = '';
		url.searchParams.set(DIRECT_LINK_PARAM, checklist.linkKey || checklist.id);

		const search = url.searchParams.toString();
		return `${url.origin}${url.pathname}?${search}`;
	}

	async function copyChecklistLink(checklist: Checklist): Promise<void> {
		copyFeedback = '';
		await navigator.clipboard.writeText(checklistUrl(checklist));
		copyFeedback = `Copied link for "${checklist.name}".`;
	}

	function exportDefinition(checklist: Checklist): void {
		importFeedback = '';
		const portable = exportPortableChecklist(checklist);
		const blob = new Blob([formatPortableChecklistExport(portable)], { type: 'application/json' });
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

		addImportedChecklist(result.checklist);
	}

	function createChecklist(): void {
		void goto(resolve('/create'));
	}

	function editChecklist(checklist: Checklist): void {
		void goto(resolve(`/create?edit=${encodeURIComponent(checklist.id)}`));
	}

	function openChecklist(checklist: Checklist): void {
		void goto(
			resolve(
				`/view/?${DIRECT_LINK_PARAM}=${encodeURIComponent(checklist.linkKey || checklist.id)}`
			)
		);
	}

	function deleteChecklist(checklist: Checklist): void {
		if (
			!window.confirm(`Delete "${checklist.name}"? Completion history for it will also be removed.`)
		) {
			return;
		}

		appState.checklists = appState.checklists.filter((item) => item.id !== checklist.id);
		delete appState.completions[checklist.id];
	}

	function addTemplateById(templateId: string): void {
		importFeedback = '';
		copyFeedback = '';
		const template = checklistTemplates.find((item) => item.id === templateId);
		if (!template) return;

		const result = importPortableChecklists(JSON.stringify(template.source));
		if (!result.ok) {
			importFeedback = result.error;
			return;
		}

		addImportedChecklist(result.checklist, 'Added');
	}

	function addSelectedTemplate(details: { value: string }): void {
		addTemplateById(details.value);
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

	function addImportedChecklist(checklist: Checklist, verb = 'Imported'): void {
		const originalLinkKey = checklist.linkKey;
		const nextChecklist = {
			...checklist,
			linkKey: uniqueImportedLinkKey(checklist)
		};

		appState.checklists = [...appState.checklists, nextChecklist];
		importFeedback =
			originalLinkKey && originalLinkKey !== nextChecklist.linkKey
				? `${verb} "${nextChecklist.name}" with link key "${nextChecklist.linkKey}".`
				: `${verb} "${nextChecklist.name}".`;
	}

	function uniqueImportedLinkKey(checklist: Checklist): string | undefined {
		return (
			uniqueLinkKey(appState.checklists, checklist.linkKey) ??
			uniqueLinkKey(appState.checklists, filenameSlug(checklist.name)) ??
			crypto.randomUUID().slice(0, 8)
		);
	}

	function templateName(source: unknown, path: string): string {
		if (
			typeof source === 'object' &&
			source !== null &&
			'checklist' in source &&
			typeof source.checklist === 'object' &&
			source.checklist !== null &&
			'name' in source.checklist &&
			typeof source.checklist.name === 'string'
		) {
			return source.checklist.name;
		}

		return (
			path
				.split('/')
				.pop()
				?.replace(/\.json$/i, '') ?? 'Template'
		);
	}
</script>

{#snippet headerActions()}
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
		<Menu onSelect={addSelectedTemplate} positioning={{ placement: 'bottom-end' }}>
			<Menu.Trigger
				class="btn preset-tonal-surface"
				type="button"
				disabled={checklistTemplates.length === 0}
			>
				<RotateCcw size={18} aria-hidden="true" />
				Add Template
				<ChevronDown size={16} aria-hidden="true" />
			</Menu.Trigger>
			<Portal>
				<Menu.Positioner>
					<Menu.Content class="min-w-56">
						<Menu.ItemGroup>
							<Menu.ItemGroupLabel>Templates</Menu.ItemGroupLabel>
							{#each checklistTemplates as template (template.id)}
								<Menu.Item value={template.id}>
									<Menu.ItemText>{template.name}</Menu.ItemText>
								</Menu.Item>
							{/each}
						</Menu.ItemGroup>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
		<button class="btn preset-filled-primary-500" type="button" onclick={createChecklist}>
			<Plus size={18} aria-hidden="true" />
			Create new Checklist
		</button>
	</div>
{/snippet}

<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
	<PageHeader
		title="Manage Checklists"
		description="Create, import, export, and open recurring checklists."
		showBack={false}
		trail={headerActions}
	/>

	{#if importFeedback || copyFeedback}
		<div
			class="rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300"
		>
			<span>{importFeedback || copyFeedback}</span>
		</div>
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
						Create a checklist from scratch or add a template to start with a predefined structure.
					</p>
				</div>
			{:else}
				<div
					class="overflow-hidden rounded-container border border-surface-800 bg-surface-900 shadow-sm"
				>
					<div
						class="hidden grid-cols-[minmax(220px,1fr)_120px_100px_310px] gap-4 border-b border-surface-800 bg-surface-800 px-4 py-3 text-xs font-semibold uppercase text-surface-300 md:grid"
					>
						<span>Checklist</span>
						<span>Sections</span>
						<span>Tasks</span>
						<span class="text-right">Actions</span>
					</div>
					<div class="divide-y divide-surface-800">
						{#each appState.checklists as checklist (checklist.id)}
							<article
								class="grid gap-3 px-4 py-4 md:grid-cols-[minmax(220px,1fr)_120px_100px_310px] md:items-center"
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
										onclick={() => openChecklist(checklist)}
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
