<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import ChecklistManage from './ChecklistManage.svelte';
	import ChecklistView from './ChecklistView.svelte';
	import {
		DIRECT_LINK_PARAM,
		alignDateToWeekday,
		allFrequencies,
		createEmptyAppState,
		exportPortableChecklist,
		getResetWindowStart,
		importPortableChecklists,
		insertArrayItem,
		linkKeyConflict,
		loadAppState,
		moveArrayItem,
		normalizeLinkKey,
		normalizeSchedule,
		saveAppState,
		scheduleInputTimeToUtc,
		todayUtc
	} from '$lib/checklists';

	type Mode = 'manage' | 'view';

	const frequencies = allFrequencies;

	let appState = $state<AppState>(createEmptyAppState());
	let mode = $state<Mode>('manage');
	let selectedChecklistId = $state<string | null>(null);
	let editingChecklist = $state<Checklist | null>(null);
	let openSectionIds = $state<string[]>([]);
	let editingErrors = $state<{ linkKey?: string }>({});
	let importInput = $state<HTMLInputElement>();
	let importFeedback = $state('');
	let copyFeedback = $state('');
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
		editingChecklist = null;
		openSectionIds = [];
		editingErrors = {};
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

	function checklistUrl(checklist: Checklist): string {
		const url = new URL(window.location.href);
		url.pathname = '/';
		url.searchParams.set(DIRECT_LINK_PARAM, directLinkValue(checklist));

		const search = url.searchParams.toString();
		return `${url.origin}?${search}`;
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

		const result = importPortableChecklists(await file.text(), {
			allowDevFrequencies: import.meta.env.DEV
		});

		if (!result.ok) {
			importFeedback = result.error;
			return;
		}

		const conflict = linkKeyConflict(appState.checklists, result.checklist.linkKey);
		if (conflict) {
			setEditingChecklist(result.checklist);
			editingErrors = {
				linkKey: `This link key is already used by "${conflict.name}".`
			};
			importFeedback = 'Imported checklist needs a unique link key before it can be saved.';
			return;
		}

		appState.checklists = [...appState.checklists, result.checklist];
		importFeedback = `Imported "${result.checklist.name}".`;
		persist();
	}

	function createChecklist(): void {
		void goto('/create');
	}

	function editChecklist(checklist: Checklist): void {
		editingErrors = {};
		setEditingChecklist(cloneChecklist(checklist));
	}

	function saveChecklist(): void {
		if (!editingChecklist) return;

		const linkKey = normalizeLinkKey(editingChecklist.linkKey);
		const conflict = linkKeyConflict(appState.checklists, linkKey, editingChecklist.id);
		if (conflict) {
			editingErrors = {
				linkKey: `This link key is already used by "${conflict.name}".`
			};
			return;
		}

		const checklist: Checklist = {
			...cloneChecklist(editingChecklist),
			name: editingChecklist.name.trim() || 'Untitled checklist',
			description: editingChecklist.description.trim(),
			linkKey,
			sections: editingChecklist.sections.map((section) => ({
				...section,
				name: section.name.trim() || 'Untitled section',
				schedule: normalizeSchedule(section.schedule, {
					allowDevFrequencies: import.meta.env.DEV
				}) ?? {
					frequency: 'daily',
					resetTimeUtc: '05:00',
					timeMode: 'utc'
				},
				tasks: section.tasks.map((task) => ({
					...task,
					title: task.title.trim() || 'Untitled task',
					notes: task.notes?.trim() || undefined
				}))
			}))
		};

		const existingIndex = appState.checklists.findIndex((item) => item.id === checklist.id);
		if (existingIndex === -1) {
			appState.checklists = [...appState.checklists, checklist];
		} else {
			appState.checklists = appState.checklists.map((item) =>
				item.id === checklist.id ? checklist : item
			);
		}

		cleanupCompletions(checklist);
		editingChecklist = null;
		openSectionIds = [];
		editingErrors = {};
		persist();
	}

	function deleteChecklist(checklist: Checklist): void {
		if (
			!window.confirm(`Delete "${checklist.name}"? Completion history for it will also be removed.`)
		) {
			return;
		}

		appState.checklists = appState.checklists.filter((item) => item.id !== checklist.id);
		delete appState.completions[checklist.id];
		if (selectedChecklistId === checklist.id) {
			selectedChecklistId = null;
			mode = 'manage';
			updateManagePath();
		}
		if (editingChecklist?.id === checklist.id) {
			editingChecklist = null;
			openSectionIds = [];
		}
		persist();
	}

	function enterChecklist(checklist: Checklist, updateUrl = true): void {
		selectedChecklistId = checklist.id;
		mode = 'view';
		editingChecklist = null;
		openSectionIds = [];
		now = new Date();
		if (updateUrl) updateChecklistQuery(directLinkValue(checklist));
	}

	function backToManage(): void {
		mode = 'manage';
		selectedChecklistId = null;
		editingChecklist = null;
		openSectionIds = [];
		editingErrors = {};
		now = new Date();
		updateManagePath();
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
			setEditingChecklist(checklist);
			editingErrors = {
				linkKey: `This link key is already used by "${conflict.name}".`
			};
			importFeedback = 'The starter template needs a unique link key before it can be saved.';
			return;
		}

		appState.checklists = [...appState.checklists, checklist];
		persist();
	}

	function addSection(position: number | undefined = undefined): void {
		if (!editingChecklist) return;
		const section = createSection('New section', 'daily');
		editingChecklist.sections = insertArrayItem(editingChecklist.sections, section, position);
		openSectionIds = [...new Set([...openSectionIds, section.id])];
	}

	function removeSection(sectionId: string): void {
		if (!editingChecklist) return;
		editingChecklist.sections = editingChecklist.sections.filter(
			(section) => section.id !== sectionId
		);
		openSectionIds = openSectionIds.filter((id) => id !== sectionId);
	}

	function moveSection(sectionId: string, direction: -1 | 1): void {
		if (!editingChecklist) return;

		const index = editingChecklist.sections.findIndex((section) => section.id === sectionId);
		editingChecklist.sections = moveArrayItem(editingChecklist.sections, index, direction);
	}

	function addTask(section: ChecklistSection, position: number | undefined = undefined): void {
		section.tasks = insertArrayItem(section.tasks, createTask('New task'), position);
	}

	function removeTask(section: ChecklistSection, taskId: string): void {
		section.tasks = section.tasks.filter((task) => task.id !== taskId);
	}

	function moveTask(section: ChecklistSection, taskId: string, direction: -1 | 1): void {
		const index = section.tasks.findIndex((task) => task.id === taskId);
		section.tasks = moveArrayItem(section.tasks, index, direction);
	}

	function updateFrequency(section: ChecklistSection, frequency: Frequency): void {
		section.schedule =
			normalizeSchedule(
				{
					...section.schedule,
					frequency,
					resetWeekday: frequency === 'weekly' || frequency === 'biweekly' ? 'monday' : undefined,
					anchorDate:
						frequency === 'biweekly'
							? alignDateToWeekday(section.schedule.anchorDate ?? todayUtc(), 'monday')
							: undefined
				},
				{ allowDevFrequencies: import.meta.env.DEV }
			) ?? section.schedule;
	}

	function updateScheduleTimeMode(section: ChecklistSection, timeMode: ScheduleTimeMode): void {
		section.schedule = {
			...section.schedule,
			timeMode
		};
	}

	function updateScheduleInputTime(section: ChecklistSection, time: string): void {
		section.schedule = {
			...section.schedule,
			resetTimeUtc: scheduleInputTimeToUtc(time, section.schedule.timeMode ?? 'utc', now)
		};
	}

	function updateResetWeekday(section: ChecklistSection, resetWeekday: Weekday): void {
		section.schedule.resetWeekday = resetWeekday;
		if (section.schedule.frequency === 'biweekly') {
			section.schedule.anchorDate = alignDateToWeekday(
				section.schedule.anchorDate ?? todayUtc(),
				resetWeekday
			);
		}
	}

	function updateAnchorDate(section: ChecklistSection, anchorDate: string): void {
		section.schedule.anchorDate = alignDateToWeekday(
			anchorDate,
			section.schedule.resetWeekday ?? 'monday'
		);
	}

	function toggleTask(section: ChecklistSection, task: ChecklistTask, checked: boolean): void {
		if (!selectedChecklist) return;

		appState.completions[selectedChecklist.id] ??= {};
		appState.completions[selectedChecklist.id][section.id] ??= {};

		if (checked) {
			appState.completions[selectedChecklist.id][section.id][task.id] = {
				completedAt: new Date().toISOString()
			};
		} else {
			delete appState.completions[selectedChecklist.id][section.id][task.id];
		}

		now = new Date();
		persist();
	}

	function taskIsDone(section: ChecklistSection, task: ChecklistTask): boolean {
		if (!selectedChecklist) return false;

		return isTaskComplete(section, getCompletion(selectedChecklist.id, section.id, task.id), now);
	}

	function getCompletion(
		checklistId: string,
		sectionId: string,
		taskId: string
	): CompletionRecord | undefined {
		return appState.completions[checklistId]?.[sectionId]?.[taskId];
	}

	function isTaskComplete(
		section: ChecklistSection,
		record: CompletionRecord | undefined,
		reference: Date
	): boolean {
		if (!record) return false;

		const completedAt = new Date(record.completedAt);
		const windowStart = getResetWindowStart(section.schedule, reference);

		return (
			!Number.isNaN(completedAt.getTime()) && windowStart !== null && completedAt >= windowStart
		);
	}

	function sectionProgress(section: ChecklistSection): { done: number; total: number } {
		return {
			done: section.tasks.filter((task) => taskIsDone(section, task)).length,
			total: section.tasks.length
		};
	}

	function setEditingChecklist(checklist: Checklist): void {
		editingChecklist = checklist;
		openSectionIds = checklist.sections.map((section) => section.id);
	}

	function createSection(name: string, frequency: Frequency): ChecklistSection {
		const resetWeekday = frequency === 'weekly' || frequency === 'biweekly' ? 'monday' : undefined;

		return {
			id: createId(),
			name,
			schedule: normalizeSchedule(
				{
					frequency,
					resetTimeUtc: '05:00',
					timeMode: 'utc',
					resetWeekday,
					anchorDate:
						frequency === 'biweekly'
							? alignDateToWeekday(todayUtc(), resetWeekday ?? 'monday')
							: undefined
				},
				{ allowDevFrequencies: import.meta.env.DEV }
			) ?? {
				frequency: 'daily',
				resetTimeUtc: '05:00',
				timeMode: 'utc'
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

	function cancelEditing(): void {
		editingChecklist = null;
		openSectionIds = [];
		editingErrors = {};
	}

	function cleanupCompletions(checklist: Checklist): void {
		const checklistCompletions = appState.completions[checklist.id];
		if (!checklistCompletions) return;

		const sectionIds = new Set(checklist.sections.map((section) => section.id));
		for (const sectionId of Object.keys(checklistCompletions)) {
			if (!sectionIds.has(sectionId)) {
				delete checklistCompletions[sectionId];
				continue;
			}

			const section = checklist.sections.find((item) => item.id === sectionId);
			const taskIds = new Set(section?.tasks.map((task) => task.id) ?? []);
			for (const taskId of Object.keys(checklistCompletions[sectionId])) {
				if (!taskIds.has(taskId)) delete checklistCompletions[sectionId][taskId];
			}
		}
	}

	function cloneChecklist(checklist: Checklist): Checklist {
		return JSON.parse(JSON.stringify(checklist)) as Checklist;
	}

	function createId(): string {
		return (
			globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
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

<svelte:head>
	<title>Recurring Checklists</title>
	<meta
		name="description"
		content="Client-side recurring checklists with local completion state and UTC reset windows."
	/>
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	{#if mode === 'manage'}
		<ChecklistManage
			{appState}
			bind:importInput
			{importFeedback}
			{copyFeedback}
			bind:editingChecklist
			bind:openSectionIds
			bind:editingErrors
			{frequencies}
			{now}
			onImportDefinitions={importDefinitions}
			onOpenImportPicker={openImportPicker}
			onAddStarterTemplate={addStarterTemplate}
			onCreateChecklist={createChecklist}
			onEnterChecklist={enterChecklist}
			onCopyChecklistLink={copyChecklistLink}
			onExportDefinition={exportDefinition}
			onEditChecklist={editChecklist}
			onDeleteChecklist={deleteChecklist}
			onAddSection={() => addSection()}
			onRemoveSection={removeSection}
			onMoveSection={moveSection}
			onAddTask={addTask}
			onRemoveTask={removeTask}
			onMoveTask={moveTask}
			onUpdateFrequency={updateFrequency}
			onUpdateScheduleTimeMode={updateScheduleTimeMode}
			onUpdateScheduleInputTime={updateScheduleInputTime}
			onUpdateResetWeekday={updateResetWeekday}
			onUpdateAnchorDate={updateAnchorDate}
			onClearLinkKeyError={() => (editingErrors.linkKey = undefined)}
			onCancelEditing={cancelEditing}
			onSaveChecklist={saveChecklist}
		/>
	{:else if selectedChecklist}
		<ChecklistView
			checklist={selectedChecklist}
			{now}
			onBack={backToManage}
			onToggleTask={toggleTask}
			{taskIsDone}
			{sectionProgress}
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
