import {
	alignDateToWeekday,
	isValidResetTime,
	normalizeResetTime,
	parseUtcDateInput,
	todayUtc
} from '../date-time';
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
	if (!isRecord(value) || !isFrequency(value.frequency, options)) return null;

	const frequency = value.frequency;
	const resetTimeUtc =
		typeof value.resetTimeUtc === 'string' ? normalizeResetTime(value.resetTimeUtc) : '05:00';
	const resetWeekday =
		frequency === 'weekly' || frequency === 'biweekly'
			? isWeekday(value.resetWeekday)
				? value.resetWeekday
				: 'monday'
			: undefined;

	return {
		frequency,
		resetTimeUtc,
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

export function titleCase(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function normalizeChecklist(value: unknown, options: ChecklistParseOptions): Checklist | null {
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

	if (value.frequency === 'weekly' || value.frequency === 'biweekly') {
		if (value.resetWeekday !== undefined && !isWeekday(value.resetWeekday)) return null;
	}

	if (value.frequency === 'biweekly') {
		if (typeof value.anchorDate !== 'string' || !parseUtcDateInput(value.anchorDate)) return null;
	}

	return normalizeSchedule(value, options);
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
