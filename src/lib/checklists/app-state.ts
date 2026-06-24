import { STORAGE_KEY } from './constants';
import { normalizeChecklist } from './core';
import type { AppState, Checklist, ChecklistParseOptions, CompletionState } from './types';

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
