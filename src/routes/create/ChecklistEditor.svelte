<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowDown, ArrowUp, ChevronDown, Plus, Save, Trash2 } from '@lucide/svelte';
	import { Accordion, Progress } from '@skeletonlabs/skeleton-svelte';
	import { onMount } from 'svelte';
	import ChecklistNotFound from '../ChecklistNotFound.svelte';
	import SkeletonDatePicker from './SkeletonDatePicker.svelte';
	import { appState, initializeAppState } from '$lib/appState.svelte';
	import {
		DIRECT_LINK_PARAM,
		type AppState,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type Frequency,
		type RecurringSchedule,
		type ScheduleTimeBasis,
		type Weekday,
		allFrequencies,
		insertArrayItem,
		linkKeyConflict,
		moveArrayItem,
		normalizeLinkKey,
		normalizeSchedule,
		normalizeTaskCounts,
		titleCase,
		weekdays
	} from '$lib/checklists';
	import {
		alignDateToWeekday,
		describeSchedule,
		formatScheduleLocalReset,
		getNextReset,
		getResetWindowStart,
		scheduleResetTime,
		scheduleTimeBasis,
		todayUtc,
		utcTimeToLocalTime,
		utcDateTimeToInputValue,
		formatResetDate
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
	let editChecklistId = $state<string | null>(null);
	let editorReady = $state(false);

	onMount(() => {
		void initializeEditor();

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

	async function initializeEditor(): Promise<void> {
		await initializeAppState();
		editChecklistId = new URLSearchParams(window.location.search).get('edit');
		if (editChecklistId) loadChecklistForEditing(editChecklistId);
		editorReady = true;
	}

	function loadChecklistForEditing(checklistId: string): void {
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
					timeBasis: 'utc',
					resetTime: '05:00'
				},
				tasks: section.tasks.map((task) => ({
					...task,
					title: task.title.trim() || 'Untitled task',
					notes: task.notes?.trim() || undefined,
					schedule: task.schedule ? (normalizeSchedule(task.schedule) ?? undefined) : undefined,
					...normalizeTaskCounts(task)
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
		delete schedule.availableWeekdays;
		delete schedule.availableStartTime;
		delete schedule.availableEndTime;
		delete schedule.timeBasis;
		delete schedule.resetTime;
		delete schedule.anchorDate;
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
					availableWeekdays: frequency === 'daily' ? schedule.availableWeekdays : undefined,
					availableStartTime: frequency === 'daily' ? schedule.availableStartTime : undefined,
					availableEndTime: frequency === 'daily' ? schedule.availableEndTime : undefined,
					timeBasis: frequency === 'interval' ? undefined : scheduleTimeBasis(schedule),
					resetTime: frequency === 'interval' ? undefined : scheduleResetTime(schedule),
					anchorDate:
						frequency === 'biweekly'
							? (schedule.anchorDate ??
								alignDateToWeekday(todayUtc(), 'monday', scheduleTimeBasis(schedule)))
							: undefined,
					anchorDateTimeUtc:
						frequency === 'interval'
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
			schedule.anchorDate = alignDateToWeekday(
				biweeklyAnchorDate(schedule),
				resetWeekday,
				scheduleTimeBasis(schedule)
			);
		}
	}

	function updateScheduleTimeBasis(
		schedule: RecurringSchedule,
		timeBasis: ScheduleTimeBasis
	): void {
		schedule.timeBasis = timeBasis;
		if (schedule.frequency === 'biweekly') {
			schedule.anchorDate = alignDateToWeekday(
				biweeklyAnchorDate(schedule),
				schedule.resetWeekday ?? 'monday',
				timeBasis
			);
		}
	}

	function updateAvailableWeekday(
		schedule: RecurringSchedule,
		weekday: Weekday,
		available: boolean
	): void {
		const current = schedule.availableWeekdays ?? weekdays;
		const next = available
			? weekdays.filter((value) => value === weekday || current.includes(value))
			: current.filter((value) => value !== weekday);

		if (next.length > 0 && next.length < weekdays.length) {
			schedule.availableWeekdays = next;
		} else {
			delete schedule.availableWeekdays;
		}
	}

	function updateAvailableTimeWindowEnabled(schedule: RecurringSchedule, enabled: boolean): void {
		if (enabled) {
			schedule.availableStartTime = schedule.availableStartTime ?? '16:00';
			schedule.availableEndTime = schedule.availableEndTime ?? '06:00';
		} else {
			delete schedule.availableStartTime;
			delete schedule.availableEndTime;
		}
	}

	function updateAvailableTimeWindow(
		schedule: RecurringSchedule,
		part: 'start' | 'end',
		time: string
	): void {
		if (part === 'start') {
			schedule.availableStartTime = time;
		} else {
			schedule.availableEndTime = time;
		}
	}

	function updateAnchorDate(schedule: RecurringSchedule, anchorDate: string): void {
		schedule.anchorDate = alignDateToWeekday(
			anchorDate,
			schedule.resetWeekday ?? 'monday',
			scheduleTimeBasis(schedule)
		);
	}

	function biweeklyAnchorDate(schedule: RecurringSchedule): string {
		return schedule.anchorDate ?? todayUtc();
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
				timeBasis: frequency === 'interval' ? undefined : 'utc',
				resetTime: frequency === 'interval' ? undefined : '05:00',
				anchorDate:
					frequency === 'biweekly'
						? alignDateToWeekday(todayUtc(), resetWeekday ?? 'monday')
						: undefined,
				anchorDateTimeUtc: frequency === 'interval' ? new Date().toISOString() : undefined,
				intervalMinutes: frequency === 'interval' ? 60 : undefined,
				intervalMode: frequency === 'interval' ? 'anchor' : undefined
			},
			{}
		) ?? {
			frequency: 'daily',
			timeBasis: 'utc',
			resetTime: '05:00'
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
			notes: '',
			repeatCount: undefined,
			maxCarryover: undefined
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

	function cleanupCompletions(state: AppState, savedChecklist: Checklist): void {
		const checklistCompletions = state.completions[savedChecklist.id];
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

	function updateScheduleInputTime(schedule: RecurringSchedule, time: string): void {
		schedule.resetTime = time;
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

	function taskRepeatCount(task: ChecklistTask): number {
		return Math.max(1, Math.floor(task.repeatCount ?? 1));
	}

	function taskMaxCarryover(task: ChecklistTask): number {
		return Math.max(taskRepeatCount(task), Math.floor(task.maxCarryover ?? taskRepeatCount(task)));
	}

	function updateTaskRepeatCount(task: ChecklistTask, value: string): void {
		const repeatCount = Math.max(1, Math.floor(Number(value) || 1));
		if (repeatCount > 1) {
			task.repeatCount = repeatCount;
		} else {
			delete task.repeatCount;
		}

		if (task.maxCarryover !== undefined && task.maxCarryover < repeatCount) {
			task.maxCarryover = repeatCount;
		}
	}

	function updateTaskMaxCarryover(task: ChecklistTask, value: string): void {
		const maxCarryover = Math.max(1, Math.floor(Number(value) || 1));
		if (maxCarryover > taskRepeatCount(task)) {
			task.maxCarryover = maxCarryover;
		} else {
			delete task.maxCarryover;
		}
	}

	function resetTimeSummary(schedule: RecurringSchedule): string {
		const time = scheduleResetTime(schedule);
		if (scheduleTimeBasis(schedule) === 'local') {
			return `Local ${time}`;
		}

		return `UTC ${time} / Local ${utcTimeToLocalTime(time, now)}`;
	}

	function scheduleBasisLabel(schedule: RecurringSchedule): string {
		return scheduleTimeBasis(schedule) === 'local' ? 'local time' : 'UTC time';
	}
</script>

{#snippet scheduleEditor(schedule: RecurringSchedule)}
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
				<span class="label-text">Schedule basis</span>
				<div class="grid grid-cols-2 overflow-hidden rounded-base border border-surface-700">
					<button
						class={`btn rounded-none btn-sm ${
							scheduleTimeBasis(schedule) === 'local'
								? 'preset-filled-primary-500'
								: 'preset-tonal-surface'
						}`}
						type="button"
						onclick={() => updateScheduleTimeBasis(schedule, 'local')}
					>
						Local time
					</button>
					<button
						class={`btn rounded-none btn-sm ${
							scheduleTimeBasis(schedule) === 'utc'
								? 'preset-filled-primary-500'
								: 'preset-tonal-surface'
						}`}
						type="button"
						onclick={() => updateScheduleTimeBasis(schedule, 'utc')}
					>
						UTC
					</button>
				</div>
				<span class="mt-3 label-text">Reset time ({scheduleBasisLabel(schedule)})</span>
				<input
					class="input"
					type="time"
					value={scheduleResetTime(schedule)}
					onchange={(event) => updateScheduleInputTime(schedule, event.currentTarget.value)}
				/>
				<span class="text-xs text-surface-400">{resetTimeSummary(schedule)}</span>
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

	{#if schedule.frequency === 'daily'}
		<div class="mt-3 rounded-base border border-surface-800 bg-surface-900 p-3">
			<div class="text-sm font-semibold text-surface-300">Available days</div>
			<div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				{#each weekdays as weekday (weekday)}
					<label class="flex items-center gap-2 text-sm text-surface-300">
						<input
							class="checkbox"
							type="checkbox"
							checked={!schedule.availableWeekdays?.length ||
								schedule.availableWeekdays.includes(weekday)}
							onchange={(event) =>
								updateAvailableWeekday(schedule, weekday, event.currentTarget.checked)}
						/>
						<span>{titleCase(weekday)}</span>
					</label>
				{/each}
			</div>

			<div class="mt-4 border-t border-surface-800 pt-3">
				<label class="flex items-center gap-2 text-sm text-surface-300">
					<input
						class="checkbox"
						type="checkbox"
						checked={Boolean(schedule.availableStartTime && schedule.availableEndTime)}
						onchange={(event) =>
							updateAvailableTimeWindowEnabled(schedule, event.currentTarget.checked)}
					/>
					<span>Limit by {scheduleBasisLabel(schedule)}</span>
				</label>

				{#if schedule.availableStartTime && schedule.availableEndTime}
					<div class="mt-3 grid gap-3 sm:grid-cols-2">
						<label class="label">
							<span class="label-text">Available from ({scheduleBasisLabel(schedule)})</span>
							<input
								class="input"
								type="time"
								value={schedule.availableStartTime}
								onchange={(event) =>
									updateAvailableTimeWindow(schedule, 'start', event.currentTarget.value)}
							/>
						</label>
						<label class="label">
							<span class="label-text">Available until ({scheduleBasisLabel(schedule)})</span>
							<input
								class="input"
								type="time"
								value={schedule.availableEndTime}
								onchange={(event) =>
									updateAvailableTimeWindow(schedule, 'end', event.currentTarget.value)}
							/>
						</label>
					</div>
				{/if}
			</div>
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
				<div>Local: {formatScheduleLocalReset(schedule, getResetWindowStart(schedule, now))}</div>
				<div>UTC: {formatResetDate(getResetWindowStart(schedule, now), 'UTC')}</div>
			</div>
			<div>
				<div class="font-medium text-surface-100">Next reset</div>
				<div>Local: {formatScheduleLocalReset(schedule, getNextReset(schedule, now))}</div>
				<div>UTC: {formatResetDate(getNextReset(schedule, now), 'UTC')}</div>
			</div>
		</div>
	{/if}
{/snippet}

{#if !editorReady}
	<section class="flex min-h-80 items-center justify-center">
		<Progress class="w-fit" value={null} aria-label="Loading checklist editor">
			<Progress.Circle class="[--size:--spacing(16)]">
				<Progress.CircleTrack />
				<Progress.CircleRange />
			</Progress.Circle>
		</Progress>
	</section>
{:else if checklistNotFound}
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
								{@render scheduleEditor(section.defaultSchedule)}
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
										<div class="grid gap-3 sm:grid-cols-2">
											<label class="label">
												<span class="label-text">Repeats per reset</span>
												<input
													class="input"
													type="number"
													min="1"
													step="1"
													value={taskRepeatCount(task)}
													oninput={(event) =>
														updateTaskRepeatCount(task, event.currentTarget.value)}
												/>
											</label>
											<label class="label">
												<span class="label-text">Stored attempt cap</span>
												<input
													class="input"
													type="number"
													min={taskRepeatCount(task)}
													step="1"
													value={taskMaxCarryover(task)}
													oninput={(event) =>
														updateTaskMaxCarryover(task, event.currentTarget.value)}
												/>
												<span class="text-xs text-surface-400">
													Set higher than repeats when attempts can carry over.
												</span>
											</label>
										</div>
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
												{@render scheduleEditor(task.schedule)}
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
									class="btn preset-tonal-secondary btn-sm"
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
				class="btn self-end preset-tonal-primary btn-sm"
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
