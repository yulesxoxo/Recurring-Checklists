<script lang="ts">
	import type { ChecklistTask, CompletionRecord, RecurringSchedule } from '$lib/checklists';
	import {
		describeSchedule,
		formatLocalReset,
		getNextReset,
		intervalCompletionExpiresAt,
		scheduleResetTimeUtc,
		utcTimeToLocalTime
	} from '$lib/date-time';

	let {
		task,
		schedule,
		now,
		completion,
		rowClass,
		countLabel,
		onClick
	}: {
		task: ChecklistTask;
		schedule: RecurringSchedule;
		now: Date;
		completion?: CompletionRecord;
		rowClass: string;
		countLabel?: string;
		onClick: (event: MouseEvent) => void;
	} = $props();

	let customScheduleDisplay = $derived(customScheduleText());
	let resetDisplay = $derived(resetText());

	function customScheduleText(): string | undefined {
		return task.schedule ? `Custom schedule: ${describeViewSchedule(schedule, now)}` : undefined;
	}

	function resetText(): string | undefined {
		if (schedule.frequency === 'interval' && schedule.intervalMode === 'completion') {
			const clearTime = completionIntervalClearTime(schedule, completion);
			return clearTime ? `Resets: ${formatLocalReset(clearTime)}` : undefined;
		}

		return task.schedule
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

	function describeViewSchedule(scheduleValue: RecurringSchedule, reference: Date): string {
		if (scheduleValue.frequency === 'interval') return describeSchedule(scheduleValue);

		const utcTime = scheduleResetTimeUtc(scheduleValue);
		const localTime = utcTimeToLocalTime(utcTime, reference);
		const resetTime = `${localTime} local / ${utcTime} UTC`;

		switch (scheduleValue.frequency) {
			case 'daily':
				return `Resets daily at ${resetTime}`;
			case 'weekly':
				return `Resets every ${titleCase(scheduleValue.resetWeekday ?? 'monday')} at ${resetTime}`;
			case 'biweekly':
				return `Resets every other ${titleCase(scheduleValue.resetWeekday ?? 'monday')} at ${resetTime}`;
		}
	}

	function titleCase(value: string): string {
		return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
	}
</script>

<button
	type="button"
	class={`flex w-full cursor-pointer select-none gap-3 rounded-base border p-3 text-left transition ${rowClass}`}
	onclick={onClick}
>
	<span class="min-w-0 flex-1">
		<span class="flex flex-wrap items-center gap-2">
			<span class="font-medium text-surface-50">{task.title}</span>
			{#if countLabel}
				<span class="badge preset-tonal-primary">{countLabel}</span>
			{/if}
		</span>
		{#if task.notes}
			<span class="mt-1 block text-sm text-surface-400">{task.notes}</span>
		{/if}
		{#if customScheduleDisplay}
			<span class="mt-2 block text-xs text-surface-400">{customScheduleDisplay}</span>
		{/if}
		{#if resetDisplay}
			<span class="mt-1 block text-xs text-surface-400">{resetDisplay}</span>
		{/if}
	</span>
</button>
