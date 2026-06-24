import type { RecurringSchedule, Weekday } from './checklists/types';

export type ScheduleTimeMode = 'local' | 'utc';

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const minuteMs = 60 * 1000;
const weekdayIndex: Record<Weekday, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6
};

export function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

export function alignDateToWeekday(dateValue: string, weekday: Weekday): string {
	const date = parseUtcDateInput(dateValue) ?? parseUtcDateInput(todayUtc());
	if (!date) return todayUtc();

	const daysToAdd = (weekdayIndex[weekday] - date.getUTCDay() + 7) % 7;
	date.setUTCDate(date.getUTCDate() + daysToAdd);

	return date.toISOString().slice(0, 10);
}

export function getResetWindowStart(schedule: RecurringSchedule, now = new Date()): Date | null {
	const { hours, minutes } = parseResetTime(schedule.resetTimeUtc);

	if (schedule.frequency === 'minutely') {
		return new Date(Math.floor(now.getTime() / minuteMs) * minuteMs);
	}

	if (schedule.frequency === 'hourly') {
		const candidate = new Date(
			Date.UTC(
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate(),
				now.getUTCHours(),
				minutes
			)
		);
		return candidate > now ? new Date(candidate.getTime() - hourMs) : candidate;
	}

	if (schedule.frequency === 'daily') {
		const candidate = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes)
		);
		return candidate > now ? addDays(candidate, -1) : candidate;
	}

	if (schedule.frequency === 'weekly') {
		return getWeeklyWindowStart(schedule, now, 7);
	}

	return getBiweeklyWindowStart(schedule, now);
}

export function getNextReset(schedule: RecurringSchedule, now = new Date()): Date | null {
	const windowStart = getResetWindowStart(schedule, now);
	if (!windowStart) return null;

	switch (schedule.frequency) {
		case 'minutely':
			return new Date(windowStart.getTime() + minuteMs);
		case 'hourly':
			return new Date(windowStart.getTime() + hourMs);
		case 'daily':
			return addDays(windowStart, 1);
		case 'weekly':
			return addDays(windowStart, 7);
		case 'biweekly':
			return addDays(windowStart, 14);
	}
}

export function describeSchedule(schedule: RecurringSchedule): string {
	const time = normalizeResetTime(schedule.resetTimeUtc);

	switch (schedule.frequency) {
		case 'minutely':
			return 'Resets every minute';
		case 'hourly':
			return `Resets hourly at minute ${time.slice(3)} UTC`;
		case 'daily':
			return `Resets daily at ${time} UTC`;
		case 'weekly':
			return `Resets every ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC`;
		case 'biweekly':
			return `Resets every other ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC`;
	}
}

export function formatUtcReset(date: Date | null): string {
	return formatResetDate(date, 'UTC');
}

export function formatLocalReset(date: Date | null): string {
	return formatResetDate(date);
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

export function parseUtcDateInput(dateValue: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month, day));

	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
		return null;
	}

	return date;
}

function getWeeklyWindowStart(schedule: RecurringSchedule, now: Date, intervalDays: 7): Date {
	const { hours, minutes } = parseResetTime(schedule.resetTimeUtc);
	const resetWeekday = weekdayIndex[schedule.resetWeekday ?? 'monday'];
	const currentWeekday = now.getUTCDay();
	const daysSinceResetWeekday = (currentWeekday - resetWeekday + 7) % 7;
	const candidate = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes)
	);
	candidate.setUTCDate(candidate.getUTCDate() - daysSinceResetWeekday);

	return candidate > now ? addDays(candidate, -intervalDays) : candidate;
}

function getBiweeklyWindowStart(schedule: RecurringSchedule, now: Date): Date | null {
	if (!schedule.anchorDate) return null;

	const { hours, minutes } = parseResetTime(schedule.resetTimeUtc);
	const anchor = parseAnchorDate(schedule.anchorDate, hours, minutes);
	if (!anchor) return null;

	const resetWeekday = weekdayIndex[schedule.resetWeekday ?? 'monday'];
	if (anchor.getUTCDay() !== resetWeekday) return null;

	const cyclesSinceAnchor = Math.floor((now.getTime() - anchor.getTime()) / (14 * dayMs));
	let candidate = addDays(anchor, cyclesSinceAnchor * 14);
	if (candidate > now) candidate = addDays(candidate, -14);

	return candidate;
}

function parseAnchorDate(anchorDate: string, hours: number, minutes: number): Date | null {
	const date = parseUtcDateInput(anchorDate);
	if (!date) return null;

	date.setUTCHours(hours, minutes, 0, 0);
	return date;
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * dayMs);
}

function formatTimeParts(hours: number, minutes: number): string {
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function titleCase(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
