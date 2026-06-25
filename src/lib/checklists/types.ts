export type BaseFrequency = 'daily' | 'weekly' | 'biweekly' | 'interval';
export type Frequency = BaseFrequency;
export type IntervalMode = 'anchor' | 'completion';
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
	resetWeekday?: Weekday;
	anchorDateTimeUtc?: string;
	intervalMinutes?: number;
	intervalMode?: IntervalMode;
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
	linkKey?: string;
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

export type PortableChecklistExport = {
	version: 1;
	checklist: {
		name: string;
		description: string;
		linkKey?: string;
		sections: Array<{
			name: string;
			schedule: RecurringSchedule;
			tasks: Array<{
				title: string;
				notes?: string;
			}>;
		}>;
	};
};

export type ChecklistParseOptions = object;

export type ImportPortableChecklistsOptions = ChecklistParseOptions & {
	idFactory?: () => string;
};

export type ImportPortableChecklistsResult =
	| { ok: true; checklist: Checklist }
	| { ok: false; error: string };
