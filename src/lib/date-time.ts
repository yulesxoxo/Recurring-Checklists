import type { RecurringSchedule } from './checklists/types';

export type ScheduleTimeMode = 'local' | 'utc';

export function formatUtcReset(date: Date | null): string {
	return formatResetDate(date, 'UTC');
}

export function formatLocalReset(date: Date | null): string {
	return formatResetDate(date);
}

export function formatResetPair(date: Date | null): string {
	return `Local: ${formatLocalReset(date)} | UTC: ${formatUtcReset(date)}`;
}

export function formatResetDate(date: Date | null, timeZone: string | undefined = undefined): string {
	if (!date) return 'Not scheduled';

	const formatter = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		...(timeZone ? { timeZone } : {}),
		timeZoneName: 'short'
	});

	return formatter.format(date);
}

export function scheduleInputTime(
	schedule: RecurringSchedule,
	reference: Date,
	timeMode: ScheduleTimeMode = 'utc'
): string {
	return timeMode === 'local'
		? utcTimeToLocalTime(schedule.resetTimeUtc, reference)
		: normalizeResetTime(schedule.resetTimeUtc);
}

export function utcTimeToLocalTime(time: string, reference = new Date()): string {
	const { hours, minutes } = parseResetTime(time);
	const utcDate = new Date(
		Date.UTC(
			reference.getUTCFullYear(),
			reference.getUTCMonth(),
			reference.getUTCDate(),
			hours,
			minutes
		)
	);

	return formatTimeParts(utcDate.getHours(), utcDate.getMinutes());
}

export function localTimeToUtcTime(time: string, reference = new Date()): string {
	const { hours, minutes } = parseResetTime(time);
	const localDate = new Date(
		reference.getFullYear(),
		reference.getMonth(),
		reference.getDate(),
		hours,
		minutes
	);

	return formatTimeParts(localDate.getUTCHours(), localDate.getUTCMinutes());
}

export function scheduleInputTimeToUtc(
	time: string,
	timeMode: ScheduleTimeMode,
	reference = new Date()
): string {
	return timeMode === 'local' ? localTimeToUtcTime(time, reference) : normalizeResetTime(time);
}

export function normalizeResetTime(time: string): string {
	const { hours, minutes } = parseResetTime(time);
	return formatTimeParts(hours, minutes);
}

export function parseResetTime(time: string): { hours: number; minutes: number } {
	const match = /^(\d{2}):(\d{2})$/.exec(time);
	if (!match) return { hours: 5, minutes: 0 };

	const hours = Number(match[1]);
	const minutes = Number(match[2]);

	if (hours > 23 || minutes > 59) return { hours: 5, minutes: 0 };
	return { hours, minutes };
}

export function isValidResetTime(time: string): boolean {
	const match = /^(\d{2}):(\d{2})$/.exec(time);
	if (!match) return false;

	const hours = Number(match[1]);
	const minutes = Number(match[2]);

	return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function formatTimeParts(hours: number, minutes: number): string {
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}
