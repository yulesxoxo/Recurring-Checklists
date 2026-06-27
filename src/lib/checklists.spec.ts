import { describe, expect, it } from 'vitest';
import type { AppState, RecurringSchedule } from './checklists';
import {
	countAvailableResetWindowsSince,
	describeSchedule,
	getNextReset,
	getResetWindowStart,
	intervalCompletionExpiresAt,
	isScheduleAvailable,
	localTimeToUtcTime,
	scheduleAvailability,
	scheduleInputTimeToUtc
} from './date-time';
import {
	STORAGE_KEY,
	bankedTaskStatus,
	createEmptyAppState,
	exportPortableChecklist,
	importPortableChecklists,
	insertArrayItem,
	linkKeyConflict,
	loadAppState,
	moveArrayItem,
	normalizeSchedule,
	saveAppState,
	taskIsDone,
	taskRemainingCount,
	uniqueLinkKey
} from './checklists';
import { driveFileIdFromUrl } from './google-drive';
import { buildShareImportUrl, decodeShareImportUrl, encodeShareImportUrl } from './share-import';

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
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
							},
							tasks: [
								{
									id: 'task-1',
									title: 'Review queue',
									notes: 'Escalate blockers',
									schedule: {
										frequency: 'daily',
										anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
									}
								}
							]
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

	it('drops unsupported schedules without losing valid sections', () => {
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
								name: 'Unsupported',
								defaultSchedule: { frequency: 'unsupported' },
								tasks: []
							},
							{
								id: 'section-2',
								name: 'Daily',
								defaultSchedule: {
									frequency: 'daily',
									anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
								},
								tasks: []
							}
						]
					}
				],
				completions: {}
			})
		);

		expect(loadAppState(storage).checklists[0].sections).toHaveLength(1);
		expect(loadAppState(storage).checklists[0].sections[0].defaultSchedule.frequency).toBe('daily');
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

	it('marks restricted daily schedules available only on selected local weekdays', () => {
		const schedule: RecurringSchedule = {
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-24T12:00:00.000Z',
			availableWeekdays: ['friday', 'saturday', 'sunday']
		};

		expect(isScheduleAvailable(schedule, new Date(2026, 5, 26, 12))).toBe(true);
		expect(isScheduleAvailable(schedule, new Date(2026, 5, 29, 12))).toBe(false);
	});

	it('uses selected weekdays for restricted daily reset boundaries', () => {
		const schedule: RecurringSchedule = {
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-24T07:00:00.000Z',
			availableWeekdays: ['monday']
		};

		expect(getResetWindowStart(schedule, new Date('2026-06-26T10:00:00.000Z'))?.toISOString()).toBe(
			'2026-06-22T07:00:00.000Z'
		);
		expect(getNextReset(schedule, new Date('2026-06-26T10:00:00.000Z'))?.toISOString()).toBe(
			'2026-06-29T07:00:00.000Z'
		);
	});

	it('tracks restricted daily time windows inside the reset window', () => {
		const schedule: RecurringSchedule = {
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-26T07:00:00.000Z',
			availableStartTimeUtc: '16:00',
			availableEndTimeUtc: '06:00'
		};

		const upcoming = scheduleAvailability(schedule, new Date('2026-06-26T08:00:00.000Z'));
		expect(upcoming.status).toBe('upcoming');
		expect(upcoming.availableAt?.toISOString()).toBe('2026-06-26T16:00:00.000Z');
		expect(upcoming.unavailableAt?.toISOString()).toBe('2026-06-27T06:00:00.000Z');

		expect(scheduleAvailability(schedule, new Date('2026-06-26T17:00:00.000Z')).status).toBe(
			'available'
		);
		expect(scheduleAvailability(schedule, new Date('2026-06-27T06:30:00.000Z')).status).toBe(
			'missed'
		);
		expect(scheduleAvailability(schedule, new Date('2026-06-27T07:30:00.000Z')).status).toBe(
			'upcoming'
		);
	});

	it('counts reset windows only on selected daily weekdays', () => {
		const schedule: RecurringSchedule = {
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-24T05:00:00.000Z',
			availableWeekdays: ['friday', 'saturday', 'sunday']
		};

		expect(
			countAvailableResetWindowsSince(
				schedule,
				'2026-06-26T12:00:00.000Z',
				new Date('2026-07-03T12:00:00.000Z')
			)
		).toBe(3);
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

describe('task counters', () => {
	const schedule: RecurringSchedule = {
		frequency: 'daily',
		anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
	};
	const task = {
		id: 'task-1',
		title: 'Elite Hunt',
		repeatCount: 2,
		maxCarryover: 6
	};

	it('shows carryover counters as attempts remaining', () => {
		const now = new Date('2026-06-24T06:00:00.000Z');

		expect(taskRemainingCount(task, schedule, undefined, now)).toBe(6);
		expect(taskIsDone(task, schedule, undefined, now)).toBe(false);
	});

	it('accrues repeat count after a depleted carryover bank', () => {
		const nextDay = new Date('2026-06-25T06:00:00.000Z');
		const record = {
			availableCount: 0,
			lastAccruedAt: '2026-06-24T05:00:00.000Z'
		};

		expect(bankedTaskStatus(task, schedule, record, nextDay)).toMatchObject({
			available: 2,
			capacity: 6,
			lastAccruedAt: '2026-06-25T05:00:00.000Z'
		});
		expect(taskRemainingCount(task, schedule, record, nextDay)).toBe(2);
		expect(taskIsDone(task, schedule, record, nextDay)).toBe(false);
	});

	it('marks carryover tasks complete when no attempts remain', () => {
		const now = new Date('2026-06-24T06:00:00.000Z');
		const record = {
			availableCount: 0,
			lastAccruedAt: '2026-06-24T05:00:00.000Z'
		};

		expect(taskRemainingCount(task, schedule, record, now)).toBe(0);
		expect(taskIsDone(task, schedule, record, now)).toBe(true);
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
			availableWeekdays: undefined,
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
			availableWeekdays: undefined,
			anchorDateTimeUtc: undefined,
			intervalMinutes: 135,
			intervalMode: 'completion'
		});
	});

	it('normalizes daily availability to unique weekdays only', () => {
		const schedule = normalizeSchedule({
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-24T05:00:00.000Z',
			availableWeekdays: ['sunday', 'monday', 'friday', 'saturday', 'friday']
		});

		expect(schedule?.availableWeekdays).toEqual(['monday', 'friday', 'saturday', 'sunday']);
	});

	it('describes daily availability in Monday-first order', () => {
		expect(
			describeSchedule({
				frequency: 'daily',
				anchorDateTimeUtc: '2026-06-24T07:00:00.000Z',
				availableWeekdays: ['sunday', 'monday', 'friday', 'saturday']
			})
		).toBe('Available Monday, Friday - Sunday; resets at 07:00 UTC');
	});

	it('collapses three or more consecutive availability weekdays into a range', () => {
		expect(
			describeSchedule({
				frequency: 'daily',
				anchorDateTimeUtc: '2026-06-24T07:00:00.000Z',
				availableWeekdays: ['friday', 'saturday', 'sunday']
			})
		).toBe('Available Friday - Sunday; resets at 07:00 UTC');
	});

	it('describes daily availability time windows', () => {
		expect(
			describeSchedule({
				frequency: 'daily',
				anchorDateTimeUtc: '2026-06-24T07:00:00.000Z',
				availableStartTimeUtc: '16:00',
				availableEndTimeUtc: '06:00'
			})
		).toBe('Available 16:00 - 06:00 UTC; resets at 07:00 UTC');
	});

	it('normalizes daily availability time windows', () => {
		const schedule = normalizeSchedule({
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-24T07:00:00.000Z',
			availableStartTimeUtc: '16:30',
			availableEndTimeUtc: '06:15'
		});

		expect(schedule).toMatchObject({
			availableStartTimeUtc: '16:30',
			availableEndTimeUtc: '06:15'
		});
	});

	it('ignores availability when every daily weekday is selected', () => {
		const schedule = normalizeSchedule({
			frequency: 'daily',
			anchorDateTimeUtc: '2026-06-24T05:00:00.000Z',
			availableWeekdays: [
				'sunday',
				'monday',
				'tuesday',
				'wednesday',
				'thursday',
				'friday',
				'saturday'
			]
		});

		expect(schedule?.availableWeekdays).toBeUndefined();
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

	it('generates a suffixed link key when imported keys collide', () => {
		const checklists = [
			{ id: 'checklist-1', name: 'NTE', description: '', linkKey: 'NTE', sections: [] },
			{ id: 'checklist-2', name: 'NTE Copy', description: '', linkKey: 'NTE-2', sections: [] }
		];

		expect(uniqueLinkKey(checklists, 'nte')).toBe('nte-3');
		expect(uniqueLinkKey(checklists, 'bp')).toBe('bp');
		expect(uniqueLinkKey(checklists, '')).toBeUndefined();
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
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
							},
							tasks: [
								{
									id: 'task-1',
									title: 'Review queue',
									notes: 'Escalate blockers',
									schedule: {
										frequency: 'daily',
										anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
									}
								}
							]
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
						defaultSchedule: {
							frequency: 'daily',
							anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
						},
						tasks: [
							{
								title: 'Review queue',
								notes: 'Escalate blockers',
								schedule: {
									frequency: 'daily',
									anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
								}
							}
						]
					}
				]
			}
		});
	});

	it('includes task repeat counts and carryover caps', () => {
		const exported = exportPortableChecklist({
			id: 'checklist-1',
			name: 'Operations',
			description: '',
			sections: [
				{
					id: 'section-1',
					name: 'Daily',
					defaultSchedule: {
						frequency: 'daily',
						anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
					},
					tasks: [
						{
							id: 'task-1',
							title: 'Elite Hunt',
							repeatCount: 2,
							maxCarryover: 6
						}
					]
				}
			]
		});

		expect(exported.checklist.sections[0].tasks[0]).toEqual({
			title: 'Elite Hunt',
			repeatCount: 2,
			maxCarryover: 6
		});
	});

	it('includes daily availability on portable schedules', () => {
		const exported = exportPortableChecklist({
			id: 'checklist-1',
			name: 'Operations',
			description: '',
			sections: [
				{
					id: 'section-1',
					name: 'Weekend',
					defaultSchedule: {
						frequency: 'daily',
						anchorDateTimeUtc: '2026-06-24T05:00:00.000Z',
						availableWeekdays: ['friday', 'saturday', 'sunday']
					},
					tasks: []
				}
			]
		});

		expect(exported.checklist.sections[0].defaultSchedule.availableWeekdays).toEqual([
			'friday',
			'saturday',
			'sunday'
		]);
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
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
							},
							tasks: [
								{
									title: 'Review queue',
									schedule: {
										frequency: 'daily',
										anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
									}
								}
							]
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

	it('allows imported tasks to use the section default schedule', () => {
		const result = importPortableChecklists(
			JSON.stringify({
				version: 1,
				checklist: {
					name: 'Operations',
					description: '',
					sections: [
						{
							name: 'Daily',
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
							},
							tasks: [{ title: 'Review queue' }]
						}
					]
				}
			})
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.checklist.sections[0].tasks[0].schedule).toBeUndefined();
	});

	it('imports task repeat counts and carryover caps', () => {
		const result = importPortableChecklists(
			JSON.stringify({
				version: 1,
				checklist: {
					name: 'Operations',
					description: '',
					sections: [
						{
							name: 'Daily',
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T05:00:00.000Z'
							},
							tasks: [{ title: 'Elite Hunt', repeatCount: 2, maxCarryover: 6 }]
						}
					]
				}
			})
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.checklist.sections[0].tasks[0]).toMatchObject({
			title: 'Elite Hunt',
			repeatCount: 2,
			maxCarryover: 6
		});
	});

	it('imports daily availability', () => {
		const result = importPortableChecklists(
			JSON.stringify({
				version: 1,
				checklist: {
					name: 'Operations',
					description: '',
					sections: [
						{
							name: 'Weekend',
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T05:00:00.000Z',
								availableWeekdays: ['friday', 'saturday', 'sunday']
							},
							tasks: []
						}
					]
				}
			})
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.checklist.sections[0].defaultSchedule.availableWeekdays).toEqual([
			'friday',
			'saturday',
			'sunday'
		]);
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
							defaultSchedule: { frequency: 'daily', anchorDateTimeUtc: 'bad' },
							tasks: []
						}
					]
				}
			})
		);

		expect(result.ok).toBe(false);
	});

	it('rejects malformed daily availability before import', () => {
		const result = importPortableChecklists(
			JSON.stringify({
				version: 1,
				checklist: {
					name: 'Operations',
					description: '',
					sections: [
						{
							name: 'Bad',
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T05:00:00.000Z',
								availableWeekdays: ['friday', 'funday']
							},
							tasks: []
						}
					]
				}
			})
		);

		expect(result.ok).toBe(false);
	});

	it('rejects malformed daily availability time windows before import', () => {
		const result = importPortableChecklists(
			JSON.stringify({
				version: 1,
				checklist: {
					name: 'Operations',
					description: '',
					sections: [
						{
							name: 'Bad',
							defaultSchedule: {
								frequency: 'daily',
								anchorDateTimeUtc: '2026-06-24T07:00:00.000Z',
								availableStartTimeUtc: '16:00'
							},
							tasks: []
						}
					]
				}
			})
		);

		expect(result.ok).toBe(false);
	});
});

describe('share import links', () => {
	it('round-trips Drive download URLs through a query-safe base64url value', () => {
		const fileUrl = 'https://drive.google.com/uc?export=download&id=file_123-ABC';
		const encoded = encodeShareImportUrl(fileUrl);

		expect(encoded).not.toContain('+');
		expect(encoded).not.toContain('/');
		expect(encoded).not.toContain('=');
		expect(decodeShareImportUrl(encoded)).toEqual({ ok: true, url: fileUrl });
	});

	it('builds an app import URL without preserving unrelated query params', () => {
		const importUrl = buildShareImportUrl(
			'https://drive.google.com/uc?export=download&id=file-id',
			'https://example.com/view/?checklist=old#section'
		);
		const parsed = new URL(importUrl);

		expect(parsed.origin).toBe('https://example.com');
		expect(parsed.pathname).toBe('/');
		expect(parsed.hash).toBe('');
		expect(parsed.searchParams.has('checklist')).toBe(false);
		expect(decodeShareImportUrl(parsed.searchParams.get('import') ?? '').ok).toBe(true);
	});

	it('rejects malformed and non-HTTPS import values', () => {
		expect(decodeShareImportUrl('not valid!').ok).toBe(false);
		expect(decodeShareImportUrl(encodeShareImportUrl('http://example.com/template.json'))).toEqual({
			ok: false,
			error: 'Import URL must use HTTPS.'
		});
	});

	it('extracts Google Drive file IDs from supported URL shapes', () => {
		expect(driveFileIdFromUrl('https://drive.google.com/uc?export=download&id=1tuEHHVMmBU')).toBe(
			'1tuEHHVMmBU'
		);
		expect(driveFileIdFromUrl('https://drive.google.com/file/d/file-id_123/view')).toBe(
			'file-id_123'
		);
		expect(driveFileIdFromUrl('https://example.com/file/d/file-id/view')).toBeNull();
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
