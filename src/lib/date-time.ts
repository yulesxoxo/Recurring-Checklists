import { weekdays } from './checklists/constants';
import type { RecurringSchedule, ScheduleTimeBasis, Weekday } from './checklists/types';

export type ScheduleAvailabilityStatus = 'available' | 'upcoming' | 'missed' | 'unavailable';

export type ScheduleAvailability = {
	status: ScheduleAvailabilityStatus;
	availableAt?: Date;
	unavailableAt?: Date;
};

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

export function alignDateToWeekday(
	dateValue: string,
	weekday: Weekday,
	timeBasis: ScheduleTimeBasis = 'utc'
): string {
	const date =
		parseCalendarDateInput(dateValue, timeBasis) ?? parseCalendarDateInput(todayUtc(), timeBasis);
	if (!date) return todayUtc();

	const daysToAdd = (weekdayIndex[weekday] - weekdayForBasis(date, timeBasis) + 7) % 7;
	const aligned = addCalendarDays(date, daysToAdd, timeBasis);

	return formatCalendarDate(aligned, timeBasis);
}

export function getResetWindowStart(schedule: RecurringSchedule, now = new Date()): Date | null {
	const { hours, minutes } = parseResetTime(scheduleResetTime(schedule));

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
			return addCalendarDays(windowStart, 7, scheduleTimeBasis(schedule));
		case 'biweekly':
			return addCalendarDays(windowStart, 14, scheduleTimeBasis(schedule));
		case 'interval':
			return new Date(windowStart.getTime() + intervalMinutes(schedule) * minuteMs);
	}
}

export function isScheduleAvailable(schedule: RecurringSchedule, now = new Date()): boolean {
	return scheduleAvailability(schedule, now).status === 'available';
}

export function scheduleAvailability(
	schedule: RecurringSchedule,
	now = new Date()
): ScheduleAvailability {
	if (schedule.frequency !== 'daily') return { status: 'available' };

	if (!scheduleHasTimeWindow(schedule)) {
		return isScheduleAvailableOnDate(schedule, now)
			? { status: 'available' }
			: { status: 'unavailable' };
	}

	const windowStart = getResetWindowStart(schedule, now);
	if (!windowStart) return { status: 'unavailable' };

	const { availableAt, unavailableAt } = getDailyAvailabilityWindow(schedule, windowStart);
	if (!availableAt || !unavailableAt) return { status: 'available' };

	if (now < availableAt) return { status: 'upcoming', availableAt, unavailableAt };
	if (now < unavailableAt) return { status: 'available', availableAt, unavailableAt };

	return { status: 'missed', availableAt, unavailableAt };
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
		count += 1;
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
	const time = scheduleResetTime(schedule);
	const basis = scheduleTimeBasisLabel(schedule);

	switch (schedule.frequency) {
		case 'interval':
			return describeIntervalSchedule(schedule);
		case 'daily':
			return `${describeDailyAvailability(schedule)} at ${time} ${basis}`;
		case 'weekly':
			return `Resets every ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} ${basis}`;
		case 'biweekly':
			return `Resets every other ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} ${basis}`;
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

export function formatLocalResetWithoutTimeZone(date: Date | null): string {
	return formatResetDate(date, undefined, false);
}

export function formatResetDate(
	date: Date | null,
	timeZone: string | undefined = undefined,
	includeTimeZone = true
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
		...(includeTimeZone ? { timeZoneName: 'short' } : {})
	});

	return formatter.format(date);
}

export function scheduleResetTime(schedule: RecurringSchedule): string {
	if (schedule.frequency !== 'interval' && schedule.resetTime)
		return normalizeResetTime(schedule.resetTime);

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

function parseLocalDateInput(dateValue: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(year, month, day);

	if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
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
	const basis = scheduleTimeBasis(schedule);
	const { hours, minutes } = parseResetTime(scheduleResetTime(schedule));
	const resetWeekday = weekdayIndex[schedule.resetWeekday ?? 'monday'];
	const currentWeekday = weekdayForBasis(now, basis);
	const daysSinceResetWeekday = (currentWeekday - resetWeekday + 7) % 7;
	const candidate = addCalendarDays(
		dateAtTimeForBasis(now, hours, minutes, basis),
		-daysSinceResetWeekday,
		basis
	);

	return candidate > now ? addCalendarDays(candidate, -intervalDays, basis) : candidate;
}

function getDailyWindowStart(
	schedule: RecurringSchedule,
	now: Date,
	hours: number,
	minutes: number
): Date {
	const basis = scheduleTimeBasis(schedule);
	let candidate = dateAtTimeForBasis(now, hours, minutes, basis);
	if (candidate > now) candidate = addCalendarDays(candidate, -1, basis);

	if (!schedule.availableWeekdays?.length) return candidate;

	for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
		if (isScheduleAvailableOnDate(schedule, candidate)) return candidate;
		candidate = addCalendarDays(candidate, -1, basis);
	}

	return candidate;
}

function getDailyAvailabilityWindow(
	schedule: RecurringSchedule,
	windowStart: Date
): { availableAt?: Date; unavailableAt?: Date } {
	if (!scheduleHasTimeWindow(schedule)) return {};

	const basis = scheduleTimeBasis(schedule);
	const startParts = parseResetTime(schedule.availableStartTime);
	const endParts = parseResetTime(schedule.availableEndTime);
	let availableAt = dateAtTimeForBasis(windowStart, startParts.hours, startParts.minutes, basis);
	if (availableAt < windowStart) availableAt = addCalendarDays(availableAt, 1, basis);

	let unavailableAt = dateAtTimeForBasis(availableAt, endParts.hours, endParts.minutes, basis);
	if (unavailableAt <= availableAt) unavailableAt = addCalendarDays(unavailableAt, 1, basis);

	return { availableAt, unavailableAt };
}

function getNextDailyReset(schedule: RecurringSchedule, windowStart: Date): Date {
	const basis = scheduleTimeBasis(schedule);
	let candidate = addCalendarDays(windowStart, 1, basis);
	if (!schedule.availableWeekdays?.length) return candidate;

	for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
		if (isScheduleAvailableOnDate(schedule, candidate)) return candidate;
		candidate = addCalendarDays(candidate, 1, basis);
	}

	return candidate;
}

function getBiweeklyWindowStart(schedule: RecurringSchedule, now: Date): Date | null {
	const anchorDate = schedule.anchorDate ?? schedule.anchorDateTimeUtc?.slice(0, 10);
	if (!anchorDate) return null;

	const basis = scheduleTimeBasis(schedule);
	const { hours, minutes } = parseResetTime(scheduleResetTime(schedule));
	const anchorDay = parseCalendarDateInput(anchorDate, basis);
	if (!anchorDay) return null;

	const anchor = dateAtTimeForBasis(anchorDay, hours, minutes, basis);
	if (!anchor) return null;

	const resetWeekday = weekdayIndex[schedule.resetWeekday ?? 'monday'];
	if (weekdayForBasis(anchor, basis) !== resetWeekday) return null;

	const cyclesSinceAnchor = Math.floor((now.getTime() - anchor.getTime()) / (14 * dayMs));
	let candidate = addCalendarDays(anchor, cyclesSinceAnchor * 14, basis);
	while (candidate > now) candidate = addCalendarDays(candidate, -14, basis);
	let next = addCalendarDays(candidate, 14, basis);
	while (next <= now) {
		candidate = next;
		next = addCalendarDays(candidate, 14, basis);
	}

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

function addCalendarDays(date: Date, days: number, timeBasis: ScheduleTimeBasis = 'utc'): Date {
	const next = new Date(date);
	if (timeBasis === 'local') {
		next.setDate(next.getDate() + days);
		return next;
	}

	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function formatTimeParts(hours: number, minutes: number): string {
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function titleCase(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function dateAtTimeForBasis(
	reference: Date,
	hours: number,
	minutes: number,
	timeBasis: ScheduleTimeBasis
): Date {
	if (timeBasis === 'local') {
		return new Date(
			reference.getFullYear(),
			reference.getMonth(),
			reference.getDate(),
			hours,
			minutes
		);
	}

	return new Date(
		Date.UTC(
			reference.getUTCFullYear(),
			reference.getUTCMonth(),
			reference.getUTCDate(),
			hours,
			minutes
		)
	);
}

function parseCalendarDateInput(dateValue: string, timeBasis: ScheduleTimeBasis): Date | null {
	return timeBasis === 'local' ? parseLocalDateInput(dateValue) : parseUtcDateInput(dateValue);
}

function formatCalendarDate(date: Date, timeBasis: ScheduleTimeBasis): string {
	const year = timeBasis === 'local' ? date.getFullYear() : date.getUTCFullYear();
	const month = (timeBasis === 'local' ? date.getMonth() : date.getUTCMonth()) + 1;
	const day = timeBasis === 'local' ? date.getDate() : date.getUTCDate();

	return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
		.toString()
		.padStart(2, '0')}`;
}

function weekdayForBasis(date: Date, timeBasis: ScheduleTimeBasis): number {
	return timeBasis === 'local' ? date.getDay() : date.getUTCDay();
}

export function scheduleTimeBasis(schedule: RecurringSchedule): ScheduleTimeBasis {
	return schedule.timeBasis === 'local' ? 'local' : 'utc';
}

function scheduleTimeBasisLabel(schedule: RecurringSchedule): string {
	return scheduleTimeBasis(schedule) === 'local' ? 'local' : 'UTC';
}

function scheduleWeekday(date: Date, timeBasis: ScheduleTimeBasis): Weekday {
	return weekdaysByIndex[weekdayForBasis(date, timeBasis)];
}

function isScheduleAvailableOnDate(schedule: RecurringSchedule, date: Date): boolean {
	if (!schedule.availableWeekdays?.length) return true;

	return schedule.availableWeekdays.includes(scheduleWeekday(date, scheduleTimeBasis(schedule)));
}

function scheduleHasTimeWindow(schedule: RecurringSchedule): schedule is RecurringSchedule & {
	availableStartTime: string;
	availableEndTime: string;
} {
	return Boolean(schedule.availableStartTime && schedule.availableEndTime);
}

function describeDailyAvailability(schedule: RecurringSchedule): string {
	const availableWeekdays = schedule.availableWeekdays;
	const descriptionParts = [
		...(availableWeekdays?.length ? [formatWeekdayList(availableWeekdays)] : []),
		...(scheduleHasTimeWindow(schedule)
			? [
					`${schedule.availableStartTime} - ${schedule.availableEndTime} ${scheduleTimeBasisLabel(schedule)}`
				]
			: [])
	];
	if (descriptionParts.length === 0) return 'Resets daily';

	return `Available ${descriptionParts.join(', ')}; resets`;
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
