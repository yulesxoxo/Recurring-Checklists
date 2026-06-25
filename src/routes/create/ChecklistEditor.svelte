<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowDown, ArrowUp, ChevronDown, Plus, Save, Trash2 } from '@lucide/svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import { onMount } from 'svelte';
	import ChecklistNotFound from '../ChecklistNotFound.svelte';
	import SkeletonDatePicker from './SkeletonDatePicker.svelte';
	import {
		DIRECT_LINK_PARAM,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type Frequency,
		type RecurringSchedule,
		type Weekday,
		allFrequencies,
		insertArrayItem,
		linkKeyConflict,
		loadAppState,
		moveArrayItem,
		normalizeLinkKey,
		normalizeSchedule,
		saveAppState,
		titleCase,
		weekdays
	} from '$lib/checklists';
	import {
		type ScheduleTimeMode,
		alignDateToWeekday,
		describeSchedule,
		formatLocalReset,
		formatUtcReset,
		getNextReset,
		getResetWindowStart,
		scheduleInputTime,
		scheduleInputTimeToUtc,
		scheduleResetTimeUtc,
		todayUtc,
		utcDateTimeToInputValue
	} from '$lib/date-time';
	import { createId } from '$lib/id';

	type EditingErrors = { linkKey?: string };

	const frequencies = allFrequencies;
	const initialChecklist = createChecklistDraft();

	let checklist = $state<Checklist>(initialChecklist);
	let openSectionIds = $state<string[]>(initialChecklist.sections.map((section) => section.id));
	let editingErrors = $state<EditingErrors>({});
	let checklistNotFound = $state(false);
	let now = $state(new Date());
	let scheduleTimeModes = $state<Record<string, ScheduleTimeMode>>({});
	let editChecklistId = $state<string | null>(null);

	onMount(() => {
		editChecklistId = new URLSearchParams(window.location.search).get('edit');
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
		const appState = loadAppState(localStorage);
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
		const appState = loadAppState(localStorage);
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
				defaultSchedule: normalizeSchedule(section.defaultSchedule) ?? {
					frequency: 'daily',
					anchorDateTimeUtc: `${todayUtc()}T05:00:00.000Z`
				},
				tasks: section.tasks.map((task) => ({
					...task,
					title: task.title.trim() || 'Untitled task',
					notes: task.notes?.trim() || undefined,
					schedule: task.schedule ? (normalizeSchedule(task.schedule) ?? undefined) : undefined
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
		void goto(resolve('/'), { replaceState: true });
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

	function replaceSchedule(schedule: RecurringSchedule, next: RecurringSchedule): void {
		delete schedule.resetWeekday;
		delete schedule.anchorDateTimeUtc;
		delete schedule.intervalMinutes;
		delete schedule.intervalMode;
		Object.assign(schedule, next);
	}

	function updateFrequency(schedule: RecurringSchedule, frequency: Frequency): void {
		const next =
			normalizeSchedule(
				{
					...schedule,
					frequency,
					resetWeekday: frequency === 'weekly' || frequency === 'biweekly' ? 'monday' : undefined,
					anchorDateTimeUtc:
						frequency === 'biweekly'
							? (schedule.anchorDateTimeUtc ?? `${todayUtc()}T05:00:00.000Z`)
							: frequency === 'interval'
								? (schedule.anchorDateTimeUtc ?? new Date().toISOString())
								: undefined,
					intervalMinutes: frequency === 'interval' ? (schedule.intervalMinutes ?? 60) : undefined,
					intervalMode: frequency === 'interval' ? (schedule.intervalMode ?? 'anchor') : undefined
				},
				{}
			) ?? schedule;
		replaceSchedule(schedule, next);
	}

	function updateResetWeekday(schedule: RecurringSchedule, resetWeekday: Weekday): void {
		schedule.resetWeekday = resetWeekday;
		if (schedule.frequency === 'biweekly') {
			schedule.anchorDateTimeUtc = biweeklyAnchorDateTime(
				schedule,
				biweeklyAnchorDate(schedule),
				scheduleResetTimeUtc(schedule),
				resetWeekday
			);
		}
	}

	function updateAnchorDate(schedule: RecurringSchedule, anchorDate: string): void {
		schedule.anchorDateTimeUtc = biweeklyAnchorDateTime(schedule, anchorDate);
	}

	function biweeklyAnchorDate(schedule: RecurringSchedule): string {
		return schedule.anchorDateTimeUtc?.slice(0, 10) ?? todayUtc();
	}

	function biweeklyAnchorDateTime(
		schedule: RecurringSchedule,
		anchorDate: string,
		resetTimeUtc = scheduleResetTimeUtc(schedule),
		resetWeekday = schedule.resetWeekday ?? 'monday'
	): string {
		return `${alignDateToWeekday(anchorDate, resetWeekday)}T${resetTimeUtc}:00.000Z`;
	}

	function intervalHours(schedule: RecurringSchedule): number {
		return Math.floor((schedule.intervalMinutes ?? 60) / 60);
	}

	function intervalMinuteRemainder(schedule: RecurringSchedule): number {
		return (schedule.intervalMinutes ?? 60) % 60;
	}

	function updateIntervalDuration(
		schedule: RecurringSchedule,
		part: 'hours' | 'minutes',
		value: string
	): void {
		const numeric = Math.max(0, Math.floor(Number(value) || 0));
		const hours = part === 'hours' ? numeric : intervalHours(schedule);
		const minutes = part === 'minutes' ? numeric : intervalMinuteRemainder(schedule);

		schedule.intervalMinutes = Math.max(1, hours * 60 + minutes);
	}

	function updateIntervalMode(schedule: RecurringSchedule, completionBased: boolean): void {
		const next =
			normalizeSchedule(
				{
					...schedule,
					intervalMode: completionBased ? 'completion' : 'anchor',
					anchorDateTimeUtc: schedule.anchorDateTimeUtc ?? new Date().toISOString()
				},
				{}
			) ?? schedule;
		replaceSchedule(schedule, next);
	}

	function updateIntervalAnchor(schedule: RecurringSchedule, value: string): void {
		const date = new Date(`${value.endsWith('Z') ? value : `${value}:00.000Z`}`);
		if (!Number.isNaN(date.getTime())) {
			schedule.anchorDateTimeUtc = date.toISOString();
		}
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
		const defaultSchedule = normalizeSchedule(
			{
				frequency,
				resetWeekday,
				anchorDateTimeUtc:
					frequency === 'biweekly'
						? `${alignDateToWeekday(todayUtc(), resetWeekday ?? 'monday')}T05:00:00.000Z`
						: frequency === 'interval'
							? new Date().toISOString()
							: `${todayUtc()}T05:00:00.000Z`,
				intervalMinutes: frequency === 'interval' ? 60 : undefined,
				intervalMode: frequency === 'interval' ? 'anchor' : undefined
			},
			{}
		) ?? {
			frequency: 'daily',
			anchorDateTimeUtc: `${todayUtc()}T05:00:00.000Z`
		};

		return {
			id: createId(),
			name,
			defaultSchedule,
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

	function cloneSchedule(schedule: RecurringSchedule): RecurringSchedule {
		return JSON.parse(JSON.stringify(schedule)) as RecurringSchedule;
	}

	function effectiveTaskSchedule(
		task: ChecklistTask,
		section: ChecklistSection
	): RecurringSchedule {
		return task.schedule ?? section.defaultSchedule;
	}

	function setTaskCustomSchedule(
		task: ChecklistTask,
		section: ChecklistSection,
		custom: boolean
	): void {
		task.schedule = custom ? cloneSchedule(effectiveTaskSchedule(task, section)) : undefined;
	}

	function cloneChecklist(value: Checklist): Checklist {
		return JSON.parse(JSON.stringify(value)) as Checklist;
	}

	function cleanupCompletions(
		appState: ReturnType<typeof loadAppState>,
		savedChecklist: Checklist
	): void {
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

	function updateOpenSections(details: { value: string[] }): void {
		openSectionIds = details.value;
	}

	function dateInputMinForWeekday(weekday: Weekday): string {
		return alignDateToWeekday('1970-01-01', weekday);
	}

	function scheduleTimeMode(scheduleKey: string): ScheduleTimeMode {
		return scheduleTimeModes[scheduleKey] ?? 'utc';
	}

	function updateEditorScheduleTimeMode(scheduleKey: string, timeMode: ScheduleTimeMode): void {
		scheduleTimeModes = {
			...scheduleTimeModes,
			[scheduleKey]: timeMode
		};
	}

	function updateScheduleInputTime(
		schedule: RecurringSchedule,
		scheduleKey: string,
		time: string
	): void {
		const resetTimeUtc = scheduleInputTimeToUtc(time, scheduleTimeMode(scheduleKey), now);
		schedule.anchorDateTimeUtc = scheduleAnchorDateTime(schedule, resetTimeUtc);
	}

	function scheduleAnchorDateTime(schedule: RecurringSchedule, resetTimeUtc: string): string {
		if (schedule.frequency === 'biweekly') {
			return biweeklyAnchorDateTime(schedule, biweeklyAnchorDate(schedule), resetTimeUtc);
		}

		return `${schedule.anchorDateTimeUtc?.slice(0, 10) ?? todayUtc()}T${resetTimeUtc}:00.000Z`;
	}

	function intervalAnchorDate(schedule: RecurringSchedule): string {
		return utcDateTimeToInputValue(schedule.anchorDateTimeUtc).slice(0, 10);
	}

	function intervalAnchorTime(schedule: RecurringSchedule): string {
		return utcDateTimeToInputValue(schedule.anchorDateTimeUtc).slice(11, 16);
	}

	function updateIntervalAnchorDate(schedule: RecurringSchedule, date: string): void {
		updateIntervalAnchor(schedule, `${date}T${intervalAnchorTime(schedule)}`);
	}

	function updateIntervalAnchorTime(schedule: RecurringSchedule, time: string): void {
		updateIntervalAnchor(schedule, `${intervalAnchorDate(schedule)}T${time}`);
	}
</script>

{#snippet scheduleEditor(schedule: RecurringSchedule, scheduleKey: string)}
	<div class={`grid gap-3 ${schedule.frequency === 'interval' ? '' : 'sm:grid-cols-2'}`}>
		<label class="label">
			<span class="label-text">Frequency</span>
			<select
				class="select"
				value={schedule.frequency}
				onchange={(event) => updateFrequency(schedule, event.currentTarget.value as Frequency)}
			>
				{#each frequencies as frequency (frequency)}
					<option value={frequency}>{titleCase(frequency)}</option>
				{/each}
			</select>
		</label>

		{#if schedule.frequency !== 'interval'}
			<div class="label">
				<span class="label-text">Reset time</span>
				<div class="grid grid-cols-2 overflow-hidden rounded-base border border-surface-700">
					<button
						class={`btn btn-sm rounded-none ${
							scheduleTimeMode(scheduleKey) === 'local'
								? 'preset-filled-primary-500'
								: 'preset-tonal-surface'
						}`}
						type="button"
						onclick={() => updateEditorScheduleTimeMode(scheduleKey, 'local')}
					>
						Local time
					</button>
					<button
						class={`btn btn-sm rounded-none ${
							scheduleTimeMode(scheduleKey) === 'utc'
								? 'preset-filled-primary-500'
								: 'preset-tonal-surface'
						}`}
						type="button"
						onclick={() => updateEditorScheduleTimeMode(scheduleKey, 'utc')}
					>
						UTC
					</button>
				</div>
				<input
					class="input"
					type="time"
					value={scheduleInputTime(schedule, now, scheduleTimeMode(scheduleKey))}
					onchange={(event) =>
						updateScheduleInputTime(schedule, scheduleKey, event.currentTarget.value)}
				/>
				<span class="text-xs text-surface-400">
					Local {scheduleInputTime(schedule, now, 'local')} / UTC {scheduleResetTimeUtc(schedule)}
				</span>
			</div>
		{/if}
	</div>

	{#if schedule.frequency === 'interval'}
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="label">
				<span class="label-text">Hours</span>
				<input
					class="input"
					type="number"
					min="0"
					step="1"
					value={intervalHours(schedule)}
					oninput={(event) => updateIntervalDuration(schedule, 'hours', event.currentTarget.value)}
				/>
			</label>
			<label class="label">
				<span class="label-text">Minutes</span>
				<input
					class="input"
					type="number"
					min="0"
					max="59"
					step="1"
					value={intervalMinuteRemainder(schedule)}
					oninput={(event) =>
						updateIntervalDuration(schedule, 'minutes', event.currentTarget.value)}
				/>
			</label>
		</div>

		<label class="mt-3 flex items-center gap-3 text-sm text-surface-300">
			<input
				class="checkbox"
				type="checkbox"
				checked={schedule.intervalMode === 'completion'}
				onchange={(event) => updateIntervalMode(schedule, event.currentTarget.checked)}
			/>
			<span>Reset based on when each task was checked</span>
		</label>

		{#if schedule.intervalMode !== 'completion'}
			<div class="label mt-3">
				<span class="label-text">Anchor date/time UTC</span>
				<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
					<SkeletonDatePicker
						label="Anchor date"
						value={intervalAnchorDate(schedule)}
						onChange={(date) => updateIntervalAnchorDate(schedule, date)}
					/>
					<label class="label">
						<span class="label-text">Anchor time UTC</span>
						<input
							class="input"
							type="time"
							value={intervalAnchorTime(schedule)}
							onchange={(event) => updateIntervalAnchorTime(schedule, event.currentTarget.value)}
						/>
					</label>
				</div>
			</div>
		{/if}
	{/if}

	{#if schedule.frequency === 'weekly' || schedule.frequency === 'biweekly'}
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="label">
				<span class="label-text">Reset weekday</span>
				<select
					class="select"
					value={schedule.resetWeekday}
					onchange={(event) => updateResetWeekday(schedule, event.currentTarget.value as Weekday)}
				>
					{#each weekdays as weekday (weekday)}
						<option value={weekday}>{titleCase(weekday)}</option>
					{/each}
				</select>
			</label>

			{#if schedule.frequency === 'biweekly'}
				<div class="label">
					<SkeletonDatePicker
						label="Anchor date"
						min={dateInputMinForWeekday(schedule.resetWeekday ?? 'monday')}
						value={biweeklyAnchorDate(schedule)}
						onChange={(date) => updateAnchorDate(schedule, date)}
					/>
					<span class="text-xs text-surface-400">Only the selected reset weekday is valid.</span>
				</div>
			{/if}
		</div>
	{/if}

	{#if schedule.frequency === 'interval' && schedule.intervalMode === 'completion'}
		<p
			class="mt-3 rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300"
		>
			{describeSchedule(schedule)}
		</p>
	{:else}
		<div
			class="mt-3 grid gap-1 rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300 sm:grid-cols-2"
		>
			<div>
				<div class="font-medium text-surface-100">Previous reset</div>
				<div>Local: {formatLocalReset(getResetWindowStart(schedule, now))}</div>
				<div>UTC: {formatUtcReset(getResetWindowStart(schedule, now))}</div>
			</div>
			<div>
				<div class="font-medium text-surface-100">Next reset</div>
				<div>Local: {formatLocalReset(getNextReset(schedule, now))}</div>
				<div>UTC: {formatUtcReset(getNextReset(schedule, now))}</div>
			</div>
		</div>
	{/if}
{/snippet}

{#if checklistNotFound}
	<ChecklistNotFound />
{:else}
	<section class="rounded-container border border-surface-800 bg-surface-900 p-5 shadow-sm">
		<form
			class="flex flex-col gap-5"
			onsubmit={(event) => {
				event.preventDefault();
				saveChecklist();
			}}
		>
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-lg font-semibold text-surface-50">Checklist editor</h2>
					<p class="text-sm text-surface-400">Changes save locally in this browser.</p>
				</div>
			</div>

			<label class="label">
				<span class="label-text">Name</span>
				<input class="input" bind:value={checklist.name} placeholder="Checklist name" required />
			</label>

			<label class="label">
				<span class="label-text">Description</span>
				<textarea
					class="textarea"
					bind:value={checklist.description}
					rows="3"
					placeholder="Short description"></textarea>
			</label>

			<label class="label">
				<span class="label-text">Direct link key</span>
				<input
					class={`input ${editingErrors.linkKey ? 'border-error-500' : ''}`}
					bind:value={checklist.linkKey}
					placeholder="Optional, for example NTE"
					oninput={() => (editingErrors.linkKey = undefined)}
				/>
				<span class={editingErrors.linkKey ? 'text-xs text-error-400' : 'text-xs text-surface-400'}>
					{editingErrors.linkKey ||
						`Used in links as ?${DIRECT_LINK_PARAM}=value. Matching is case-insensitive.`}
				</span>
			</label>

			<div class="border-t border-surface-800 pt-4">
				<h3 class="text-base font-semibold text-surface-50">Sections</h3>
			</div>

			<Accordion
				class="flex flex-col gap-3"
				multiple
				collapsible
				value={openSectionIds}
				onValueChange={updateOpenSections}
			>
				{#each checklist.sections as section, sectionIndex (section.id)}
					<Accordion.Item
						class="overflow-hidden rounded-base border border-surface-800 bg-surface-950"
						value={section.id}
					>
						<div
							class="grid gap-2 border-b border-surface-800 bg-surface-900 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
						>
							<Accordion.ItemTrigger
								class="flex min-w-0 items-center gap-3 rounded-base px-2 py-1 text-left transition hover:bg-surface-800"
							>
								<Accordion.ItemIndicator class="shrink-0 text-surface-400">
									<ChevronDown size={18} aria-hidden="true" />
								</Accordion.ItemIndicator>
								<span class="min-w-0 flex-1">
									<span class="block truncate font-semibold text-surface-50">
										{section.name || 'Untitled section'}
									</span>
									<span class="mt-1 flex flex-wrap gap-2 text-xs text-surface-400">
										<span>{titleCase(section.defaultSchedule.frequency)} default</span>
										<span>{section.tasks.length} tasks</span>
										<span>{describeSchedule(section.defaultSchedule)}</span>
									</span>
								</span>
							</Accordion.ItemTrigger>
							<div class="flex flex-wrap justify-end gap-2">
								<button
									class="btn-icon btn-icon-sm preset-tonal-surface"
									type="button"
									title="Move section up"
									aria-label="Move section up"
									disabled={sectionIndex === 0}
									onclick={() => moveSection(section.id, -1)}
								>
									<ArrowUp size={16} aria-hidden="true" />
								</button>
								<button
									class="btn-icon btn-icon-sm preset-tonal-surface"
									type="button"
									title="Move section down"
									aria-label="Move section down"
									disabled={sectionIndex === checklist.sections.length - 1}
									onclick={() => moveSection(section.id, 1)}
								>
									<ArrowDown size={16} aria-hidden="true" />
								</button>
								<button
									class="btn-icon btn-icon-sm preset-tonal-error"
									type="button"
									title="Delete section"
									aria-label="Delete section"
									onclick={() => removeSection(section.id)}
								>
									<Trash2 size={16} aria-hidden="true" />
								</button>
							</div>
						</div>

						<Accordion.ItemContent class="p-4">
							<div class="mb-3">
								<label class="label">
									<span class="label-text">Section name</span>
									<input class="input" bind:value={section.name} placeholder="Daily" required />
								</label>
							</div>

							<div class="rounded-base border border-surface-800 bg-surface-900 p-3">
								<h4 class="mb-3 text-sm font-semibold text-surface-300">Default task schedule</h4>
								{@render scheduleEditor(section.defaultSchedule, `${section.id}:default`)}
							</div>

							<div class="mt-4">
								<h4 class="text-sm font-semibold text-surface-300">Tasks</h4>
							</div>

							<div class="mt-3 flex flex-col gap-3">
								{#each section.tasks as task, taskIndex (task.id)}
									<div class="grid gap-2 rounded-base border border-surface-800 bg-surface-900 p-3">
										<div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
											<label class="label min-w-0">
												<span class="label-text">Task title</span>
												<input class="input" bind:value={task.title} placeholder="Task title" />
											</label>
											<div class="flex flex-wrap items-end gap-2">
												<button
													class="btn-icon btn-icon-sm preset-tonal-surface"
													type="button"
													title="Move task up"
													aria-label="Move task up"
													disabled={taskIndex === 0}
													onclick={() => moveTask(section, task.id, -1)}
												>
													<ArrowUp size={16} aria-hidden="true" />
												</button>
												<button
													class="btn-icon btn-icon-sm preset-tonal-surface"
													type="button"
													title="Move task down"
													aria-label="Move task down"
													disabled={taskIndex === section.tasks.length - 1}
													onclick={() => moveTask(section, task.id, 1)}
												>
													<ArrowDown size={16} aria-hidden="true" />
												</button>
												<button
													class="btn-icon btn-icon-sm preset-tonal-error"
													type="button"
													title="Delete task"
													aria-label="Delete task"
													onclick={() => removeTask(section, task.id)}
												>
													<Trash2 size={16} aria-hidden="true" />
												</button>
											</div>
										</div>
										<label class="label">
											<span class="label-text">Notes</span>
											<textarea
												class="textarea"
												bind:value={task.notes}
												rows="2"
												placeholder="Optional notes"></textarea>
										</label>
										<div class="rounded-base border border-surface-800 bg-surface-950 p-3">
											<div
												class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
											>
												<h5 class="text-sm font-semibold text-surface-300">Task schedule</h5>
												<label class="flex items-center gap-2 text-sm text-surface-300">
													<input
														class="checkbox"
														type="checkbox"
														checked={task.schedule !== undefined}
														onchange={(event) =>
															setTaskCustomSchedule(task, section, event.currentTarget.checked)}
													/>
													<span>Custom schedule</span>
												</label>
											</div>
											{#if task.schedule}
												{@render scheduleEditor(task.schedule, `${task.id}:schedule`)}
											{:else}
												<p class="text-sm text-surface-400">
													Uses section default: {describeSchedule(section.defaultSchedule)}
												</p>
											{/if}
										</div>
									</div>
								{/each}
							</div>

							<div class="mt-3 flex justify-end">
								<button
									class="btn btn-sm preset-tonal-secondary"
									type="button"
									onclick={() => addTask(section)}
								>
									<Plus size={16} aria-hidden="true" />
									Task
								</button>
							</div>
						</Accordion.ItemContent>
					</Accordion.Item>
				{/each}
			</Accordion>

			<button
				class="btn btn-sm preset-tonal-primary self-end"
				type="button"
				onclick={() => addSection()}
			>
				<Plus size={16} aria-hidden="true" />
				Section
			</button>

			<div class="flex justify-end gap-2 border-t border-surface-800 pt-4">
				<button class="btn preset-filled-success-500" type="submit">
					<Save size={18} aria-hidden="true" />
					Save
				</button>
			</div>
		</form>
	</section>
{/if}
