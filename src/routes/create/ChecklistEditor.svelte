<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ArrowDown, ArrowUp, ChevronDown, Plus, Save, Trash2 } from '@lucide/svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import { onMount } from 'svelte';
	import {
		DIRECT_LINK_PARAM,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type Frequency,
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
		normalizeUtcDateTimeInput,
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
	let editChecklistId = $derived(page.url.searchParams.get('edit'));

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
				schedule: normalizeSchedule(section.schedule) ?? {
					frequency: 'daily',
					anchorDateTimeUtc: `${todayUtc()}T05:00:00.000Z`
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
					anchorDateTimeUtc:
						frequency === 'biweekly'
							? (section.schedule.anchorDateTimeUtc ?? `${todayUtc()}T05:00:00.000Z`)
							: frequency === 'interval'
								? (section.schedule.anchorDateTimeUtc ?? new Date().toISOString())
								: undefined,
					intervalMinutes:
						frequency === 'interval' ? (section.schedule.intervalMinutes ?? 60) : undefined,
					intervalMode:
						frequency === 'interval' ? (section.schedule.intervalMode ?? 'anchor') : undefined
				},
				{}
			) ?? section.schedule;
	}

	function updateResetWeekday(section: ChecklistSection, resetWeekday: Weekday): void {
		section.schedule.resetWeekday = resetWeekday;
		if (section.schedule.frequency === 'biweekly') {
			section.schedule.anchorDateTimeUtc = biweeklyAnchorDateTime(
				section,
				biweeklyAnchorDate(section),
				scheduleResetTimeUtc(section.schedule),
				resetWeekday
			);
		}
	}

	function updateAnchorDate(section: ChecklistSection, anchorDate: string): void {
		section.schedule.anchorDateTimeUtc = biweeklyAnchorDateTime(section, anchorDate);
	}

	function biweeklyAnchorDate(section: ChecklistSection): string {
		return section.schedule.anchorDateTimeUtc?.slice(0, 10) ?? todayUtc();
	}

	function biweeklyAnchorDateTime(
		section: ChecklistSection,
		anchorDate: string,
		resetTimeUtc = scheduleResetTimeUtc(section.schedule),
		resetWeekday = section.schedule.resetWeekday ?? 'monday'
	): string {
		return `${alignDateToWeekday(anchorDate, resetWeekday)}T${resetTimeUtc}:00.000Z`;
	}

	function intervalHours(section: ChecklistSection): number {
		return Math.floor((section.schedule.intervalMinutes ?? 60) / 60);
	}

	function intervalMinuteRemainder(section: ChecklistSection): number {
		return (section.schedule.intervalMinutes ?? 60) % 60;
	}

	function updateIntervalDuration(
		section: ChecklistSection,
		part: 'hours' | 'minutes',
		value: string
	): void {
		const numeric = Math.max(0, Math.floor(Number(value) || 0));
		const hours = part === 'hours' ? numeric : intervalHours(section);
		const minutes = part === 'minutes' ? numeric : intervalMinuteRemainder(section);

		section.schedule.intervalMinutes = Math.max(1, hours * 60 + minutes);
	}

	function updateIntervalMode(section: ChecklistSection, completionBased: boolean): void {
		section.schedule =
			normalizeSchedule(
				{
					...section.schedule,
					intervalMode: completionBased ? 'completion' : 'anchor',
					anchorDateTimeUtc: section.schedule.anchorDateTimeUtc ?? new Date().toISOString()
				},
				{}
			) ?? section.schedule;
	}

	function updateIntervalAnchor(section: ChecklistSection, value: string): void {
		section.schedule.anchorDateTimeUtc =
			normalizeUtcDateTimeInput(value) ?? section.schedule.anchorDateTimeUtc;
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

	function scheduleTimeMode(section: ChecklistSection): ScheduleTimeMode {
		return scheduleTimeModes[section.id] ?? 'utc';
	}

	function updateEditorScheduleTimeMode(
		section: ChecklistSection,
		timeMode: ScheduleTimeMode
	): void {
		scheduleTimeModes = {
			...scheduleTimeModes,
			[section.id]: timeMode
		};
	}

	function updateScheduleInputTime(section: ChecklistSection, time: string): void {
		const resetTimeUtc = scheduleInputTimeToUtc(time, scheduleTimeMode(section), now);
		section.schedule = {
			...section.schedule,
			anchorDateTimeUtc: scheduleAnchorDateTime(section, resetTimeUtc)
		};
	}

	function scheduleAnchorDateTime(section: ChecklistSection, resetTimeUtc: string): string {
		if (section.schedule.frequency === 'biweekly') {
			return biweeklyAnchorDateTime(section, biweeklyAnchorDate(section), resetTimeUtc);
		}

		return `${section.schedule.anchorDateTimeUtc?.slice(0, 10) ?? todayUtc()}T${resetTimeUtc}:00.000Z`;
	}
</script>

<section class="rounded-container border border-surface-800 bg-surface-900 p-5 shadow-sm">
	{#if checklistNotFound}
		<div class="p-3 text-center">
			<h2 class="text-xl font-semibold text-surface-50">Checklist not found</h2>
			<p class="mt-2 text-sm text-surface-400">
				Return to manage mode and choose an available checklist.
			</p>
		</div>
	{:else}
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
										<span>{titleCase(section.schedule.frequency)}</span>
										<span>{section.tasks.length} tasks</span>
										<span>{describeSchedule(section.schedule)}</span>
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

							<div
								class={`grid gap-3 ${
									section.schedule.frequency === 'interval' ? '' : 'sm:grid-cols-2'
								}`}
							>
								<label class="label">
									<span class="label-text">Frequency</span>
									<select
										class="select"
										value={section.schedule.frequency}
										onchange={(event) =>
											updateFrequency(section, event.currentTarget.value as Frequency)}
									>
										{#each frequencies as frequency}
											<option value={frequency}>{titleCase(frequency)}</option>
										{/each}
									</select>
								</label>

								{#if section.schedule.frequency !== 'interval'}
									<div class="label">
										<span class="label-text">Reset time</span>
										<div
											class="grid grid-cols-2 overflow-hidden rounded-base border border-surface-700"
										>
											<button
												class={`btn btn-sm rounded-none ${
													scheduleTimeMode(section) === 'local'
														? 'preset-filled-primary-500'
														: 'preset-tonal-surface'
												}`}
												type="button"
												onclick={() => updateEditorScheduleTimeMode(section, 'local')}
											>
												Local time
											</button>
											<button
												class={`btn btn-sm rounded-none ${
													scheduleTimeMode(section) === 'utc'
														? 'preset-filled-primary-500'
														: 'preset-tonal-surface'
												}`}
												type="button"
												onclick={() => updateEditorScheduleTimeMode(section, 'utc')}
											>
												UTC
											</button>
										</div>
										<input
											class="input"
											type="time"
											value={scheduleInputTime(section.schedule, now, scheduleTimeMode(section))}
											onchange={(event) =>
												updateScheduleInputTime(section, event.currentTarget.value)}
										/>
										<span class="text-xs text-surface-400">
											Local {scheduleInputTime(section.schedule, now, 'local')}
											/ UTC {scheduleResetTimeUtc(section.schedule)}
										</span>
									</div>
								{/if}
							</div>

							{#if section.schedule.frequency === 'interval'}
								<div class="mt-3 grid gap-3 sm:grid-cols-2">
									<label class="label">
										<span class="label-text">Hours</span>
										<input
											class="input"
											type="number"
											min="0"
											step="1"
											value={intervalHours(section)}
											oninput={(event) =>
												updateIntervalDuration(section, 'hours', event.currentTarget.value)}
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
											value={intervalMinuteRemainder(section)}
											oninput={(event) =>
												updateIntervalDuration(section, 'minutes', event.currentTarget.value)}
										/>
									</label>
								</div>

								<label class="mt-3 flex items-center gap-3 text-sm text-surface-300">
									<input
										class="checkbox"
										type="checkbox"
										checked={section.schedule.intervalMode === 'completion'}
										onchange={(event) => updateIntervalMode(section, event.currentTarget.checked)}
									/>
									<span>Reset based on when each task was checked</span>
								</label>

								{#if section.schedule.intervalMode !== 'completion'}
									<label class="label mt-3">
										<span class="label-text">Anchor date/time UTC</span>
										<input
											class="input"
											type="datetime-local"
											value={utcDateTimeToInputValue(section.schedule.anchorDateTimeUtc)}
											onchange={(event) => updateIntervalAnchor(section, event.currentTarget.value)}
										/>
									</label>
								{/if}
							{/if}

							{#if section.schedule.frequency === 'weekly' || section.schedule.frequency === 'biweekly'}
								<div class="mt-3 grid gap-3 sm:grid-cols-2">
									<label class="label">
										<span class="label-text">Reset weekday</span>
										<select
											class="select"
											value={section.schedule.resetWeekday}
											onchange={(event) =>
												updateResetWeekday(section, event.currentTarget.value as Weekday)}
										>
											{#each weekdays as weekday}
												<option value={weekday}>{titleCase(weekday)}</option>
											{/each}
										</select>
									</label>

									{#if section.schedule.frequency === 'biweekly'}
										<label class="label">
											<span class="label-text">Anchor date</span>
											<input
												class="input"
												type="date"
												min={dateInputMinForWeekday(section.schedule.resetWeekday ?? 'monday')}
												step="7"
												value={biweeklyAnchorDate(section)}
												onchange={(event) => updateAnchorDate(section, event.currentTarget.value)}
											/>
											<span class="text-xs text-surface-400">
												Only the selected reset weekday is valid.
											</span>
										</label>
									{/if}
								</div>
							{/if}

							{#if section.schedule.frequency === 'interval' && section.schedule.intervalMode === 'completion'}
								<p
									class="mt-3 rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300"
								>
									{describeSchedule(section.schedule)}
								</p>
							{:else}
								<div
									class="mt-3 grid gap-1 rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300 sm:grid-cols-2"
								>
									<div>
										<div class="font-medium text-surface-100">Previous reset</div>
										<div>Local: {formatLocalReset(getResetWindowStart(section.schedule, now))}</div>
										<div>UTC: {formatUtcReset(getResetWindowStart(section.schedule, now))}</div>
									</div>
									<div>
										<div class="font-medium text-surface-100">Next reset</div>
										<div>Local: {formatLocalReset(getNextReset(section.schedule, now))}</div>
										<div>UTC: {formatUtcReset(getNextReset(section.schedule, now))}</div>
									</div>
								</div>
							{/if}

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
	{/if}
</section>
