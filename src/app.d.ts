import type {
	AppState as ChecklistAppState,
	BaseFrequency as ChecklistBaseFrequency,
	Checklist as ChecklistModel,
	ChecklistParseOptions as ChecklistModelParseOptions,
	ChecklistSection as ChecklistModelSection,
	ChecklistTask as ChecklistModelTask,
	CompletionRecord as ChecklistCompletionRecord,
	CompletionState as ChecklistCompletionState,
	DevFrequency as ChecklistDevFrequency,
	Frequency as ChecklistFrequency,
	ImportPortableChecklistsOptions as ChecklistImportPortableChecklistsOptions,
	ImportPortableChecklistsResult as ChecklistImportPortableChecklistsResult,
	PortableChecklistExport as ChecklistPortableExport,
	RecurringSchedule as ChecklistRecurringSchedule,
	ScheduleTimeMode as ChecklistScheduleTimeMode,
	Weekday as ChecklistWeekday
} from '$lib/checklists';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	type BaseFrequency = ChecklistBaseFrequency;
	type DevFrequency = ChecklistDevFrequency;
	type Frequency = ChecklistFrequency;
	type ScheduleTimeMode = ChecklistScheduleTimeMode;
	type Weekday = ChecklistWeekday;
	type RecurringSchedule = ChecklistRecurringSchedule;
	type ChecklistTask = ChecklistModelTask;
	type ChecklistSection = ChecklistModelSection;
	type Checklist = ChecklistModel;
	type CompletionRecord = ChecklistCompletionRecord;
	type CompletionState = ChecklistCompletionState;
	type AppState = ChecklistAppState;
	type PortableChecklistExport = ChecklistPortableExport;
	type ChecklistParseOptions = ChecklistModelParseOptions;
	type ImportPortableChecklistsOptions = ChecklistImportPortableChecklistsOptions;
	type ImportPortableChecklistsResult = ChecklistImportPortableChecklistsResult;

	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
