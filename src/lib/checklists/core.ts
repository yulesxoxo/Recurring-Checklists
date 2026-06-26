import {
	alignDateToWeekday,
	isValidResetTime,
	normalizeIntervalMinutes,
	normalizeResetTime,
	normalizeUtcDateTimeInput,
	parseUtcDateInput,
	parseUtcDateTimeInput,
	parseResetTime,
	todayUtc
} from '../date-time';
import { createId } from '../id';
import { weekdays } from './constants';
import type {
	Checklist,
	ChecklistParseOptions,
	ChecklistSection,
	ChecklistTask,
	Frequency,
	ImportPortableChecklistsOptions,
	ImportPortableChecklistsResult,
	PortableChecklistExport,
	RecurringSchedule,
	Weekday
} from './types';

export function normalizeSchedule(
	value: unknown,
	options: ChecklistParseOptions = {}
): RecurringSchedule | null {
	void options;
	if (!isRecord(value) || !isFrequency(value.frequency)) return null;

	const frequency = value.frequency;
	const resetTimeUtc = legacyResetTime(value);
	const resetWeekday =
		frequency === 'weekly' || frequency === 'biweekly'
			? isWeekday(value.resetWeekday)
				? value.resetWeekday
				: 'monday'
			: undefined;
	const availableWeekdays =
		frequency === 'daily' ? normalizeAvailableWeekdays(value.availableWeekdays) : undefined;
	const availableTimeWindow =
		frequency === 'daily'
			? normalizeAvailableTimeWindow(value.availableStartTimeUtc, value.availableEndTimeUtc)
			: {};
	const intervalMode = value.intervalMode === 'completion' ? 'completion' : 'anchor';

	return {
		frequency,
		resetWeekday,
		availableWeekdays,
		...availableTimeWindow,
		anchorDateTimeUtc: normalizeScheduleAnchorDateTime(
			value,
			frequency,
			resetTimeUtc,
			resetWeekday,
			intervalMode
		),
		intervalMinutes:
			frequency === 'interval' ? normalizeIntervalMinutes(value.intervalMinutes) : undefined,
		intervalMode: frequency === 'interval' ? intervalMode : undefined
	};
}

export function countTasks(checklist: Checklist): number {
	return checklist.sections.reduce((total, section) => total + section.tasks.length, 0);
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
				defaultSchedule: { ...section.defaultSchedule },
				tasks: section.tasks.map((task) => ({
					title: task.title,
					...(task.notes ? { notes: task.notes } : {}),
					...(task.schedule ? { schedule: { ...task.schedule } } : {}),
					...(task.repeatCount && task.repeatCount > 1 ? { repeatCount: task.repeatCount } : {}),
					...(task.maxCarryover && task.maxCarryover > 1 ? { maxCarryover: task.maxCarryover } : {})
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

export function uniqueLinkKey(
	checklists: Checklist[],
	linkKey: string | undefined
): string | undefined {
	const normalized = normalizeLinkKey(linkKey);
	if (!normalized) return undefined;
	if (!linkKeyConflict(checklists, normalized)) return normalized;

	for (let suffix = 2; suffix < 10_000; suffix += 1) {
		const candidate = `${normalized}-${suffix}`;
		if (!linkKeyConflict(checklists, candidate)) return candidate;
	}

	return undefined;
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

		const defaultSchedule = normalizePortableSchedule(section.defaultSchedule, options);
		if (!defaultSchedule) {
			return {
				ok: false,
				error: `Section "${section.name}" has an unsupported or malformed default schedule.`
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

			const schedule =
				task.schedule === undefined ? undefined : normalizePortableSchedule(task.schedule, options);
			if (task.schedule !== undefined && !schedule) {
				return {
					ok: false,
					error: `Task ${taskIndex + 1} in section "${section.name}" has an unsupported or malformed schedule.`
				};
			}

			tasks.push({
				id: idFactory(),
				title: task.title.trim() || 'Untitled task',
				notes: task.notes?.trim() || undefined,
				...(schedule ? { schedule } : {}),
				...normalizeTaskCounts(task)
			});
		}

		sections.push({
			id: idFactory(),
			name: section.name.trim() || 'Untitled section',
			defaultSchedule,
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

export function titleCase(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function normalizePortableSchedule(
	value: unknown,
	options: ChecklistParseOptions
): RecurringSchedule | null {
	if (!isRecord(value) || !isFrequency(value.frequency)) return null;
	const hasValidAnchorDateTime =
		typeof value.anchorDateTimeUtc === 'string' && parseUtcDateTimeInput(value.anchorDateTimeUtc);
	const hasValidLegacyResetTime =
		typeof value.resetTimeUtc === 'string' && isValidResetTime(value.resetTimeUtc);

	if (value.frequency === 'weekly' || value.frequency === 'biweekly') {
		if (value.resetWeekday !== undefined && !isWeekday(value.resetWeekday)) return null;
	}

	if (value.availableWeekdays !== undefined) {
		if (value.frequency !== 'daily' || !isValidAvailableWeekdays(value.availableWeekdays)) {
			return null;
		}
	}

	if (value.availableStartTimeUtc !== undefined || value.availableEndTimeUtc !== undefined) {
		if (
			value.frequency !== 'daily' ||
			typeof value.availableStartTimeUtc !== 'string' ||
			typeof value.availableEndTimeUtc !== 'string' ||
			!isValidResetTime(value.availableStartTimeUtc) ||
			!isValidResetTime(value.availableEndTimeUtc) ||
			value.availableStartTimeUtc === value.availableEndTimeUtc
		) {
			return null;
		}
	}

	if (value.resetTimeUtc !== undefined && !hasValidLegacyResetTime) return null;

	if (
		!(value.frequency === 'interval' && value.intervalMode === 'completion') &&
		!hasValidAnchorDateTime &&
		!hasValidLegacyResetTime
	) {
		return null;
	}

	if (value.frequency === 'biweekly') {
		if (typeof value.anchorDateTimeUtc === 'string' && !hasValidAnchorDateTime) return null;

		if (
			value.anchorDateTimeUtc === undefined &&
			(typeof value.anchorDate !== 'string' || !parseUtcDateInput(value.anchorDate))
		) {
			return null;
		}
	}

	if (value.frequency === 'interval') {
		if (
			typeof value.intervalMinutes !== 'number' ||
			!Number.isFinite(value.intervalMinutes) ||
			value.intervalMinutes < 1
		) {
			return null;
		}

		if (
			value.intervalMode !== undefined &&
			value.intervalMode !== 'anchor' &&
			value.intervalMode !== 'completion'
		) {
			return null;
		}

		if ((value.intervalMode ?? 'anchor') === 'anchor' && !hasValidAnchorDateTime) {
			return null;
		}
	}

	return normalizeSchedule(value, options);
}

function isFrequency(value: unknown): value is Frequency {
	return value === 'daily' || value === 'weekly' || value === 'biweekly' || value === 'interval';
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

function normalizeAvailableWeekdays(value: unknown): Weekday[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const selected = new Set(value.filter(isWeekday));
	const unique = weekdays.filter((weekday) => selected.has(weekday));

	return unique.length > 0 && unique.length < 7 ? unique : undefined;
}

function isValidAvailableWeekdays(value: unknown): boolean {
	return Array.isArray(value) && value.every(isWeekday);
}

function normalizeAvailableTimeWindow(
	startTime: unknown,
	endTime: unknown
): Pick<RecurringSchedule, 'availableStartTimeUtc' | 'availableEndTimeUtc'> {
	if (typeof startTime !== 'string' || typeof endTime !== 'string') return {};

	const availableStartTimeUtc = normalizeResetTime(startTime);
	const availableEndTimeUtc = normalizeResetTime(endTime);
	if (availableStartTimeUtc === availableEndTimeUtc) return {};

	return { availableStartTimeUtc, availableEndTimeUtc };
}

function normalizeBiweeklyAnchorDateTime(
	value: Record<string, unknown>,
	resetTimeUtc: string,
	resetWeekday: Weekday
): string {
	const rawDateTime =
		typeof value.anchorDateTimeUtc === 'string'
			? parseUtcDateTimeInput(value.anchorDateTimeUtc)
			: null;
	const rawDate =
		rawDateTime?.toISOString().slice(0, 10) ??
		(typeof value.anchorDate === 'string' ? value.anchorDate : todayUtc());
	const alignedDate = alignDateToWeekday(rawDate, resetWeekday);
	const { hours, minutes } = parseResetTime(resetTimeUtc);

	return `${alignedDate}T${hours.toString().padStart(2, '0')}:${minutes
		.toString()
		.padStart(2, '0')}:00.000Z`;
}

function normalizeScheduleAnchorDateTime(
	value: Record<string, unknown>,
	frequency: Frequency,
	resetTimeUtc: string,
	resetWeekday: Weekday | undefined,
	intervalMode: 'anchor' | 'completion'
): string | undefined {
	if (frequency === 'interval' && intervalMode === 'completion') {
		return undefined;
	}

	if (frequency === 'biweekly') {
		return normalizeBiweeklyAnchorDateTime(value, resetTimeUtc, resetWeekday ?? 'monday');
	}

	const fallback = `${todayUtc()}T${resetTimeUtc}:00.000Z`;
	return (
		normalizeUtcDateTimeInput(
			typeof value.anchorDateTimeUtc === 'string' ? value.anchorDateTimeUtc : fallback
		) ?? fallback
	);
}

function legacyResetTime(value: Record<string, unknown>): string {
	if (typeof value.resetTimeUtc === 'string') return normalizeResetTime(value.resetTimeUtc);

	if (typeof value.anchorDateTimeUtc === 'string') {
		const parsed = parseUtcDateTimeInput(value.anchorDateTimeUtc);
		if (parsed) {
			return `${parsed.getUTCHours().toString().padStart(2, '0')}:${parsed
				.getUTCMinutes()
				.toString()
				.padStart(2, '0')}`;
		}
	}

	return '05:00';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function normalizeTaskCounts(value: Record<string, unknown>): {
	repeatCount?: number;
	maxCarryover?: number;
} {
	const repeatCount = normalizePositiveInteger(value.repeatCount);
	const maxCarryover = normalizePositiveInteger(value.maxCarryover);

	return {
		...(repeatCount > 1 ? { repeatCount } : {}),
		...(maxCarryover > 1 ? { maxCarryover: Math.max(maxCarryover, repeatCount) } : {})
	};
}

function normalizePositiveInteger(value: unknown): number {
	const numeric =
		typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(numeric)) return 1;

	return Math.max(1, Math.floor(numeric));
}
