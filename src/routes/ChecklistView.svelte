<script lang="ts">
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { CheckCircle2 } from '@lucide/svelte';
	import {
		type AppState,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type CompletionRecord,
		type RecurringSchedule,
		countTasks
	} from '$lib/checklists';
	import {
		describeSchedule,
		formatLocalReset,
		getNextReset,
		getResetWindowStart,
		intervalCompletionExpiresAt,
		scheduleResetTimeUtc,
		utcTimeToLocalTime
	} from '$lib/date-time';

	let {
		appState = $bindable<AppState>(),
		checklist,
		now = $bindable<Date>(),
		onPersist
	}: {
		appState: AppState;
		checklist: Checklist;
		now: Date;
		onPersist: () => void;
	} = $props();

	type BankedTaskStatus = {
		available: number;
		capacity: number;
		lastAccruedAt?: string;
	};

	let hideCompletedTasks = $state(true);

	function toggleTask(section: ChecklistSection, task: ChecklistTask): void {
		appState.completions[checklist.id] ??= {};
		appState.completions[checklist.id][section.id] ??= {};

		if (taskIsDone(section, task)) {
			delete appState.completions[checklist.id][section.id][task.id];
		} else {
			const completedAt = new Date().toISOString();
			appState.completions[checklist.id][section.id][task.id] = {
				completedAt,
				completionLog: [completedAt]
			};
		}

		now = new Date();
		onPersist();
	}

	function taskIsDone(section: ChecklistSection, task: ChecklistTask): boolean {
		const record = getCompletion(checklist.id, section.id, task.id);
		if (taskHasCarryover(task)) return bankedTaskStatus(section, task, record).available <= 0;

		return (
			taskCompletionCount(effectiveTaskSchedule(section, task), record, now) >=
			taskRepeatCount(task)
		);
	}

	function completeTaskUnit(section: ChecklistSection, task: ChecklistTask): void {
		appState.completions[checklist.id] ??= {};
		appState.completions[checklist.id][section.id] ??= {};

		const record = getCompletion(checklist.id, section.id, task.id) ?? {};
		const completedAt = new Date().toISOString();

		if (taskHasCarryover(task)) {
			const status = bankedTaskStatus(section, task, record);
			if (status.available <= 0) return;

			appState.completions[checklist.id][section.id][task.id] = {
				...record,
				completedAt,
				completionLog: appendCompletion(record, completedAt),
				availableCount: status.available - 1,
				lastAccruedAt: status.lastAccruedAt
			};
		} else {
			const schedule = effectiveTaskSchedule(section, task);
			const completionCount = taskCompletionCount(schedule, record, now);
			if (completionCount >= taskRepeatCount(task)) return;

			appState.completions[checklist.id][section.id][task.id] = {
				completedAt,
				completionLog: appendCompletion(record, completedAt)
			};
		}

		now = new Date();
		onPersist();
	}

	function resetTaskUnit(section: ChecklistSection, task: ChecklistTask): void {
		if (appState.completions[checklist.id]?.[section.id]?.[task.id]) {
			delete appState.completions[checklist.id][section.id][task.id];
		}

		now = new Date();
		onPersist();
	}

	function getCompletion(
		checklistId: string,
		sectionId: string,
		taskId: string
	): CompletionRecord | undefined {
		return appState.completions[checklistId]?.[sectionId]?.[taskId];
	}

	function sectionProgress(section: ChecklistSection): { done: number; total: number } {
		return {
			done: section.tasks.filter((task) => taskIsDone(section, task)).length,
			total: section.tasks.length
		};
	}

	function visibleTasks(section: ChecklistSection): ChecklistTask[] {
		return hideCompletedTasks
			? section.tasks.filter((task) => !taskIsDone(section, task))
			: section.tasks;
	}

	function effectiveTaskSchedule(
		section: ChecklistSection,
		task: ChecklistTask
	): RecurringSchedule {
		return task.schedule ?? section.defaultSchedule;
	}

	function completionDate(record: CompletionRecord | undefined): Date | null {
		if (!record?.completedAt) return null;

		const completedAt = new Date(record.completedAt);
		return Number.isNaN(completedAt.getTime()) ? null : completedAt;
	}

	function completionIntervalClearTime(
		schedule: RecurringSchedule,
		record: CompletionRecord | undefined
	): Date | null {
		const completedAt = completionDate(record);
		return completedAt ? intervalCompletionExpiresAt(schedule, completedAt) : null;
	}

	function describeViewSchedule(schedule: RecurringSchedule, reference: Date): string {
		if (schedule.frequency === 'interval') return describeSchedule(schedule);

		const utcTime = scheduleResetTimeUtc(schedule);
		const localTime = utcTimeToLocalTime(utcTime, reference);
		const resetTime = `${localTime} local / ${utcTime} UTC`;

		switch (schedule.frequency) {
			case 'daily':
				return `Resets daily at ${resetTime}`;
			case 'weekly':
				return `Resets every ${titleCase(schedule.resetWeekday ?? 'monday')} at ${resetTime}`;
			case 'biweekly':
				return `Resets every other ${titleCase(schedule.resetWeekday ?? 'monday')} at ${resetTime}`;
		}
	}

	function titleCase(value: string): string {
		return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
	}

	function taskRepeatCount(task: ChecklistTask): number {
		return positiveInteger(task.repeatCount);
	}

	function taskCarryoverCapacity(task: ChecklistTask): number {
		return Math.max(taskRepeatCount(task), positiveInteger(task.maxCarryover));
	}

	function taskHasCarryover(task: ChecklistTask): boolean {
		return taskCarryoverCapacity(task) > taskRepeatCount(task);
	}

	function positiveInteger(value: number | undefined): number {
		return Math.max(1, Math.floor(value ?? 1));
	}

	function taskCompletionCount(
		schedule: RecurringSchedule,
		record: CompletionRecord | undefined,
		reference: Date
	): number {
		return completionLog(record).filter((completedAt) =>
			completionCountsForSchedule(schedule, completedAt, reference)
		).length;
	}

	function completionCountsForSchedule(
		schedule: RecurringSchedule,
		completedAtValue: string,
		reference: Date
	): boolean {
		const completedAt = new Date(completedAtValue);
		if (Number.isNaN(completedAt.getTime())) return false;

		if (schedule.frequency === 'interval' && schedule.intervalMode === 'completion') {
			const expiresAt = intervalCompletionExpiresAt(schedule, completedAt);
			return expiresAt !== null && expiresAt > reference;
		}

		const windowStart = getResetWindowStart(schedule, reference);
		return windowStart !== null && completedAt >= windowStart;
	}

	function completionLog(record: CompletionRecord | undefined): string[] {
		if (!record) return [];

		const values = Array.isArray(record.completionLog) ? record.completionLog : [];
		const log = values.filter((value) => typeof value === 'string');
		if (record.completedAt && log.length === 0) return [record.completedAt];

		return log;
	}

	function appendCompletion(record: CompletionRecord | undefined, completedAt: string): string[] {
		return [...completionLog(record), completedAt].slice(-100);
	}

	function bankedTaskStatus(
		section: ChecklistSection,
		task: ChecklistTask,
		record: CompletionRecord | undefined
	): BankedTaskStatus {
		const schedule = effectiveTaskSchedule(section, task);
		const repeatCount = taskRepeatCount(task);
		const capacity = taskCarryoverCapacity(task);
		const windowStart = getResetWindowStart(schedule, now);
		const lastAccruedAt = record?.lastAccruedAt ?? windowStart?.toISOString();
		let available =
			typeof record?.availableCount === 'number' && Number.isFinite(record.availableCount)
				? Math.max(0, Math.floor(record.availableCount))
				: capacity;

		if (!windowStart || !lastAccruedAt) {
			return {
				available: Math.min(capacity, available),
				capacity,
				lastAccruedAt
			};
		}

		const elapsedWindows = countResetWindowsSince(schedule, lastAccruedAt, windowStart);
		available = Math.min(capacity, available + elapsedWindows * repeatCount);

		return {
			available,
			capacity,
			lastAccruedAt: windowStart.toISOString()
		};
	}

	function countResetWindowsSince(
		schedule: RecurringSchedule,
		lastAccruedAtValue: string,
		currentWindowStart: Date
	): number {
		const lastAccruedAt = new Date(lastAccruedAtValue);
		if (Number.isNaN(lastAccruedAt.getTime())) return 0;

		let count = 0;
		let cursor = getNextReset(schedule, lastAccruedAt);
		while (cursor && cursor <= currentWindowStart && count < 10000) {
			count += 1;
			cursor = getNextReset(schedule, new Date(cursor.getTime() + 1));
		}

		return count;
	}

	function taskUnitStatus(section: ChecklistSection, task: ChecklistTask): string {
		const completion = getCompletion(checklist.id, section.id, task.id);
		if (taskHasCarryover(task)) {
			const status = bankedTaskStatus(section, task, completion);
			const done = bankedCompletionCount(status, completion);
			return `${done}/${status.capacity}`;
		}

		const schedule = effectiveTaskSchedule(section, task);
		return `${taskCompletionCount(schedule, completion, now)}/${taskRepeatCount(task)}`;
	}

	function taskUsesUnitControls(task: ChecklistTask): boolean {
		return taskRepeatCount(task) > 1 || taskHasCarryover(task);
	}

	function bankedCompletionCount(
		status: BankedTaskStatus,
		record: CompletionRecord | undefined
	): number {
		if (!status.lastAccruedAt) return completionLog(record).length;

		const accruedAt = new Date(status.lastAccruedAt);
		if (Number.isNaN(accruedAt.getTime())) return 0;

		return completionLog(record).filter((completedAt) => {
			const date = new Date(completedAt);
			return !Number.isNaN(date.getTime()) && date >= accruedAt;
		}).length;
	}

	function toggleTaskUnit(section: ChecklistSection, task: ChecklistTask): void {
		if (taskIsDone(section, task)) {
			resetTaskUnit(section, task);
			return;
		}

		completeTaskUnit(section, task);
	}

	function toggleTaskUnitRow(
		event: MouseEvent,
		section: ChecklistSection,
		task: ChecklistTask
	): void {
		event.preventDefault();
		toggleTaskUnit(section, task);
	}

	function taskRowClass(section: ChecklistSection, task: ChecklistTask): string {
		return taskIsDone(section, task) && !hideCompletedTasks
			? 'border-surface-800 bg-surface-900 opacity-60 hover:bg-surface-900'
			: 'border-surface-800 bg-surface-950 hover:bg-surface-800';
	}

	function updateHideCompleted(details: { checked: boolean }): void {
		hideCompletedTasks = details.checked;
	}
</script>

<div class="grid gap-6">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<Switch checked={hideCompletedTasks} onCheckedChange={updateHideCompleted}>
			<Switch.Control>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.Label>Hide completed</Switch.Label>
			<Switch.HiddenInput />
		</Switch>
		<span class="badge preset-tonal-primary">{countTasks(checklist)} tasks</span>
	</div>

	<div class="grid gap-5">
		{#each checklist.sections as section (section.id)}
			{@const progress = sectionProgress(section)}
			{@const tasks = visibleTasks(section)}
			<section class="rounded-container border border-surface-800 bg-surface-900 p-4 shadow-sm">
				<div
					class="flex flex-col gap-3 border-b border-surface-800 pb-4 md:flex-row md:items-start md:justify-between"
				>
					<div class="min-w-0">
						<h2 class="text-xl font-semibold text-surface-50">{section.name}</h2>
						<p class="mt-1 text-sm text-surface-400">
							{describeViewSchedule(section.defaultSchedule, now)}
						</p>
						{#if !(section.defaultSchedule.frequency === 'interval' && section.defaultSchedule.intervalMode === 'completion')}
							<p class="mt-1 text-xs text-surface-400">
								Next reset: {formatLocalReset(getNextReset(section.defaultSchedule, now))}
							</p>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<span class="badge preset-tonal-success">
							<CheckCircle2 size={14} aria-hidden="true" />
							{progress.done} / {progress.total} done
						</span>
					</div>
				</div>

				<div class="mt-4 grid gap-3">
					{#if section.tasks.length === 0}
						<p
							class="rounded-base border border-dashed border-surface-700 p-4 text-sm text-surface-400"
						>
							This section has no tasks.
						</p>
					{:else if tasks.length === 0}
						<p
							class="rounded-base border border-dashed border-surface-700 p-4 text-sm text-surface-400"
						>
							All tasks in this section are completed.
						</p>
					{:else}
						{#each tasks as task (task.id)}
							{@const schedule = effectiveTaskSchedule(section, task)}
							{@const completion = getCompletion(checklist.id, section.id, task.id)}
							{@const clearTime = completionIntervalClearTime(schedule, completion)}
							{@const usesUnitControls = taskUsesUnitControls(task)}
							{#if usesUnitControls}
								<button
									type="button"
									class={`flex w-full cursor-pointer select-none gap-3 rounded-base border p-3 text-left transition ${taskRowClass(section, task)}`}
									onclick={(event) => toggleTaskUnitRow(event, section, task)}
								>
									<span class="min-w-0 flex-1">
										<span class="flex flex-wrap items-center gap-2">
											<span class="font-medium text-surface-50">{task.title}</span>
											<span class="badge preset-tonal-primary">{taskUnitStatus(section, task)}</span
											>
										</span>
										{#if task.notes}
											<span class="mt-1 block text-sm text-surface-400">{task.notes}</span>
										{/if}
										{#if task.schedule}
											<span class="mt-2 block text-xs text-surface-400">
												Custom schedule: {describeViewSchedule(schedule, now)}
											</span>
										{/if}
										{#if schedule.frequency === 'interval' && schedule.intervalMode === 'completion'}
											{#if clearTime}
												<span class="mt-1 block text-xs text-surface-400">
													Resets: {formatLocalReset(clearTime)}
												</span>
											{/if}
										{:else if task.schedule}
											<span class="mt-1 block text-xs text-surface-400">
												Next reset: {formatLocalReset(getNextReset(schedule, now))}
											</span>
										{/if}
									</span>
								</button>
							{:else}
								<button
									type="button"
									class={`flex w-full cursor-pointer select-none gap-3 rounded-base border p-3 text-left transition ${taskRowClass(section, task)}`}
									onclick={() => toggleTask(section, task)}
								>
									<span class="min-w-0 flex-1">
										<span class="block font-medium text-surface-50">{task.title}</span>
										{#if task.notes}
											<span class="mt-1 block text-sm text-surface-400">{task.notes}</span>
										{/if}
										{#if task.schedule}
											<span class="mt-2 block text-xs text-surface-400">
												Custom schedule: {describeViewSchedule(schedule, now)}
											</span>
										{/if}
										{#if schedule.frequency === 'interval' && schedule.intervalMode === 'completion'}
											{#if clearTime}
												<span class="mt-1 block text-xs text-surface-400">
													Resets: {formatLocalReset(clearTime)}
												</span>
											{/if}
										{:else if task.schedule}
											<span class="mt-1 block text-xs text-surface-400">
												Next reset: {formatLocalReset(getNextReset(schedule, now))}
											</span>
										{/if}
									</span>
								</button>
							{/if}
						{/each}
					{/if}
				</div>
			</section>
		{/each}
	</div>
</div>
