<script lang="ts">
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { CheckCircle2 } from '@lucide/svelte';
	import ChecklistTaskButton from './ChecklistTaskButton.svelte';
	import { appState } from '$lib/appState.svelte';
	import {
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
		checklist,
		now = $bindable<Date>()
	}: {
		checklist: Checklist;
		now: Date;
	} = $props();

	type BankedTaskStatus = {
		available: number;
		capacity: number;
		lastAccruedAt?: string;
	};

	let hideCompletedTasks = $state(true);

	function taskIsDone(section: ChecklistSection, task: ChecklistTask): boolean {
		const record = getCompletion(checklist.id, section.id, task.id);
		if (taskHasCarryover(task)) return bankedTaskStatus(section, task, record).available <= 0;

		return (
			taskCompletionCount(effectiveTaskSchedule(section, task), record, now) >=
			taskRepeatCount(task)
		);
	}

	function getCompletion(
		checklistId: string,
		sectionId: string,
		taskId: string
	): CompletionRecord | undefined {
		return appState.completions[checklistId]?.[sectionId]?.[taskId];
	}

	function sectionProgress(section: ChecklistSection): { done: number; total: number } {
		return {
			done: section.tasks.filter((task) => taskIsDone(section, task)).length,
			total: section.tasks.length
		};
	}

	function visibleTasks(section: ChecklistSection): ChecklistTask[] {
		return hideCompletedTasks
			? section.tasks.filter((task) => !taskIsDone(section, task))
			: section.tasks;
	}

	function effectiveTaskSchedule(
		section: ChecklistSection,
		task: ChecklistTask
	): RecurringSchedule {
		return task.schedule ?? section.defaultSchedule;
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

	function taskRepeatCount(task: ChecklistTask): number {
		return positiveInteger(task.repeatCount);
	}

	function taskCarryoverCapacity(task: ChecklistTask): number {
		return Math.max(taskRepeatCount(task), positiveInteger(task.maxCarryover));
	}

	function taskHasCarryover(task: ChecklistTask): boolean {
		return taskCarryoverCapacity(task) > taskRepeatCount(task);
	}

	function positiveInteger(value: number | undefined): number {
		return Math.max(1, Math.floor(value ?? 1));
	}

	function taskCompletionCount(
		schedule: RecurringSchedule,
		record: CompletionRecord | undefined,
		reference: Date
	): number {
		return completionLog(record).filter((completedAt) =>
			completionCountsForSchedule(schedule, completedAt, reference)
		).length;
	}

	function completionCountsForSchedule(
		schedule: RecurringSchedule,
		completedAtValue: string,
		reference: Date
	): boolean {
		const completedAt = new Date(completedAtValue);
		if (Number.isNaN(completedAt.getTime())) return false;

		if (schedule.frequency === 'interval' && schedule.intervalMode === 'completion') {
			const expiresAt = intervalCompletionExpiresAt(schedule, completedAt);
			return expiresAt !== null && expiresAt > reference;
		}

		const windowStart = getResetWindowStart(schedule, reference);
		return windowStart !== null && completedAt >= windowStart;
	}

	function completionLog(record: CompletionRecord | undefined): string[] {
		if (!record) return [];

		const values = Array.isArray(record.completionLog) ? record.completionLog : [];
		const log = values.filter((value) => typeof value === 'string');
		if (record.completedAt && log.length === 0) return [record.completedAt];

		return log;
	}

	function bankedTaskStatus(
		section: ChecklistSection,
		task: ChecklistTask,
		record: CompletionRecord | undefined
	): BankedTaskStatus {
		const schedule = effectiveTaskSchedule(section, task);
		const repeatCount = taskRepeatCount(task);
		const capacity = taskCarryoverCapacity(task);
		const windowStart = getResetWindowStart(schedule, now);
		const lastAccruedAt = record?.lastAccruedAt ?? windowStart?.toISOString();
		let available =
			typeof record?.availableCount === 'number' && Number.isFinite(record.availableCount)
				? Math.max(0, Math.floor(record.availableCount))
				: capacity;

		if (!windowStart || !lastAccruedAt) {
			return {
				available: Math.min(capacity, available),
				capacity,
				lastAccruedAt
			};
		}

		const elapsedWindows = countResetWindowsSince(schedule, lastAccruedAt, windowStart);
		available = Math.min(capacity, available + elapsedWindows * repeatCount);

		return {
			available,
			capacity,
			lastAccruedAt: windowStart.toISOString()
		};
	}

	function countResetWindowsSince(
		schedule: RecurringSchedule,
		lastAccruedAtValue: string,
		currentWindowStart: Date
	): number {
		const lastAccruedAt = new Date(lastAccruedAtValue);
		if (Number.isNaN(lastAccruedAt.getTime())) return 0;

		let count = 0;
		let cursor = getNextReset(schedule, lastAccruedAt);
		while (cursor && cursor <= currentWindowStart && count < 10000) {
			count += 1;
			cursor = getNextReset(schedule, new Date(cursor.getTime() + 1));
		}

		return count;
	}

	function updateHideCompleted(details: { checked: boolean }): void {
		hideCompletedTasks = details.checked;
	}
</script>

<div class="grid gap-6">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<Switch checked={hideCompletedTasks} onCheckedChange={updateHideCompleted}>
			<Switch.Control>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.Label>Hide completed</Switch.Label>
			<Switch.HiddenInput />
		</Switch>
		<span class="badge preset-tonal-primary">{countTasks(checklist)} tasks</span>
	</div>

	<div class="grid gap-5">
		{#each checklist.sections as section (section.id)}
			{@const progress = sectionProgress(section)}
			{@const tasks = visibleTasks(section)}
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
					{:else if tasks.length === 0}
						<p
							class="rounded-base border border-dashed border-surface-700 p-4 text-sm text-surface-400"
						>
							All tasks in this section are completed.
						</p>
					{:else}
						{#each tasks as task (task.id)}
							<ChecklistTaskButton
								checklistId={checklist.id}
								{section}
								{task}
								bind:now
								hideCompleted={hideCompletedTasks}
							/>
						{/each}
					{/if}
				</div>
			</section>
		{/each}
	</div>
</div>
