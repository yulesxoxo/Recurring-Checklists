import { weekdays } from './checklists/constants';
import type { RecurringSchedule, Weekday } from './checklists/types';

export type ScheduleTimeMode = 'local' | 'utc';

const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60 * 1000;
const defaultIntervalMinutes = 60;
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
	const { hours, minutes } = parseResetTime(scheduleResetTimeUtc(schedule));

	if (schedule.frequency === 'interval') {
		if ((schedule.intervalMode ?? 'anchor') === 'completion') return null;
		return getIntervalWindowStart(schedule, now);
	}

	if (schedule.frequency === 'daily') {
		return getDailyWindowStart(schedule, now, hours, minutes);
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
		case 'daily':
			return getNextDailyReset(schedule, windowStart);
		case 'weekly':
			return addDays(windowStart, 7);
		case 'biweekly':
			return addDays(windowStart, 14);
		case 'interval':
			return new Date(windowStart.getTime() + intervalMinutes(schedule) * minuteMs);
	}
}

export function isScheduleAvailable(schedule: RecurringSchedule, now = new Date()): boolean {
	if (schedule.frequency !== 'daily' || !schedule.availableWeekdays?.length) return true;

	return schedule.availableWeekdays.includes(localWeekday(now));
}

export function countAvailableResetWindowsSince(
	schedule: RecurringSchedule,
	lastAccruedAtValue: string,
	currentWindowStart: Date
): number {
	const lastAccruedAt = new Date(lastAccruedAtValue);
	if (Number.isNaN(lastAccruedAt.getTime())) return 0;

	let count = 0;
	let cursor = getNextReset(schedule, lastAccruedAt);
	while (cursor && cursor <= currentWindowStart && count < 10000) {
		if (isScheduleAvailable(schedule, cursor)) count += 1;
		cursor = getNextReset(schedule, new Date(cursor.getTime() + 1));
	}

	return count;
}

export function intervalCompletionExpiresAt(
	schedule: RecurringSchedule,
	completedAt: Date
): Date | null {
	if (schedule.frequency !== 'interval' || (schedule.intervalMode ?? 'anchor') !== 'completion') {
		return null;
	}

	return new Date(completedAt.getTime() + intervalMinutes(schedule) * minuteMs);
}

export function describeSchedule(schedule: RecurringSchedule): string {
	const time = scheduleResetTimeUtc(schedule);

	switch (schedule.frequency) {
		case 'interval':
			return describeIntervalSchedule(schedule);
		case 'daily':
			return `${describeDailyAvailability(schedule)} at ${time} UTC`;
		case 'weekly':
			return `Resets every ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC`;
		case 'biweekly':
			return `Resets every other ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC`;
	}
}

export function formatWeekdayList(values: Weekday[]): string {
	const selected = new Set(values);
	const selectedWeekdays = weekdays.filter((weekday) => selected.has(weekday));
	const labels: string[] = [];

	for (let index = 0; index < selectedWeekdays.length; index += 1) {
		const start = selectedWeekdays[index];
		let end = start;
		let runLength = 1;

		while (
			index + 1 < selectedWeekdays.length &&
			weekdayOrder(selectedWeekdays[index + 1]) === weekdayOrder(end) + 1
		) {
			index += 1;
			end = selectedWeekdays[index];
			runLength += 1;
		}

		if (runLength >= 3) {
			labels.push(`${titleCase(start)} - ${titleCase(end)}`);
		} else if (runLength === 2) {
			labels.push(titleCase(start), titleCase(end));
		} else {
			labels.push(titleCase(start));
		}
	}

	if (labels.length === 1) return labels[0];
	if (labels.length === 2 && !labels.some((label) => label.includes(' - '))) {
		return `${labels[0]} and ${labels[1]}`;
	}
	if (labels.length === 2) return `${labels[0]}, ${labels[1]}`;

	return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function formatUtcReset(date: Date | null): string {
	return formatResetDate(date, 'UTC');
}

export function formatLocalReset(date: Date | null): string {
	return formatResetDate(date);
}

export function formatResetDate(
	date: Date | null,
	timeZone: string | undefined = undefined
): string {
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
		? utcTimeToLocalTime(scheduleResetTimeUtc(schedule), reference)
		: scheduleResetTimeUtc(schedule);
}

export function scheduleResetTimeUtc(schedule: RecurringSchedule): string {
	const dateTime = schedule.anchorDateTimeUtc
		? parseUtcDateTimeInput(schedule.anchorDateTimeUtc)
		: null;
	if (!dateTime) return '05:00';

	return formatTimeParts(dateTime.getUTCHours(), dateTime.getUTCMinutes());
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

export function normalizeUtcDateTimeInput(dateTimeValue: string): string | null {
	const date = parseUtcDateTimeInput(dateTimeValue);
	return date?.toISOString() ?? null;
}

export function utcDateTimeToInputValue(dateTimeValue: string | undefined): string {
	const date = dateTimeValue ? parseUtcDateTimeInput(dateTimeValue) : null;
	return (date ?? new Date()).toISOString().slice(0, 16);
}

export function parseUtcDateTimeInput(dateTimeValue: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{3})?)?(?:Z)?$/.exec(
		dateTimeValue
	);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const hours = Number(match[4]);
	const minutes = Number(match[5]);
	const seconds = match[6] ? Number(match[6]) : 0;

	if (hours > 23 || minutes > 59 || seconds > 59) return null;

	const date = new Date(Date.UTC(year, month, day, hours, minutes, seconds, 0));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month ||
		date.getUTCDate() !== day ||
		date.getUTCHours() !== hours ||
		date.getUTCMinutes() !== minutes ||
		date.getUTCSeconds() !== seconds
	) {
		return null;
	}

	return date;
}

export function normalizeIntervalMinutes(value: unknown): number {
	const numeric =
		typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(numeric)) return defaultIntervalMinutes;

	return Math.max(1, Math.floor(numeric));
}

function getWeeklyWindowStart(schedule: RecurringSchedule, now: Date, intervalDays: 7): Date {
	const { hours, minutes } = parseResetTime(scheduleResetTimeUtc(schedule));
	const resetWeekday = weekdayIndex[schedule.resetWeekday ?? 'monday'];
	const currentWeekday = now.getUTCDay();
	const daysSinceResetWeekday = (currentWeekday - resetWeekday + 7) % 7;
	const candidate = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes)
	);
	candidate.setUTCDate(candidate.getUTCDate() - daysSinceResetWeekday);

	return candidate > now ? addDays(candidate, -intervalDays) : candidate;
}

function getDailyWindowStart(
	schedule: RecurringSchedule,
	now: Date,
	hours: number,
	minutes: number
): Date {
	let candidate = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes)
	);
	if (candidate > now) candidate = addDays(candidate, -1);

	if (!schedule.availableWeekdays?.length) return candidate;

	for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
		if (isScheduleAvailable(schedule, candidate)) return candidate;
		candidate = addDays(candidate, -1);
	}

	return candidate;
}

function getNextDailyReset(schedule: RecurringSchedule, windowStart: Date): Date {
	let candidate = addDays(windowStart, 1);
	if (!schedule.availableWeekdays?.length) return candidate;

	for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
		if (isScheduleAvailable(schedule, candidate)) return candidate;
		candidate = addDays(candidate, 1);
	}

	return candidate;
}

function getBiweeklyWindowStart(schedule: RecurringSchedule, now: Date): Date | null {
	if (!schedule.anchorDateTimeUtc) return null;

	const anchor = parseUtcDateTimeInput(schedule.anchorDateTimeUtc);
	if (!anchor) return null;

	const resetWeekday = weekdayIndex[schedule.resetWeekday ?? 'monday'];
	if (anchor.getUTCDay() !== resetWeekday) return null;

	const cyclesSinceAnchor = Math.floor((now.getTime() - anchor.getTime()) / (14 * dayMs));
	let candidate = addDays(anchor, cyclesSinceAnchor * 14);
	if (candidate > now) candidate = addDays(candidate, -14);

	return candidate;
}

function getIntervalWindowStart(schedule: RecurringSchedule, now: Date): Date | null {
	if (!schedule.anchorDateTimeUtc) return null;

	const anchor = parseUtcDateTimeInput(schedule.anchorDateTimeUtc);
	if (!anchor) return null;

	const intervalMs = intervalMinutes(schedule) * minuteMs;
	const cyclesSinceAnchor = Math.floor((now.getTime() - anchor.getTime()) / intervalMs);
	let candidate = new Date(anchor.getTime() + cyclesSinceAnchor * intervalMs);
	if (candidate > now) candidate = new Date(candidate.getTime() - intervalMs);

	return candidate;
}

function intervalMinutes(schedule: RecurringSchedule): number {
	return normalizeIntervalMinutes(schedule.intervalMinutes);
}

function describeIntervalSchedule(schedule: RecurringSchedule): string {
	const totalMinutes = intervalMinutes(schedule);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	const duration =
		hours > 0 && minutes > 0
			? `${hours} hr ${minutes} min`
			: hours > 0
				? `${hours} hr`
				: `${minutes} min`;

	return (schedule.intervalMode ?? 'anchor') === 'completion'
		? `Resets ${duration} after completion`
		: `Resets every ${duration} from anchor`;
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

function localWeekday(date: Date): Weekday {
	return weekdaysByIndex[date.getDay()];
}

function describeDailyAvailability(schedule: RecurringSchedule): string {
	const availableWeekdays = schedule.availableWeekdays;
	if (!availableWeekdays?.length) return 'Resets daily';

	return `Available ${formatWeekdayList(availableWeekdays)}; resets`;
}

const weekdaysByIndex: Weekday[] = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
];

function weekdayOrder(weekday: Weekday): number {
	return weekdays.indexOf(weekday);
}
