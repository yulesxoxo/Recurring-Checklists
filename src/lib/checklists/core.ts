import { STORAGE_KEY } from './constants';
import type {
	AppState,
	Checklist,
	ChecklistParseOptions,
	ChecklistSection,
	ChecklistTask,
	CompletionRecord,
	CompletionState,
	Frequency,
	ImportPortableChecklistsOptions,
	ImportPortableChecklistsResult,
	PortableChecklistExport,
	RecurringSchedule,
	ScheduleTimeMode,
	Weekday
} from './types';

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

export function createEmptyAppState(): AppState {
	return {
		version: 1,
		checklists: [],
		completions: {}
	};
}

export function loadAppState(storage: Storage, options: ChecklistParseOptions = {}): AppState {
	const stored = storage.getItem(STORAGE_KEY);
	if (!stored) return createEmptyAppState();

	try {
		const parsed: unknown = JSON.parse(stored);
		return normalizeAppState(parsed, options) ?? createEmptyAppState();
	} catch {
		return createEmptyAppState();
	}
}

export function saveAppState(storage: Storage, state: AppState): void {
	storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function normalizeAppState(
	value: unknown,
	options: ChecklistParseOptions = {}
): AppState | null {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.checklists)) return null;

	const completions = isRecord(value.completions)
		? (value.completions as CompletionState)
		: createEmptyAppState().completions;

	return {
		version: 1,
		checklists: value.checklists
			.map((checklist) => normalizeChecklist(checklist, options))
			.filter((checklist): checklist is Checklist => checklist !== null),
		completions
	};
}

export function normalizeSchedule(
	value: unknown,
	options: ChecklistParseOptions = {}
): RecurringSchedule | null {
	if (!isRecord(value) || !isFrequency(value.frequency, options)) return null;

	const frequency = value.frequency;
	const resetTimeUtc =
		typeof value.resetTimeUtc === 'string' ? normalizeResetTime(value.resetTimeUtc) : '05:00';
	const timeMode = isScheduleTimeMode(value.timeMode) ? value.timeMode : 'utc';
	const resetWeekday =
		frequency === 'weekly' || frequency === 'biweekly'
			? isWeekday(value.resetWeekday)
				? value.resetWeekday
				: 'monday'
			: undefined;

	return {
		frequency,
		resetTimeUtc,
		timeMode,
		resetWeekday,
		anchorDate:
			frequency === 'biweekly'
				? alignDateToWeekday(
						typeof value.anchorDate === 'string' ? value.anchorDate : todayUtc(),
						resetWeekday ?? 'monday'
					)
				: undefined
	};
}

export function countTasks(checklist: Checklist): number {
	return checklist.sections.reduce((total, section) => total + section.tasks.length, 0);
}

export function insertArrayItem<T>(items: T[], item: T, position = items.length): T[] {
	const index = clampIndex(position, 0, items.length);
	return [...items.slice(0, index), item, ...items.slice(index)];
}

export function moveArrayItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
	const nextIndex = index + direction;
	if (index < 0 || index >= items.length || nextIndex < 0 || nextIndex >= items.length) {
		return items;
	}

	const moved = [...items];
	[moved[index], moved[nextIndex]] = [moved[nextIndex], moved[index]];
	return moved;
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
	const local = utcTimeToLocalTime(time);
	const enteredAs = schedule.timeMode === 'local' ? `, entered as ${local} local time` : '';

	switch (schedule.frequency) {
		case 'minutely':
			return 'Resets every minute';
		case 'hourly':
			return `Resets hourly at minute ${time.slice(3)} UTC${enteredAs}`;
		case 'daily':
			return `Resets daily at ${time} UTC${enteredAs}`;
		case 'weekly':
			return `Resets every ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC${enteredAs}`;
		case 'biweekly':
			return `Resets every other ${titleCase(schedule.resetWeekday ?? 'monday')} at ${time} UTC${enteredAs}`;
	}
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

export function exportPortableChecklist(checklist: Checklist): PortableChecklistExport {
	return {
		version: 1,
		checklist: {
			name: checklist.name,
			description: checklist.description,
			...(checklist.linkKey ? { linkKey: checklist.linkKey } : {}),
			sections: checklist.sections.map((section) => ({
				name: section.name,
				schedule: { ...section.schedule },
				tasks: section.tasks.map((task) => ({
					title: task.title,
					...(task.notes ? { notes: task.notes } : {})
				}))
			}))
		}
	};
}

export function normalizeLinkKey(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;

	const trimmed = value.trim();
	return trimmed || undefined;
}

export function linkKeyConflict(
	checklists: Checklist[],
	linkKey: string | undefined,
	currentChecklistId?: string
): Checklist | null {
	if (!linkKey) return null;

	const linkKeyLower = linkKey.toLowerCase();
	return (
		checklists.find(
			(checklist) =>
				checklist.id !== currentChecklistId && checklist.linkKey?.toLowerCase() === linkKeyLower
		) ?? null
	);
}

export function importPortableChecklists(
	json: string,
	options: ImportPortableChecklistsOptions = {}
): ImportPortableChecklistsResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, error: 'Import file is not valid JSON.' };
	}

	if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.checklist)) {
		return { ok: false, error: 'Import must contain one version 1 checklist.' };
	}

	const idFactory = options.idFactory ?? createId;

	const checklist = parsed.checklist;
	if (typeof checklist.name !== 'string' || typeof checklist.description !== 'string') {
		return { ok: false, error: 'Checklist is missing text fields.' };
	}

	if (checklist.linkKey !== undefined && typeof checklist.linkKey !== 'string') {
		return { ok: false, error: 'Checklist link key must be text.' };
	}

	if (!Array.isArray(checklist.sections)) {
		return { ok: false, error: `Checklist "${checklist.name}" has no sections array.` };
	}

	const sections: ChecklistSection[] = [];
	for (const [sectionIndex, section] of checklist.sections.entries()) {
		if (!isRecord(section) || typeof section.name !== 'string' || !Array.isArray(section.tasks)) {
			return {
				ok: false,
				error: `Section ${sectionIndex + 1} in "${checklist.name}" is malformed.`
			};
		}

		const schedule = normalizePortableSchedule(section.schedule, options);
		if (!schedule) {
			return {
				ok: false,
				error: `Section "${section.name}" has an unsupported or malformed schedule.`
			};
		}

		const tasks: ChecklistTask[] = [];
		for (const [taskIndex, task] of section.tasks.entries()) {
			if (
				!isRecord(task) ||
				typeof task.title !== 'string' ||
				(task.notes !== undefined && typeof task.notes !== 'string')
			) {
				return {
					ok: false,
					error: `Task ${taskIndex + 1} in section "${section.name}" is malformed.`
				};
			}

			tasks.push({
				id: idFactory(),
				title: task.title.trim() || 'Untitled task',
				notes: task.notes?.trim() || undefined
			});
		}

		sections.push({
			id: idFactory(),
			name: section.name.trim() || 'Untitled section',
			schedule,
			tasks
		});
	}

	return {
		ok: true,
		checklist: {
			id: idFactory(),
			name: checklist.name.trim() || 'Untitled checklist',
			description: checklist.description.trim(),
			linkKey: normalizeLinkKey(checklist.linkKey),
			sections
		}
	};
}

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

export function titleCase(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function normalizeChecklist(value: unknown, options: ChecklistParseOptions): Checklist | null {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string')
		return null;

	const sections = Array.isArray(value.sections)
		? value.sections
				.map((section) => normalizeSection(section, options))
				.filter((section): section is ChecklistSection => section !== null)
		: [];

	return {
		id: value.id,
		name: value.name,
		description: typeof value.description === 'string' ? value.description : '',
		linkKey: normalizeLinkKey(value.linkKey),
		sections
	};
}

function normalizeSection(value: unknown, options: ChecklistParseOptions): ChecklistSection | null {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string')
		return null;

	const schedule = normalizeSchedule(value.schedule, options);
	if (!schedule) return null;

	return {
		id: value.id,
		name: value.name,
		schedule,
		tasks: Array.isArray(value.tasks)
			? value.tasks.map(normalizeTask).filter((task): task is ChecklistTask => task !== null)
			: []
	};
}

function normalizeTask(value: unknown): ChecklistTask | null {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string')
		return null;

	return {
		id: value.id,
		title: value.title,
		notes: typeof value.notes === 'string' ? value.notes : undefined
	};
}

function normalizePortableSchedule(
	value: unknown,
	options: ChecklistParseOptions
): RecurringSchedule | null {
	if (!isRecord(value) || !isFrequency(value.frequency, options)) return null;
	if (typeof value.resetTimeUtc !== 'string' || !isValidResetTime(value.resetTimeUtc)) return null;
	if (value.timeMode !== undefined && !isScheduleTimeMode(value.timeMode)) return null;

	if (value.frequency === 'weekly' || value.frequency === 'biweekly') {
		if (value.resetWeekday !== undefined && !isWeekday(value.resetWeekday)) return null;
	}

	if (value.frequency === 'biweekly') {
		if (typeof value.anchorDate !== 'string' || !parseUtcDateInput(value.anchorDate)) return null;
	}

	return normalizeSchedule(value, options);
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
	return formatTimeParts(hours, minutes);
}

function isValidResetTime(time: string): boolean {
	const match = /^(\d{2}):(\d{2})$/.exec(time);
	if (!match) return false;

	const hours = Number(match[1]);
	const minutes = Number(match[2]);

	return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function parseAnchorDate(anchorDate: string, hours: number, minutes: number): Date | null {
	const date = parseUtcDateInput(anchorDate);
	if (!date) return null;

	date.setUTCHours(hours, minutes, 0, 0);
	return date;
}

function parseUtcDateInput(dateValue: string): Date | null {
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

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * dayMs);
}

function formatTimeParts(hours: number, minutes: number): string {
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function clampIndex(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return max;
	return Math.min(Math.max(Math.trunc(value), min), max);
}

function createId(): string {
	return (
		globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}

function isFrequency(value: unknown, options: ChecklistParseOptions): value is Frequency {
	return (
		value === 'daily' ||
		value === 'weekly' ||
		value === 'biweekly' ||
		(options.allowDevFrequencies === true && (value === 'hourly' || value === 'minutely'))
	);
}

function isScheduleTimeMode(value: unknown): value is ScheduleTimeMode {
	return value === 'local' || value === 'utc';
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
