export const STORAGE_KEY = 'recurring-checklists:v1';

export type Frequency = 'daily' | 'weekly' | 'biweekly';
export type Weekday =
	| 'sunday'
	| 'monday'
	| 'tuesday'
	| 'wednesday'
	| 'thursday'
	| 'friday'
	| 'saturday';

export type RecurringSchedule = {
	frequency: Frequency;
	resetTimeUtc: string;
	resetWeekday?: Weekday;
	anchorDate?: string;
};

export type ChecklistTask = {
	id: string;
	title: string;
	notes?: string;
};

export type ChecklistSection = {
	id: string;
	name: string;
	schedule: RecurringSchedule;
	tasks: ChecklistTask[];
};

export type Checklist = {
	id: string;
	name: string;
	description: string;
	sections: ChecklistSection[];
};

export type CompletionRecord = {
	completedAt: string;
};

export type CompletionState = Record<string, Record<string, Record<string, CompletionRecord>>>;

export type AppState = {
	version: 1;
	checklists: Checklist[];
	completions: CompletionState;
};

const dayMs = 24 * 60 * 60 * 1000;
const weekdayIndex: Record<Weekday, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6
};

export function createEmptyAppState(): AppState {
	return {
		version: 1,
		checklists: [],
		completions: {}
	};
}

export function loadAppState(storage: Storage): AppState {
	const stored = storage.getItem(STORAGE_KEY);
	if (!stored) return createEmptyAppState();

	try {
		const parsed: unknown = JSON.parse(stored);
		return isAppState(parsed) ? parsed : createEmptyAppState();
	} catch {
		return createEmptyAppState();
	}
}

export function saveAppState(storage: Storage, state: AppState): void {
	storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function countTasks(checklist: Checklist): number {
	return checklist.sections.reduce((total, section) => total + section.tasks.length, 0);
}

export function getCompletion(
	completions: CompletionState,
	checklistId: string,
	sectionId: string,
	taskId: string
): CompletionRecord | undefined {
	return completions[checklistId]?.[sectionId]?.[taskId];
}

export function isTaskComplete(
	section: ChecklistSection,
	record: CompletionRecord | undefined,
	now = new Date()
): boolean {
	if (!record) return false;

	const completedAt = new Date(record.completedAt);
	const windowStart = getResetWindowStart(section.schedule, now);

	return !Number.isNaN(completedAt.getTime()) && windowStart !== null && completedAt >= windowStart;
}

export function getResetWindowStart(schedule: RecurringSchedule, now = new Date()): Date | null {
	const { hours, minutes } = parseResetTime(schedule.resetTimeUtc);

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
		case 'daily':
			return `Resets daily at ${time} UTC`;
		case 'weekly':
			return `Resets every ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC`;
		case 'biweekly':
			return `Resets every other ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC`;
	}
}

export function formatUtcReset(date: Date | null): string {
	if (!date) return 'Not scheduled';

	const formatter = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'UTC',
		timeZoneName: 'short'
	});

	return formatter.format(date);
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

function parseResetTime(time: string): { hours: number; minutes: number } {
	const match = /^(\d{2}):(\d{2})$/.exec(time);
	if (!match) return { hours: 5, minutes: 0 };

	const hours = Number(match[1]);
	const minutes = Number(match[2]);

	if (hours > 23 || minutes > 59) return { hours: 5, minutes: 0 };
	return { hours, minutes };
}

function normalizeResetTime(time: string): string {
	const { hours, minutes } = parseResetTime(time);
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function parseAnchorDate(anchorDate: string, hours: number, minutes: number): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorDate);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month, day, hours, minutes));

	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
		return null;
	}

	return date;
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * dayMs);
}

function titleCase(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function isAppState(value: unknown): value is AppState {
	if (!isRecord(value)) return false;

	return (
		value.version === 1 &&
		Array.isArray(value.checklists) &&
		isRecord(value.completions) &&
		value.checklists.every(isChecklist)
	);
}

function isChecklist(value: unknown): value is Checklist {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		typeof value.description === 'string' &&
		Array.isArray(value.sections) &&
		value.sections.every(isSection)
	);
}

function isSection(value: unknown): value is ChecklistSection {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		isSchedule(value.schedule) &&
		Array.isArray(value.tasks) &&
		value.tasks.every(isTask)
	);
}

function isSchedule(value: unknown): value is RecurringSchedule {
	return (
		isRecord(value) &&
		isFrequency(value.frequency) &&
		typeof value.resetTimeUtc === 'string' &&
		(value.resetWeekday === undefined || isWeekday(value.resetWeekday)) &&
		(value.anchorDate === undefined || typeof value.anchorDate === 'string')
	);
}

function isTask(value: unknown): value is ChecklistTask {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.title === 'string' &&
		(value.notes === undefined || typeof value.notes === 'string')
	);
}

function isFrequency(value: unknown): value is Frequency {
	return value === 'daily' || value === 'weekly' || value === 'biweekly';
}

function isWeekday(value: unknown): value is Weekday {
	return (
		value === 'sunday' ||
		value === 'monday' ||
		value === 'tuesday' ||
		value === 'wednesday' ||
		value === 'thursday' ||
		value === 'friday' ||
		value === 'saturday'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
