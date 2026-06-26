<script lang="ts">
	import { appState } from '$lib/appState.svelte';
	import type {
		ChecklistSection,
		ChecklistTask,
		CompletionRecord,
		RecurringSchedule
	} from '$lib/checklists';
	import {
		countAvailableResetWindowsSince,
		describeSchedule,
		formatLocalReset,
		formatWeekdayList,
		getNextReset,
		getResetWindowStart,
		intervalCompletionExpiresAt,
		scheduleAvailability,
		scheduleResetTimeUtc,
		utcTimeToLocalTime
	} from '$lib/date-time';

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

	type BankedTaskStatus = {
		available: number;
		capacity: number;
		lastAccruedAt?: string;
	};

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

		if (taskHasCarryover()) {
			const status = bankedTaskStatus(record);
			if (status.available <= 0) return;

			appState.completions[checklistId][section.id][task.id] = {
				...record,
				completedAt,
				completionLog: appendCompletion(record, completedAt),
				availableCount: status.available - 1,
				lastAccruedAt: status.lastAccruedAt
			};
		} else {
			const completionCount = taskCompletionCount(record);
			if (completionCount >= taskRepeatCount()) return;

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
		if (taskHasCarryover()) return bankedTaskStatus(completion).available <= 0;

		return taskCompletionCount(completion) >= taskRepeatCount();
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
		if (taskHasCarryover()) {
			const status = bankedTaskStatus(completion);
			const done = bankedCompletionCount(status, completion);
			return `${done}/${status.capacity}`;
		}

		return `${taskCompletionCount(completion)}/${taskRepeatCount()}`;
	}

	function taskUsesUnitControls(): boolean {
		return taskRepeatCount() > 1 || taskHasCarryover();
	}

	function taskRepeatCount(): number {
		return positiveInteger(task.repeatCount);
	}

	function taskCarryoverCapacity(): number {
		return Math.max(taskRepeatCount(), positiveInteger(task.maxCarryover));
	}

	function taskHasCarryover(): boolean {
		return taskCarryoverCapacity() > taskRepeatCount();
	}

	function positiveInteger(value: number | undefined): number {
		return Math.max(1, Math.floor(value ?? 1));
	}

	function taskCompletionCount(record: CompletionRecord | undefined): number {
		return completionLog(record).filter((completedAt) => completionCountsForSchedule(completedAt))
			.length;
	}

	function completionCountsForSchedule(completedAtValue: string): boolean {
		const completedAt = new Date(completedAtValue);
		if (Number.isNaN(completedAt.getTime())) return false;

		if (schedule.frequency === 'interval' && schedule.intervalMode === 'completion') {
			const expiresAt = intervalCompletionExpiresAt(schedule, completedAt);
			return expiresAt !== null && expiresAt > now;
		}

		const windowStart = getResetWindowStart(schedule, now);
		return windowStart !== null && completedAt >= windowStart;
	}

	function completionLog(record: CompletionRecord | undefined): string[] {
		if (!record) return [];

		const values = Array.isArray(record.completionLog) ? record.completionLog : [];
		const log = values.filter((value) => typeof value === 'string');
		if (record.completedAt && log.length === 0) return [record.completedAt];

		return log;
	}

	function appendCompletion(record: CompletionRecord | undefined, completedAt: string): string[] {
		return [...completionLog(record), completedAt].slice(-100);
	}

	function bankedTaskStatus(record: CompletionRecord | undefined): BankedTaskStatus {
		const repeatCount = taskRepeatCount();
		const capacity = taskCarryoverCapacity();
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

		const elapsedWindows = countAvailableResetWindowsSince(schedule, lastAccruedAt, windowStart);
		available = Math.min(capacity, available + elapsedWindows * repeatCount);

		return {
			available,
			capacity,
			lastAccruedAt: windowStart.toISOString()
		};
	}

	function bankedCompletionCount(
		status: BankedTaskStatus,
		record: CompletionRecord | undefined
	): number {
		if (!status.lastAccruedAt) return completionLog(record).length;

		const accruedAt = new Date(status.lastAccruedAt);
		if (Number.isNaN(accruedAt.getTime())) return 0;

		return completionLog(record).filter((completedAt) => {
			const date = new Date(completedAt);
			return !Number.isNaN(date.getTime()) && date >= accruedAt;
		}).length;
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
		if (scheduleResetTimeUtc(schedule) !== scheduleResetTimeUtc(section.defaultSchedule))
			return false;

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

		const utcTime = scheduleResetTimeUtc(scheduleValue);
		const localTime = utcTimeToLocalTime(utcTime, reference);
		const resetTime = `${localTime} local / ${utcTime} UTC`;

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
			...(scheduleValue.availableStartTimeUtc && scheduleValue.availableEndTimeUtc
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
		if (!scheduleValue.availableStartTimeUtc || !scheduleValue.availableEndTimeUtc) return '';

		const localStart = utcTimeToLocalTime(scheduleValue.availableStartTimeUtc, reference);
		const localEnd = utcTimeToLocalTime(scheduleValue.availableEndTimeUtc, reference);
		const utcWindow = `${scheduleValue.availableStartTimeUtc} - ${scheduleValue.availableEndTimeUtc} UTC`;
		const localWindow = `${localStart} - ${localEnd} local`;

		return localWindow === utcWindow.replace(' UTC', '')
			? utcWindow
			: `${localWindow} / ${utcWindow}`;
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
