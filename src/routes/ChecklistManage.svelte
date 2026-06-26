<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import {
		ChevronDown,
		ClipboardList,
		Cloud,
		Copy,
		DoorOpen,
		Download,
		Pencil,
		Plus,
		RotateCcw,
		Share2,
		Trash2,
		Upload
	} from '@lucide/svelte';
	import { SvelteURL } from 'svelte/reactivity';
	import PageHeader from './PageHeader.svelte';
	import { appState, appStateStorage, connectDriveSync, syncDriveNow } from '$lib/appState.svelte';
	import {
		DIRECT_LINK_PARAM,
		type Checklist,
		countTasks,
		exportPortableChecklist,
		importPortableChecklists,
		uniqueLinkKey
	} from '$lib/checklists';
	import {
		authorizeDrive,
		createPublicDriveJsonFile,
		downloadDriveJsonFile,
		driveFileIdFromUrl,
		hasDriveToken
	} from '$lib/google-drive';
	import { SHARE_IMPORT_PARAM, buildShareImportUrl, decodeShareImportUrl } from '$lib/share-import';

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
	let shareBusyChecklistId = $state('');
	let pendingDriveImportUrl = $state('');
	const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
	const driveControlsDisabled = !googleClientId;

	onMount(() => {
		void importChecklistFromUrl();
	});

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

	async function connectDrive(): Promise<void> {
		importFeedback = '';
		copyFeedback = '';
		try {
			await connectDriveSync(googleClientId);
		} catch (error) {
			importFeedback = error instanceof Error ? error.message : 'Google Drive connection failed.';
		}
	}

	async function syncNow(): Promise<void> {
		importFeedback = '';
		copyFeedback = '';
		try {
			await syncDriveNow(googleClientId);
		} catch (error) {
			importFeedback = error instanceof Error ? error.message : 'Google Drive sync failed.';
		}
	}

	async function shareChecklistTemplate(checklist: Checklist): Promise<void> {
		importFeedback = '';
		copyFeedback = '';
		shareBusyChecklistId = checklist.id;

		try {
			if (!hasDriveToken()) {
				await connectDriveSync(googleClientId);
			}

			const file = await createPublicDriveJsonFile(
				`${filenameSlug(checklist.name)}-checklist-template.json`,
				exportPortableChecklist(checklist)
			);
			const importUrl = buildShareImportUrl(file.publicUrl, window.location.href);
			await navigator.clipboard.writeText(importUrl);
			copyFeedback = `Copied share template link for "${checklist.name}".`;
		} catch (error) {
			importFeedback = error instanceof Error ? error.message : 'Share template failed.';
		} finally {
			shareBusyChecklistId = '';
		}
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

		addImportedChecklist(result.checklist);
	}

	async function importChecklistFromUrl(): Promise<void> {
		const url = new URL(window.location.href);
		const encodedImportUrl = url.searchParams.get(SHARE_IMPORT_PARAM);
		if (!encodedImportUrl) return;

		const decoded = decodeShareImportUrl(encodedImportUrl);
		if (!decoded.ok) {
			importFeedback = decoded.error;
			return;
		}

		pendingDriveImportUrl = '';
		const driveFileId = driveFileIdFromUrl(decoded.url);

		try {
			await importChecklistPayload(await loadSharedChecklistPayload(decoded.url, false));
			clearImportParam();
		} catch (error) {
			if (driveFileId && googleClientId) {
				pendingDriveImportUrl = decoded.url;
				importFeedback = `${importErrorMessage(error)} Try limited Drive import, or download it and use Import.`;
				return;
			}

			importFeedback = importErrorMessage(error);
		}
	}

	async function importPendingDriveTemplate(): Promise<void> {
		if (!pendingDriveImportUrl) return;

		try {
			importFeedback = 'Authorizing Google Drive...';
			await authorizeDrive(googleClientId);
			await importChecklistPayload(await loadSharedChecklistPayload(pendingDriveImportUrl, true));
			pendingDriveImportUrl = '';
			clearImportParam();
		} catch (error) {
			importFeedback = `Limited Drive import failed: ${importErrorMessage(error)} Download the file and use Import.`;
		}
	}

	async function loadSharedChecklistPayload(
		fileUrl: string,
		useDriveApi: boolean
	): Promise<unknown> {
		if (useDriveApi) {
			const driveFileId = driveFileIdFromUrl(fileUrl);
			if (!driveFileId) throw new Error('Import URL is not a supported Google Drive file URL.');
			return downloadDriveJsonFile(driveFileId);
		}

		let response: Response;
		try {
			response = await fetch(fileUrl);
		} catch {
			throw new Error('The browser blocked reading this download URL directly.');
		}

		if (!response.ok) {
			throw new Error(`Import file could not be loaded (${response.status}).`);
		}

		const text = await (await response.blob()).text();
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw new Error(`Downloaded file is not valid JSON${downloadSnippet(text)}.`);
		}
	}

	async function importChecklistPayload(payload: unknown): Promise<void> {
		const result = importPortableChecklists(JSON.stringify(payload));
		if (!result.ok) {
			throw new Error(result.error);
		}

		addImportedChecklist(result.checklist);
	}

	function clearImportParam(): void {
		const url = new URL(window.location.href);
		url.searchParams.delete(SHARE_IMPORT_PARAM);
		window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
	}

	function importErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : 'Import file is unreachable or is not JSON.';
	}

	function downloadSnippet(text: string): string {
		const trimmed = text.trim().replace(/\s+/g, ' ');
		if (!trimmed) return '';

		const snippet = trimmed.slice(0, 80);
		return `; received "${snippet}${trimmed.length > snippet.length ? '...' : ''}"`;
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

	<section
		class="flex flex-col gap-3 rounded-container border border-surface-800 bg-surface-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="min-w-0">
			<h2 class="text-sm font-semibold text-surface-100">Google Drive sync</h2>
			<p class="mt-1 text-sm text-surface-400">
				{#if driveControlsDisabled}
					Set VITE_GOOGLE_CLIENT_ID to enable browser-only Drive sync and share links.
				{:else}
					{appStateStorage.drive.message ||
						'Connect Google Drive to sync app state and share templates.'}
				{/if}
			</p>
		</div>
		<div class="flex flex-wrap gap-2 sm:justify-end">
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				disabled={driveControlsDisabled || appStateStorage.drive.status === 'syncing'}
				onclick={connectDrive}
			>
				<Cloud size={16} aria-hidden="true" />
				{appStateStorage.drive.status === 'connected' ? 'Reconnect' : 'Connect'}
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				type="button"
				disabled={driveControlsDisabled || appStateStorage.drive.status === 'syncing'}
				onclick={syncNow}
			>
				<RotateCcw size={16} aria-hidden="true" />
				Sync now
			</button>
		</div>
	</section>

	{#if importFeedback || copyFeedback}
		<div
			class="rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300"
		>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<span>{importFeedback || copyFeedback}</span>
				{#if pendingDriveImportUrl}
					<button
						class="btn btn-sm preset-filled-primary-500"
						type="button"
						disabled={driveControlsDisabled}
						onclick={importPendingDriveTemplate}
					>
						<Upload size={16} aria-hidden="true" />
						Import shared template
					</button>
				{/if}
			</div>
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
										title="Share template"
										aria-label="Share template"
										disabled={driveControlsDisabled || shareBusyChecklistId === checklist.id}
										onclick={() => shareChecklistTemplate(checklist)}
									>
										<Share2 size={16} aria-hidden="true" />
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
