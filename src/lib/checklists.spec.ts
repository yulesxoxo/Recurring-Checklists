import { describe, expect, it } from 'vitest';
import type { AppState, RecurringSchedule } from './checklists';
import {
	getNextReset,
	getResetWindowStart,
	intervalCompletionExpiresAt,
	localTimeToUtcTime,
	scheduleInputTimeToUtc
} from './date-time';
import {
	STORAGE_KEY,
	createEmptyAppState,
	exportPortableChecklist,
	importPortableChecklists,
	insertArrayItem,
	linkKeyConflict,
	loadAppState,
	moveArrayItem,
	normalizeSchedule,
	saveAppState
} from './checklists';

class MemoryStorage implements Storage {
	private store = new Map<string, string>();

	get length(): number {
		return this.store.size;
	}

	clear(): void {
		this.store.clear();
	}

	getItem(key: string): string | null {
		return this.store.get(key) ?? null;
	}

	key(index: number): string | null {
		return Array.from(this.store.keys())[index] ?? null;
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}
}

describe('checklist storage', () => {
	it('returns an empty state when no data exists', () => {
		expect(loadAppState(new MemoryStorage())).toEqual(createEmptyAppState());
	});

	it('preserves checklists, sections, tasks, and completion state', () => {
		const storage = new MemoryStorage();
		const state: AppState = {
			version: 1,
			checklists: [
				{
					id: 'checklist-1',
					name: 'Operations',
					description: 'Recurring checks',
					sections: [
						{
							id: 'section-1',
							name: 'Daily',
							schedule: { frequency: 'daily', anchorDateTimeUtc: '2026-06-24T05:00:00.000Z' },
							tasks: [{ id: 'task-1', title: 'Review queue', notes: 'Escalate blockers' }]
						}
					]
				}
			],
			completions: {
				'checklist-1': {
					'section-1': {
						'task-1': { completedAt: '2026-06-24T05:30:00.000Z' }
					}
				}
			}
		};

		saveAppState(storage, state);

		expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
		expect(loadAppState(storage)).toEqual(state);
	});

	it('falls back to empty state for invalid stored JSON', () => {
		const storage = new MemoryStorage();
		storage.setItem(STORAGE_KEY, '{invalid');

		expect(loadAppState(storage)).toEqual(createEmptyAppState());
	});

	it('drops unsupported legacy schedules without losing valid sections', () => {
		const storage = new MemoryStorage();
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 1,
				checklists: [
					{
						id: 'checklist-1',
						name: 'Operations',
						description: '',
						sections: [
							{
								id: 'section-1',
								name: 'Every minute',
								schedule: { frequency: 'minutely', resetTimeUtc: '00:00' },
								tasks: []
							},
							{
								id: 'section-2',
								name: 'Daily',
								schedule: { frequency: 'daily', resetTimeUtc: '05:00' },
								tasks: []
							}
						]
					}
				],
				completions: {}
			})
		);

		expect(loadAppState(storage).checklists[0].sections).toHaveLength(1);
		expect(loadAppState(storage).checklists[0].sections[0].schedule.frequency).toBe('daily');
	});
});

describe('reset windows', () => {
	it('uses the current daily window after the reset boundary', () => {
		const schedule: RecurringSchedule = {
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
		};

		expect(getResetWindowStart(schedule, new Date('2026-06-24T05:00:00.000Z'))?.toISOString()).toBe(
			'2026-06-24T05:00:00.000Z'
		);
		expect(getResetWindowStart(schedule, new Date('2026-06-24T04:59:59.000Z'))?.toISOString()).toBe(
			'2026-06-23T05:00:00.000Z'
		);
	});

	it('uses Monday at 05:00 UTC as the weekly boundary', () => {
		const schedule: RecurringSchedule = {
			frequency: 'weekly',
			resetWeekday: 'monday',
			anchorDateTimeUtc: '2026-06-22T05:00:00.000Z'
		};

		expect(getResetWindowStart(schedule, new Date('2026-06-24T12:00:00.000Z'))?.toISOString()).toBe(
			'2026-06-22T05:00:00.000Z'
		);
		expect(getResetWindowStart(schedule, new Date('2026-06-22T04:59:59.000Z'))?.toISOString()).toBe(
			'2026-06-15T05:00:00.000Z'
		);
	});

	it('uses the anchor date for deterministic biweekly boundaries', () => {
		const schedule: RecurringSchedule = {
			frequency: 'biweekly',
			resetWeekday: 'monday',
			anchorDateTimeUtc: '2026-06-08T05:00:00.000Z'
		};

		expect(getResetWindowStart(schedule, new Date('2026-06-24T12:00:00.000Z'))?.toISOString()).toBe(
			'2026-06-22T05:00:00.000Z'
		);
		expect(getResetWindowStart(schedule, new Date('2026-06-22T04:59:59.000Z'))?.toISOString()).toBe(
			'2026-06-08T05:00:00.000Z'
		);
	});

	it('requires the biweekly anchor date to match the selected reset weekday', () => {
		const schedule: RecurringSchedule = {
			frequency: 'biweekly',
			resetWeekday: 'tuesday',
			anchorDateTimeUtc: '2026-06-08T05:00:00.000Z'
		};

		expect(getResetWindowStart(schedule, new Date('2026-06-24T12:00:00.000Z'))).toBeNull();
	});

	it('uses fixed interval windows from an anchor date time', () => {
		const schedule: RecurringSchedule = {
			frequency: 'interval',
			intervalMinutes: 150,
			intervalMode: 'anchor',
			anchorDateTimeUtc: '2026-06-24T08:00:00.000Z'
		};

		expect(getResetWindowStart(schedule, new Date('2026-06-24T12:59:00.000Z'))?.toISOString()).toBe(
			'2026-06-24T10:30:00.000Z'
		);
		expect(getNextReset(schedule, new Date('2026-06-24T12:59:00.000Z'))?.toISOString()).toBe(
			'2026-06-24T13:00:00.000Z'
		);
	});

	it('expires completion-based intervals from the completed time', () => {
		const schedule: RecurringSchedule = {
			frequency: 'interval',
			intervalMinutes: 90,
			intervalMode: 'completion'
		};

		expect(
			intervalCompletionExpiresAt(schedule, new Date('2026-06-24T10:00:00.000Z'))?.toISOString()
		).toBe('2026-06-24T11:30:00.000Z');
		expect(getResetWindowStart(schedule, new Date('2026-06-24T10:00:00.000Z'))).toBeNull();
	});
});

describe('reorder helpers', () => {
	it('keeps the first item in place when moving up', () => {
		const items = ['a', 'b', 'c'];

		expect(moveArrayItem(items, 0, -1)).toBe(items);
		expect(moveArrayItem(items, 0, -1)).toEqual(['a', 'b', 'c']);
	});

	it('keeps the last item in place when moving down', () => {
		const items = ['a', 'b', 'c'];

		expect(moveArrayItem(items, 2, 1)).toBe(items);
		expect(moveArrayItem(items, 2, 1)).toEqual(['a', 'b', 'c']);
	});

	it('moves a middle item up or down by one position', () => {
		expect(moveArrayItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
		expect(moveArrayItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
	});

	it('inserts above and below the requested index', () => {
		const items = ['a', 'c'];

		expect(insertArrayItem(items, 'b', 1)).toEqual(['a', 'b', 'c']);
		expect(insertArrayItem(items, 'b', 2)).toEqual(['a', 'c', 'b']);
	});
});

describe('schedule normalization', () => {
	it('converts legacy biweekly anchor dates to anchor date times', () => {
		const schedule = normalizeSchedule({
			frequency: 'biweekly',
			resetTimeUtc: '09:30',
			resetWeekday: 'monday',
			anchorDate: '2026-06-22'
		});

		expect(schedule).toEqual({
			frequency: 'biweekly',
			resetWeekday: 'monday',
			anchorDateTimeUtc: '2026-06-22T09:30:00.000Z',
			intervalMinutes: undefined,
			intervalMode: undefined
		});
	});

	it('stores interval duration as total minutes', () => {
		const schedule = normalizeSchedule({
			frequency: 'interval',
			resetTimeUtc: '09:30',
			intervalMinutes: 135,
			intervalMode: 'completion',
			anchorDateTimeUtc: '2026-06-24T08:00'
		});

		expect(schedule).toEqual({
			frequency: 'interval',
			resetWeekday: undefined,
			anchorDateTimeUtc: undefined,
			intervalMinutes: 135,
			intervalMode: 'completion'
		});
	});
});

describe('direct checklist links', () => {
	it('detects link key conflicts case-insensitively', () => {
		expect(
			linkKeyConflict(
				[{ id: 'checklist-1', name: 'NTE', description: '', linkKey: 'NTE', sections: [] }],
				'nte'
			)?.id
		).toBe('checklist-1');
		expect(
			linkKeyConflict(
				[{ id: 'checklist-1', name: 'NTE', description: '', linkKey: 'NTE', sections: [] }],
				'nte',
				'checklist-1'
			)
		).toBeNull();
	});
});

describe('portable exports', () => {
	it('excludes IDs and completion state', () => {
		const state: AppState = {
			version: 1,
			checklists: [
				{
					id: 'checklist-1',
					name: 'Operations',
					description: 'Recurring checks',
					sections: [
						{
							id: 'section-1',
							name: 'Daily',
							schedule: { frequency: 'daily', anchorDateTimeUtc: '2026-06-24T05:00:00.000Z' },
							tasks: [{ id: 'task-1', title: 'Review queue', notes: 'Escalate blockers' }]
						}
					]
				}
			],
			completions: {
				'checklist-1': {
					'section-1': {
						'task-1': { completedAt: '2026-06-24T05:30:00.000Z' }
					}
				}
			}
		};

		const exported = JSON.stringify(exportPortableChecklist(state.checklists[0]));

		expect(exported).not.toContain('checklist-1');
		expect(exported).not.toContain('section-1');
		expect(exported).not.toContain('task-1');
		expect(exported).not.toContain('completedAt');
		expect(JSON.parse(exported)).toEqual({
			version: 1,
			checklist: {
				name: 'Operations',
				description: 'Recurring checks',
				sections: [
					{
						name: 'Daily',
						schedule: {
							frequency: 'daily',
							anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
						},
						tasks: [{ title: 'Review queue', notes: 'Escalate blockers' }]
					}
				]
			}
		});
	});
});

describe('portable imports', () => {
	it('regenerates checklist, section, and task IDs', () => {
		const ids = ['task-new', 'section-new', 'checklist-new'];
		const result = importPortableChecklists(
			JSON.stringify({
				version: 1,
				checklist: {
					name: 'Operations',
					description: 'Recurring checks',
					linkKey: 'Ops',
					sections: [
						{
							name: 'Daily',
							schedule: { frequency: 'daily', resetTimeUtc: '05:00' },
							tasks: [{ title: 'Review queue' }]
						}
					]
				}
			}),
			{ idFactory: () => ids.shift() ?? 'extra-id' }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.checklist.id).toBe('checklist-new');
		expect(result.checklist.linkKey).toBe('Ops');
		expect(result.checklist.sections[0].id).toBe('section-new');
		expect(result.checklist.sections[0].tasks[0].id).toBe('task-new');
	});

	it('rejects malformed schedules before import', () => {
		const result = importPortableChecklists(
			JSON.stringify({
				version: 1,
				checklist: {
					name: 'Operations',
					description: '',
					sections: [
						{
							name: 'Bad',
							schedule: { frequency: 'daily', resetTimeUtc: '25:00' },
							tasks: []
						}
					]
				}
			})
		);

		expect(result.ok).toBe(false);
	});
});

describe('local time conversion', () => {
	it('converts local wall time to the equivalent UTC time', () => {
		const reference = new Date(2026, 5, 24, 12, 0);
		const selected = new Date(2026, 5, 24, 9, 30);
		const expected = `${selected.getUTCHours().toString().padStart(2, '0')}:${selected
			.getUTCMinutes()
			.toString()
			.padStart(2, '0')}`;

		expect(localTimeToUtcTime('09:30', reference)).toBe(expected);
		expect(scheduleInputTimeToUtc('09:30', 'local', reference)).toBe(expected);
	});
});
