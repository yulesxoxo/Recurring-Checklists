<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import ChecklistEditor from './ChecklistEditor.svelte';
	import {
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type Frequency,
		type Weekday,
		alignDateToWeekday,
		allFrequencies,
		insertArrayItem,
		linkKeyConflict,
		loadAppState,
		moveArrayItem,
		normalizeLinkKey,
		normalizeSchedule,
		saveAppState,
		todayUtc
	} from '$lib/checklists';

	const frequencies = allFrequencies;

	const initialChecklist = createChecklistDraft();

	let checklist = $state<Checklist>(initialChecklist);
	let openSectionIds = $state<string[]>(initialChecklist.sections.map((section) => section.id));
	let editingErrors = $state<{ linkKey?: string }>({});
	let checklistNotFound = $state(false);
	let now = $state(new Date());

	let editChecklistId = $derived(page.url.searchParams.get('edit'));
	let pageTitle = $derived(editChecklistId ? 'Edit Checklist' : 'Create Checklist');

	onMount(() => {
		if (editChecklistId) loadChecklistForEditing(editChecklistId);

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

	function loadChecklistForEditing(checklistId: string): void {
		const appState = loadAppState(localStorage, { allowDevFrequencies: import.meta.env.DEV });
		const existing = appState.checklists.find((item) => item.id === checklistId);

		if (!existing) {
			checklistNotFound = true;
			return;
		}

		checklist = cloneChecklist(existing);
		openSectionIds = checklist.sections.map((section) => section.id);
		checklistNotFound = false;
	}

	function saveChecklist(): void {
		const appState = loadAppState(localStorage, { allowDevFrequencies: import.meta.env.DEV });
		const linkKey = normalizeLinkKey(checklist.linkKey);
		const conflict = linkKeyConflict(appState.checklists, linkKey, editChecklistId ?? checklist.id);
		if (conflict) {
			editingErrors = {
				linkKey: `This link key is already used by "${conflict.name}".`
			};
			return;
		}

		const savedChecklist: Checklist = {
			...cloneChecklist(checklist),
			name: checklist.name.trim() || 'Untitled checklist',
			description: checklist.description.trim(),
			linkKey,
			sections: checklist.sections.map((section) => ({
				...section,
				name: section.name.trim() || 'Untitled section',
				schedule: normalizeSchedule(section.schedule, {
					allowDevFrequencies: import.meta.env.DEV
				}) ?? {
					frequency: 'daily',
					resetTimeUtc: '05:00'
				},
				tasks: section.tasks.map((task) => ({
					...task,
					title: task.title.trim() || 'Untitled task',
					notes: task.notes?.trim() || undefined
				}))
			}))
		};

		const existingIndex = appState.checklists.findIndex((item) => item.id === savedChecklist.id);
		if (existingIndex === -1) {
			appState.checklists = [...appState.checklists, savedChecklist];
		} else {
			appState.checklists = appState.checklists.map((item) =>
				item.id === savedChecklist.id ? savedChecklist : item
			);
			cleanupCompletions(appState, savedChecklist);
		}

		saveAppState(localStorage, appState);
		void goto('/', { replaceState: true });
	}

	function addSection(position: number | undefined = undefined): void {
		const section = createSection('New section', 'daily');
		checklist.sections = insertArrayItem(checklist.sections, section, position);
		openSectionIds = [...new Set([...openSectionIds, section.id])];
	}

	function removeSection(sectionId: string): void {
		checklist.sections = checklist.sections.filter((section) => section.id !== sectionId);
		openSectionIds = openSectionIds.filter((id) => id !== sectionId);
	}

	function moveSection(sectionId: string, direction: -1 | 1): void {
		const index = checklist.sections.findIndex((section) => section.id === sectionId);
		checklist.sections = moveArrayItem(checklist.sections, index, direction);
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

	function updateScheduleInputTime(section: ChecklistSection, resetTimeUtc: string): void {
		section.schedule = {
			...section.schedule,
			resetTimeUtc
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

	function createChecklistDraft(): Checklist {
		return {
			id: createId(),
			name: '',
			description: '',
			sections: [createSection('Daily', 'daily')]
		};
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
					resetWeekday,
					anchorDate:
						frequency === 'biweekly'
							? alignDateToWeekday(todayUtc(), resetWeekday ?? 'monday')
							: undefined
				},
				{ allowDevFrequencies: import.meta.env.DEV }
			) ?? {
				frequency: 'daily',
				resetTimeUtc: '05:00'
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
		void goto('/');
	}

	function cloneChecklist(value: Checklist): Checklist {
		return JSON.parse(JSON.stringify(value)) as Checklist;
	}

	function cleanupCompletions(appState: ReturnType<typeof loadAppState>, savedChecklist: Checklist): void {
		const checklistCompletions = appState.completions[savedChecklist.id];
		if (!checklistCompletions) return;

		const sectionIds = new Set(savedChecklist.sections.map((section) => section.id));
		for (const sectionId of Object.keys(checklistCompletions)) {
			if (!sectionIds.has(sectionId)) {
				delete checklistCompletions[sectionId];
				continue;
			}

			const section = savedChecklist.sections.find((item) => item.id === sectionId);
			const taskIds = new Set(section?.tasks.map((task) => task.id) ?? []);
			for (const taskId of Object.keys(checklistCompletions[sectionId])) {
				if (!taskIds.has(taskId)) delete checklistCompletions[sectionId][taskId];
			}
		}
	}

	function createId(): string {
		return (
			globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
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

		{#if checklistNotFound}
			<section class="rounded-container border border-surface-800 bg-surface-900 p-8 text-center">
				<h2 class="text-xl font-semibold text-surface-50">Checklist not found</h2>
				<p class="mt-2 text-sm text-surface-400">
					Return to manage mode and choose an available checklist.
				</p>
			</section>
		{:else}
			<ChecklistEditor
				bind:checklist
				bind:openSectionIds
				bind:editingErrors
				{frequencies}
				{now}
				onAddSection={() => addSection()}
				onRemoveSection={removeSection}
				onMoveSection={moveSection}
				onAddTask={addTask}
				onRemoveTask={removeTask}
				onMoveTask={moveTask}
				onUpdateFrequency={updateFrequency}
				onUpdateScheduleInputTime={updateScheduleInputTime}
				onUpdateResetWeekday={updateResetWeekday}
				onUpdateAnchorDate={updateAnchorDate}
				onClearLinkKeyError={() => (editingErrors.linkKey = undefined)}
				onCancel={cancelEditing}
				onSave={saveChecklist}
			/>
		{/if}
	</section>
</main>
