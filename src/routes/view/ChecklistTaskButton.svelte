<script lang="ts">
	import { appState } from '$lib/appState.svelte';
	import type {
		ChecklistSection,
		ChecklistTask,
		CompletionRecord,
		RecurringSchedule
	} from '$lib/checklists';
	import {
		describeSchedule,
		formatLocalReset,
		formatWeekdayList,
		getNextReset,
		intervalCompletionExpiresAt,
		scheduleAvailability,
		scheduleResetTime,
		scheduleTimeBasis,
		localTimeToUtcTime,
		utcTimeToLocalTime
	} from '$lib/date-time';
	import {
		appendCompletion,
		bankedTaskStatus,
		taskCompletionCount,
		taskCounterCapacity,
		taskHasCarryover,
		taskIsDone as isTaskDone,
		taskRemainingCount,
		taskRepeatCount
	} from '$lib/checklists/progress';

	let {
		checklistId,
		section,
		task,
		now = $bindable<Date>(),
		hideCompleted
	}: {
		checklistId: string;
		section: ChecklistSection;
		task: ChecklistTask;
		now: Date;
		hideCompleted: boolean;
	} = $props();

	let schedule = $derived(task.schedule ?? section.defaultSchedule);
	let completion = $derived(appState.completions[checklistId]?.[section.id]?.[task.id]);
	let availability = $derived(scheduleAvailability(schedule, now));
	let isAvailable = $derived(availability.status === 'available');
	let isDone = $derived(taskIsDone());
	let rowClass = $derived(taskRowClass());
	let countLabel = $derived(taskUsesUnitControls() ? taskUnitStatus() : undefined);
	let availabilityBadge = $derived(availabilityBadgeText());
	let availabilityBadgeClass = $derived(availabilityBadgeStyle());
	let customScheduleDisplay = $derived(customScheduleText());
	let resetDisplay = $derived(resetText());

	function toggleTask(event: MouseEvent): void {
		event.preventDefault();
		if (!isAvailable) return;

		if (taskUsesUnitControls()) {
			toggleTaskUnit();
			return;
		}

		appState.completions[checklistId] ??= {};
		appState.completions[checklistId][section.id] ??= {};

		if (isDone) {
			delete appState.completions[checklistId][section.id][task.id];
		} else {
			const completedAt = new Date().toISOString();
			appState.completions[checklistId][section.id][task.id] = {
				completedAt,
				completionLog: [completedAt]
			};
		}

		now = new Date();
	}

	function toggleTaskUnit(): void {
		if (isDone) {
			resetTaskUnit();
			return;
		}

		completeTaskUnit();
	}

	function completeTaskUnit(): void {
		const record = completion ?? {};
		const completedAt = new Date().toISOString();

		appState.completions[checklistId] ??= {};
		appState.completions[checklistId][section.id] ??= {};

		if (taskHasCarryover(task)) {
			const status = bankedTaskStatus(task, schedule, record, now);
			if (status.available <= 0) return;

			appState.completions[checklistId][section.id][task.id] = {
				...record,
				completedAt,
				completionLog: appendCompletion(record, completedAt),
				availableCount: status.available - 1,
				lastAccruedAt: status.lastAccruedAt
			};
		} else {
			const completionCount = taskCompletionCount(schedule, record, now);
			if (completionCount >= taskRepeatCount(task)) return;

			appState.completions[checklistId][section.id][task.id] = {
				completedAt,
				completionLog: appendCompletion(record, completedAt)
			};
		}

		now = new Date();
	}

	function resetTaskUnit(): void {
		if (appState.completions[checklistId]?.[section.id]?.[task.id]) {
			delete appState.completions[checklistId][section.id][task.id];
		}

		now = new Date();
	}

	function taskIsDone(): boolean {
		return isTaskDone(task, schedule, completion, now);
	}

	function taskRowClass(): string {
		if (isDone && !hideCompleted) {
			return 'border-surface-800 bg-surface-900 opacity-60 hover:bg-surface-900';
		}

		if (availability.status === 'missed') {
			return 'cursor-not-allowed border-error-800 bg-error-950/20 opacity-85 hover:bg-error-950/20';
		}

		if (availability.status === 'upcoming') {
			return 'cursor-not-allowed border-primary-800 bg-primary-950/20 opacity-85 hover:bg-primary-950/20';
		}

		if (!isAvailable) {
			return 'cursor-not-allowed border-surface-700 bg-surface-950 opacity-45 hover:bg-surface-950';
		}

		return 'border-surface-800 bg-surface-950 hover:bg-surface-800';
	}

	function taskUnitStatus(): string {
		return `${taskRemainingCount(task, schedule, completion, now)}/${taskCounterCapacity(task)}`;
	}

	function taskUsesUnitControls(): boolean {
		return taskRepeatCount(task) > 1 || taskHasCarryover(task);
	}

	function customScheduleText(): string | undefined {
		if (!task.schedule) return undefined;

		return describeViewSchedule(schedule, now, !taskResetMatchesSectionDefault());
	}

	function availabilityBadgeText(): string | undefined {
		switch (availability.status) {
			case 'upcoming':
				return 'Upcoming';
			case 'missed':
				return isDone ? undefined : 'Missed';
			case 'unavailable':
				return 'Unavailable';
			case 'available':
				return undefined;
		}
	}

	function availabilityBadgeStyle(): string {
		switch (availability.status) {
			case 'upcoming':
				return 'preset-tonal-primary';
			case 'missed':
				return 'preset-tonal-error';
			default:
				return 'preset-tonal-surface';
		}
	}

	function resetText(): string | undefined {
		if (schedule.frequency === 'interval' && schedule.intervalMode === 'completion') {
			const clearTime = completionIntervalClearTime(schedule, completion);
			return clearTime ? `Resets: ${formatLocalReset(clearTime)}` : undefined;
		}

		return task.schedule && !taskResetMatchesSectionDefault()
			? `Next reset: ${formatLocalReset(getNextReset(schedule, now))}`
			: undefined;
	}

	function completionIntervalClearTime(
		scheduleValue: RecurringSchedule,
		record: CompletionRecord | undefined
	): Date | null {
		const completedAt = completionDate(record);
		return completedAt ? intervalCompletionExpiresAt(scheduleValue, completedAt) : null;
	}

	function completionDate(record: CompletionRecord | undefined): Date | null {
		if (!record?.completedAt) return null;

		const completedAt = new Date(record.completedAt);
		return Number.isNaN(completedAt.getTime()) ? null : completedAt;
	}

	function taskResetMatchesSectionDefault(): boolean {
		if (schedule.frequency !== section.defaultSchedule.frequency) return false;
		if (schedule.frequency === 'interval') return false;
		if (scheduleTimeBasis(schedule) !== scheduleTimeBasis(section.defaultSchedule)) return false;
		if (scheduleResetTime(schedule) !== scheduleResetTime(section.defaultSchedule)) return false;

		if (schedule.frequency === 'weekly' || schedule.frequency === 'biweekly') {
			return (
				(schedule.resetWeekday ?? 'monday') === (section.defaultSchedule.resetWeekday ?? 'monday')
			);
		}

		return true;
	}

	function describeViewSchedule(
		scheduleValue: RecurringSchedule,
		reference: Date,
		includeReset: boolean
	): string {
		if (scheduleValue.frequency === 'interval') return describeSchedule(scheduleValue);

		const resetTime = describeResetTime(scheduleValue, reference);

		switch (scheduleValue.frequency) {
			case 'daily':
				return `${describeDailyAvailability(scheduleValue, reference, includeReset)}${
					includeReset ? ` at ${resetTime}` : ''
				}`;
			case 'weekly':
				return `Resets every ${titleCase(scheduleValue.resetWeekday ?? 'monday')} at ${resetTime}`;
			case 'biweekly':
				return `Resets every other ${titleCase(scheduleValue.resetWeekday ?? 'monday')} at ${resetTime}`;
		}
	}

	function titleCase(value: string): string {
		return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
	}

	function describeDailyAvailability(
		scheduleValue: RecurringSchedule,
		reference: Date,
		includeReset: boolean
	): string {
		const descriptionParts = [
			...(scheduleValue.availableWeekdays?.length
				? [formatWeekdayList(scheduleValue.availableWeekdays)]
				: []),
			...(scheduleValue.availableStartTime && scheduleValue.availableEndTime
				? [describeAvailabilityTimeWindow(scheduleValue, reference)]
				: [])
		];
		if (descriptionParts.length === 0) return includeReset ? 'Resets daily' : '';

		return `Available ${descriptionParts.join(', ')}${includeReset ? '; resets' : ''}`;
	}

	function describeAvailabilityTimeWindow(
		scheduleValue: RecurringSchedule,
		reference: Date
	): string {
		if (!scheduleValue.availableStartTime || !scheduleValue.availableEndTime) return '';

		if (scheduleTimeBasis(scheduleValue) === 'local') {
			const utcStart = localTimeToUtcTime(scheduleValue.availableStartTime, reference);
			const utcEnd = localTimeToUtcTime(scheduleValue.availableEndTime, reference);
			return `${scheduleValue.availableStartTime} - ${scheduleValue.availableEndTime} local / ${utcStart} - ${utcEnd} UTC`;
		}

		const localStart = utcTimeToLocalTime(scheduleValue.availableStartTime, reference);
		const localEnd = utcTimeToLocalTime(scheduleValue.availableEndTime, reference);
		const utcWindow = `${scheduleValue.availableStartTime} - ${scheduleValue.availableEndTime} UTC`;
		const localWindow = `${localStart} - ${localEnd} local`;

		return localWindow === utcWindow.replace(' UTC', '')
			? utcWindow
			: `${localWindow} / ${utcWindow}`;
	}

	function describeResetTime(scheduleValue: RecurringSchedule, reference: Date): string {
		const time = scheduleResetTime(scheduleValue);
		if (scheduleTimeBasis(scheduleValue) === 'local') {
			return `${time} local / ${localTimeToUtcTime(time, reference)} UTC`;
		}

		return `${utcTimeToLocalTime(time, reference)} local / ${time} UTC`;
	}
</script>

<button
	type="button"
	class={`flex w-full cursor-pointer select-none gap-3 rounded-base border p-3 text-left transition ${rowClass}`}
	disabled={!isAvailable}
	onclick={toggleTask}
>
	<span class="min-w-0 flex-1">
		<span class="flex flex-wrap items-center gap-2">
			<span class="font-medium text-surface-50">{task.title}</span>
			{#if countLabel}
				<span class="badge preset-tonal-primary">{countLabel}</span>
			{/if}
			{#if availabilityBadge}
				<span class={`badge ${availabilityBadgeClass}`}>{availabilityBadge}</span>
			{/if}
		</span>
		{#if task.notes}
			<span class="mt-1 block whitespace-pre-line text-sm text-surface-400">{task.notes}</span>
		{/if}
		{#if customScheduleDisplay}
			<span class="mt-2 block text-xs text-surface-400">{customScheduleDisplay}</span>
		{/if}
		{#if resetDisplay}
			<span class="mt-1 block text-xs text-surface-400">{resetDisplay}</span>
		{/if}
	</span>
</button>
