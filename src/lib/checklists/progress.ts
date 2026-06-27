import {
	countAvailableResetWindowsSince,
	getResetWindowStart,
	intervalCompletionExpiresAt
} from '../date-time';
import type { ChecklistTask, CompletionRecord, RecurringSchedule } from './types';

export type BankedTaskStatus = {
	available: number;
	capacity: number;
	lastAccruedAt?: string;
};

export function taskRepeatCount(task: ChecklistTask): number {
	return positiveInteger(task.repeatCount);
}

export function taskCarryoverCapacity(task: ChecklistTask): number {
	return Math.max(taskRepeatCount(task), positiveInteger(task.maxCarryover));
}

export function taskHasCarryover(task: ChecklistTask): boolean {
	return taskCarryoverCapacity(task) > taskRepeatCount(task);
}

export function taskCompletionCount(
	schedule: RecurringSchedule,
	record: CompletionRecord | undefined,
	reference: Date
): number {
	return completionLog(record).filter((completedAt) =>
		completionCountsForSchedule(schedule, completedAt, reference)
	).length;
}

export function taskRemainingCount(
	task: ChecklistTask,
	schedule: RecurringSchedule,
	record: CompletionRecord | undefined,
	reference: Date
): number {
	if (taskHasCarryover(task)) return bankedTaskStatus(task, schedule, record, reference).available;

	return Math.max(0, taskRepeatCount(task) - taskCompletionCount(schedule, record, reference));
}

export function taskCounterCapacity(task: ChecklistTask): number {
	return taskHasCarryover(task) ? taskCarryoverCapacity(task) : taskRepeatCount(task);
}

export function taskIsDone(
	task: ChecklistTask,
	schedule: RecurringSchedule,
	record: CompletionRecord | undefined,
	reference: Date
): boolean {
	return taskRemainingCount(task, schedule, record, reference) <= 0;
}

export function completionLog(record: CompletionRecord | undefined): string[] {
	if (!record) return [];

	const values = Array.isArray(record.completionLog) ? record.completionLog : [];
	const log = values.filter((value) => typeof value === 'string');
	if (record.completedAt && log.length === 0) return [record.completedAt];

	return log;
}

export function appendCompletion(
	record: CompletionRecord | undefined,
	completedAt: string
): string[] {
	return [...completionLog(record), completedAt].slice(-100);
}

export function bankedTaskStatus(
	task: ChecklistTask,
	schedule: RecurringSchedule,
	record: CompletionRecord | undefined,
	reference: Date
): BankedTaskStatus {
	const repeatCount = taskRepeatCount(task);
	const capacity = taskCarryoverCapacity(task);
	const windowStart = getResetWindowStart(schedule, reference);
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

function positiveInteger(value: number | undefined): number {
	return Math.max(1, Math.floor(value ?? 1));
}
