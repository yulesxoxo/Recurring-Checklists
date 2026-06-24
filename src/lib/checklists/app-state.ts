import { STORAGE_KEY } from './constants';
import { isRecord, normalizeLinkKey, normalizeSchedule } from './core';
import type {
	AppState,
	Checklist,
	ChecklistParseOptions,
	ChecklistSection,
	ChecklistTask,
	CompletionState
} from './types';

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
