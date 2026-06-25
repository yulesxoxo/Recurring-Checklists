<script lang="ts">
	import { CheckCircle2 } from '@lucide/svelte';
	import {
		type AppState,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type CompletionRecord,
		type RecurringSchedule,
		countTasks
	} from '$lib/checklists';
	import {
		describeSchedule,
		formatLocalReset,
		getNextReset,
		getResetWindowStart,
		intervalCompletionExpiresAt,
		scheduleResetTimeUtc,
		utcTimeToLocalTime
	} from '$lib/date-time';

	let {
		appState = $bindable<AppState>(),
		checklist,
		now = $bindable<Date>(),
		onPersist
	}: {
		appState: AppState;
		checklist: Checklist;
		now: Date;
		onPersist: () => void;
	} = $props();

	function toggleTask(section: ChecklistSection, task: ChecklistTask, checked: boolean): void {
		appState.completions[checklist.id] ??= {};
		appState.completions[checklist.id][section.id] ??= {};

		if (checked) {
			appState.completions[checklist.id][section.id][task.id] = {
				completedAt: new Date().toISOString()
			};
		} else {
			delete appState.completions[checklist.id][section.id][task.id];
		}

		now = new Date();
		onPersist();
	}

	function taskIsDone(section: ChecklistSection, task: ChecklistTask): boolean {
		return isTaskComplete(
			effectiveTaskSchedule(section, task),
			getCompletion(checklist.id, section.id, task.id),
			now
		);
	}

	function getCompletion(
		checklistId: string,
		sectionId: string,
		taskId: string
	): CompletionRecord | undefined {
		return appState.completions[checklistId]?.[sectionId]?.[taskId];
	}

	function isTaskComplete(
		schedule: RecurringSchedule,
		record: CompletionRecord | undefined,
		reference: Date
	): boolean {
		if (!record) return false;

		const completedAt = new Date(record.completedAt);
		if (Number.isNaN(completedAt.getTime())) return false;

		if (schedule.frequency === 'interval' && schedule.intervalMode === 'completion') {
			const expiresAt = intervalCompletionExpiresAt(schedule, completedAt);
			return expiresAt !== null && expiresAt > reference;
		}

		const windowStart = getResetWindowStart(schedule, reference);

		return windowStart !== null && completedAt >= windowStart;
	}

	function sectionProgress(section: ChecklistSection): { done: number; total: number } {
		return {
			done: section.tasks.filter((task) => taskIsDone(section, task)).length,
			total: section.tasks.length
		};
	}

	function effectiveTaskSchedule(
		section: ChecklistSection,
		task: ChecklistTask
	): RecurringSchedule {
		return task.schedule ?? section.defaultSchedule;
	}

	function completionDate(record: CompletionRecord | undefined): Date | null {
		if (!record) return null;

		const completedAt = new Date(record.completedAt);
		return Number.isNaN(completedAt.getTime()) ? null : completedAt;
	}

	function completionIntervalClearTime(
		schedule: RecurringSchedule,
		record: CompletionRecord | undefined
	): Date | null {
		const completedAt = completionDate(record);
		return completedAt ? intervalCompletionExpiresAt(schedule, completedAt) : null;
	}

	function describeViewSchedule(schedule: RecurringSchedule, reference: Date): string {
		if (schedule.frequency === 'interval') return describeSchedule(schedule);

		const utcTime = scheduleResetTimeUtc(schedule);
		const localTime = utcTimeToLocalTime(utcTime, reference);
		const resetTime = `${localTime} local / ${utcTime} UTC`;

		switch (schedule.frequency) {
			case 'daily':
				return `Resets daily at ${resetTime}`;
			case 'weekly':
				return `Resets every ${titleCase(schedule.resetWeekday ?? 'monday')} at ${resetTime}`;
			case 'biweekly':
				return `Resets every other ${titleCase(schedule.resetWeekday ?? 'monday')} at ${resetTime}`;
		}
	}

	function titleCase(value: string): string {
		return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
	}
</script>

<div class="grid gap-6">
	<div class="flex justify-end">
		<span class="badge preset-tonal-primary">{countTasks(checklist)} tasks</span>
	</div>

	<div class="grid gap-5">
		{#each checklist.sections as section (section.id)}
			{@const progress = sectionProgress(section)}
			<section class="rounded-container border border-surface-800 bg-surface-900 p-4 shadow-sm">
				<div
					class="flex flex-col gap-3 border-b border-surface-800 pb-4 md:flex-row md:items-start md:justify-between"
				>
					<div class="min-w-0">
						<h2 class="text-xl font-semibold text-surface-50">{section.name}</h2>
						<p class="mt-1 text-sm text-surface-400">
							{describeViewSchedule(section.defaultSchedule, now)}
						</p>
						{#if !(section.defaultSchedule.frequency === 'interval' && section.defaultSchedule.intervalMode === 'completion')}
							<p class="mt-1 text-xs text-surface-400">
								Next reset: {formatLocalReset(getNextReset(section.defaultSchedule, now))}
							</p>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<span class="badge preset-tonal-success">
							<CheckCircle2 size={14} aria-hidden="true" />
							{progress.done} / {progress.total} done
						</span>
					</div>
				</div>

				<div class="mt-4 grid gap-3">
					{#if section.tasks.length === 0}
						<p
							class="rounded-base border border-dashed border-surface-700 p-4 text-sm text-surface-400"
						>
							This section has no tasks.
						</p>
					{:else}
						{#each section.tasks as task (task.id)}
							{@const schedule = effectiveTaskSchedule(section, task)}
							{@const completion = getCompletion(checklist.id, section.id, task.id)}
							{@const clearTime = completionIntervalClearTime(schedule, completion)}
							<label
								class="flex cursor-pointer gap-3 rounded-base border border-surface-800 bg-surface-950 p-3 transition hover:bg-surface-800"
							>
								<input
									class="checkbox mt-1"
									type="checkbox"
									checked={taskIsDone(section, task)}
									onchange={(event) => toggleTask(section, task, event.currentTarget.checked)}
								/>
								<span class="min-w-0 flex-1">
									<span class="block font-medium text-surface-50">{task.title}</span>
									{#if task.notes}
										<span class="mt-1 block text-sm text-surface-400">{task.notes}</span>
									{/if}
									{#if task.schedule}
										<span class="mt-2 block text-xs text-surface-400">
											Custom schedule: {describeViewSchedule(schedule, now)}
										</span>
									{/if}
									{#if schedule.frequency === 'interval' && schedule.intervalMode === 'completion'}
										{#if clearTime}
											<span class="mt-1 block text-xs text-surface-400">
												Resets: {formatLocalReset(clearTime)}
											</span>
										{/if}
									{:else if task.schedule}
										<span class="mt-1 block text-xs text-surface-400">
											Next reset: {formatLocalReset(getNextReset(schedule, now))}
										</span>
									{/if}
								</span>
							</label>
						{/each}
					{/if}
				</div>
			</section>
		{/each}
	</div>
</div>
