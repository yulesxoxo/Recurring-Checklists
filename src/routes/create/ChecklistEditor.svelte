<script lang="ts">
	import { ArrowDown, ArrowUp, ChevronDown, Plus, Save, Trash2 } from '@lucide/svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import {
		DIRECT_LINK_PARAM,
		type Checklist,
		type ChecklistSection,
		type Frequency,
		type Weekday,
		devFrequencies,
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
		scheduleInputTimeToUtc
	} from '$lib/date-time';

	type EditingErrors = { linkKey?: string };

	const devFrequencySet = new Set<Frequency>(devFrequencies);

	let {
		checklist = $bindable<Checklist>(),
		openSectionIds = $bindable<string[]>(),
		editingErrors = $bindable<EditingErrors>(),
		frequencies,
		now,
		onAddSection,
		onRemoveSection,
		onMoveSection,
		onAddTask,
		onRemoveTask,
		onMoveTask,
		onUpdateFrequency,
		onUpdateScheduleInputTime,
		onUpdateResetWeekday,
		onUpdateAnchorDate,
		onClearLinkKeyError,
		onCancel,
		onSave
	}: {
		checklist: Checklist;
		openSectionIds: string[];
		editingErrors: EditingErrors;
		frequencies: Frequency[];
		now: Date;
		onAddSection: () => void;
		onRemoveSection: (sectionId: string) => void;
		onMoveSection: (sectionId: string, direction: -1 | 1) => void;
		onAddTask: (section: ChecklistSection) => void;
		onRemoveTask: (section: ChecklistSection, taskId: string) => void;
		onMoveTask: (section: ChecklistSection, taskId: string, direction: -1 | 1) => void;
		onUpdateFrequency: (section: ChecklistSection, frequency: Frequency) => void;
		onUpdateScheduleInputTime: (section: ChecklistSection, resetTimeUtc: string) => void;
		onUpdateResetWeekday: (section: ChecklistSection, resetWeekday: Weekday) => void;
		onUpdateAnchorDate: (section: ChecklistSection, anchorDate: string) => void;
		onClearLinkKeyError: () => void;
		onCancel: () => void;
		onSave: () => void;
	} = $props();

	let scheduleTimeModes = $state<Record<string, ScheduleTimeMode>>({});

	function updateOpenSections(details: { value: string[] }): void {
		openSectionIds = details.value;
	}

	function isSelectableFrequency(frequency: Frequency): boolean {
		return import.meta.env.DEV || !devFrequencySet.has(frequency);
	}

	function dateInputMinForWeekday(weekday: Weekday): string {
		return alignDateToWeekday('1970-01-01', weekday);
	}

	function scheduleTimeMode(section: ChecklistSection): ScheduleTimeMode {
		return scheduleTimeModes[section.id] ?? 'utc';
	}

	function updateEditorScheduleTimeMode(section: ChecklistSection, timeMode: ScheduleTimeMode): void {
		scheduleTimeModes = {
			...scheduleTimeModes,
			[section.id]: timeMode
		};
	}

	function updateScheduleInputTime(section: ChecklistSection, time: string): void {
		onUpdateScheduleInputTime(
			section,
			scheduleInputTimeToUtc(time, scheduleTimeMode(section), now)
		);
	}

</script>

<section class="rounded-container border border-surface-800 bg-surface-900 p-5 shadow-sm">
	<form class="flex flex-col gap-5" onsubmit={(event) => event.preventDefault()}>
		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="text-lg font-semibold text-surface-50">Checklist editor</h2>
				<p class="text-sm text-surface-400">Changes save locally in this browser.</p>
			</div>
			<button
				class="btn-icon btn-icon-sm preset-tonal-surface"
				type="button"
				title="Cancel editing"
				aria-label="Cancel editing"
				onclick={onCancel}
			>
				x
			</button>
		</div>

		<label class="label">
			<span class="label-text">Name</span>
			<input class="input" bind:value={checklist.name} placeholder="Checklist name" />
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
				oninput={onClearLinkKeyError}
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
								onclick={() => onMoveSection(section.id, -1)}
							>
								<ArrowUp size={16} aria-hidden="true" />
							</button>
							<button
								class="btn-icon btn-icon-sm preset-tonal-surface"
								type="button"
								title="Move section down"
								aria-label="Move section down"
								disabled={sectionIndex === checklist.sections.length - 1}
								onclick={() => onMoveSection(section.id, 1)}
							>
								<ArrowDown size={16} aria-hidden="true" />
							</button>
							<button
								class="btn-icon btn-icon-sm preset-tonal-error"
								type="button"
								title="Delete section"
								aria-label="Delete section"
								onclick={() => onRemoveSection(section.id)}
							>
								<Trash2 size={16} aria-hidden="true" />
							</button>
						</div>
					</div>

					<Accordion.ItemContent class="p-4">
						<div class="mb-3">
							<label class="label">
								<span class="label-text">Section name</span>
								<input class="input" bind:value={section.name} placeholder="Daily" />
							</label>
						</div>

						<div
							class={`grid gap-3 ${section.schedule.frequency === 'minutely' ? '' : 'sm:grid-cols-2'}`}
						>
							<label class="label">
								<span class="label-text">Frequency</span>
								<select
									class="select"
									value={section.schedule.frequency}
									onchange={(event) =>
										onUpdateFrequency(section, event.currentTarget.value as Frequency)}
								>
									{#each frequencies as frequency}
										{#if isSelectableFrequency(frequency)}
											<option value={frequency}>{titleCase(frequency)}</option>
										{/if}
									{/each}
								</select>
							</label>

							{#if section.schedule.frequency !== 'minutely'}
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
										onchange={(event) => updateScheduleInputTime(section, event.currentTarget.value)}
									/>
									<span class="text-xs text-surface-400">
										Local {scheduleInputTime(section.schedule, now, 'local')}
										/ UTC {section.schedule.resetTimeUtc}
									</span>
								</div>
							{/if}
						</div>

						{#if section.schedule.frequency === 'weekly' || section.schedule.frequency === 'biweekly'}
							<div class="mt-3 grid gap-3 sm:grid-cols-2">
								<label class="label">
									<span class="label-text">Reset weekday</span>
									<select
										class="select"
										value={section.schedule.resetWeekday}
										onchange={(event) =>
											onUpdateResetWeekday(section, event.currentTarget.value as Weekday)}
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
											value={section.schedule.anchorDate}
											onchange={(event) => onUpdateAnchorDate(section, event.currentTarget.value)}
										/>
										<span class="text-xs text-surface-400">
											Only the selected reset weekday is valid.
										</span>
									</label>
								{/if}
							</div>
						{/if}

						{#if section.schedule.frequency === 'minutely'}
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
												onclick={() => onMoveTask(section, task.id, -1)}
											>
												<ArrowUp size={16} aria-hidden="true" />
											</button>
											<button
												class="btn-icon btn-icon-sm preset-tonal-surface"
												type="button"
												title="Move task down"
												aria-label="Move task down"
												disabled={taskIndex === section.tasks.length - 1}
												onclick={() => onMoveTask(section, task.id, 1)}
											>
												<ArrowDown size={16} aria-hidden="true" />
											</button>
											<button
												class="btn-icon btn-icon-sm preset-tonal-error"
												type="button"
												title="Delete task"
												aria-label="Delete task"
												onclick={() => onRemoveTask(section, task.id)}
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
								onclick={() => onAddTask(section)}
							>
								<Plus size={16} aria-hidden="true" />
								Task
							</button>
						</div>
					</Accordion.ItemContent>
				</Accordion.Item>
			{/each}
		</Accordion>

		<button class="btn btn-sm preset-tonal-primary self-end" type="button" onclick={onAddSection}>
			<Plus size={16} aria-hidden="true" />
			Section
		</button>

		<div class="flex justify-end gap-2 border-t border-surface-800 pt-4">
			<button class="btn preset-tonal-surface" type="button" onclick={onCancel}>Cancel</button>
			<button class="btn preset-filled-success-500" type="button" onclick={onSave}>
				<Save size={18} aria-hidden="true" />
				Save
			</button>
		</div>
	</form>
</section>
