<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import ChecklistEditor from './ChecklistEditor.svelte';
	import {
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type Frequency,
		type ScheduleTimeMode,
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
		scheduleInputTimeToUtc,
		todayUtc
	} from '$lib/checklists';

	const frequencies = allFrequencies;

	const initialChecklist = createChecklistDraft();

	let checklist = $state<Checklist>(initialChecklist);
	let openSectionIds = $state<string[]>(initialChecklist.sections.map((section) => section.id));
	let editingErrors = $state<{ linkKey?: string }>({});
	let now = $state(new Date());

	onMount(() => {
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

	function saveChecklist(): void {
		const appState = loadAppState(localStorage, { allowDevFrequencies: import.meta.env.DEV });
		const linkKey = normalizeLinkKey(checklist.linkKey);
		const conflict = linkKeyConflict(appState.checklists, linkKey);
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

		appState.checklists = [...appState.checklists, savedChecklist];
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
		void goto('/');
	}

	function cloneChecklist(value: Checklist): Checklist {
		return JSON.parse(JSON.stringify(value)) as Checklist;
	}

	function createId(): string {
		return (
			globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
	}
</script>

<svelte:head>
	<title>Create Checklist</title>
	<meta name="description" content="Create a recurring checklist." />
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
		<header
			class="flex flex-col gap-4 border-b border-surface-800 pb-5 md:flex-row md:items-center md:justify-between"
		>
			<div class="min-w-0">
				<h1 class="text-3xl font-semibold tracking-normal text-surface-50">Create Checklist</h1>
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
			onUpdateScheduleTimeMode={updateScheduleTimeMode}
			onUpdateScheduleInputTime={updateScheduleInputTime}
			onUpdateResetWeekday={updateResetWeekday}
			onUpdateAnchorDate={updateAnchorDate}
			onClearLinkKeyError={() => (editingErrors.linkKey = undefined)}
			onCancel={cancelEditing}
			onSave={saveChecklist}
		/>
	</section>
</main>
