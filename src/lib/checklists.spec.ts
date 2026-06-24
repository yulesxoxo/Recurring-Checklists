import { describe, expect, it } from 'vitest';
import {
	STORAGE_KEY,
	createEmptyAppState,
	getResetWindowStart,
	loadAppState,
	saveAppState,
	type AppState,
	type RecurringSchedule
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
							schedule: { frequency: 'daily', resetTimeUtc: '05:00' },
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
});

describe('reset windows', () => {
	it('uses the current daily window after the reset boundary', () => {
		const schedule: RecurringSchedule = { frequency: 'daily', resetTimeUtc: '05:00' };

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
			resetTimeUtc: '05:00',
			resetWeekday: 'monday'
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
			resetTimeUtc: '05:00',
			resetWeekday: 'monday',
			anchorDate: '2026-06-08'
		};

		expect(getResetWindowStart(schedule, new Date('2026-06-24T12:00:00.000Z'))?.toISOString()).toBe(
			'2026-06-22T05:00:00.000Z'
		);
		expect(getResetWindowStart(schedule, new Date('2026-06-22T04:59:59.000Z'))?.toISOString()).toBe(
			'2026-06-08T05:00:00.000Z'
		);
	});
});
