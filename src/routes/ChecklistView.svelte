<script lang="ts">
	import { ArrowLeft, CheckCircle2 } from '@lucide/svelte';
	import {
		type AppState,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type CompletionRecord,
		countTasks,
		titleCase
	} from '$lib/checklists';
	import {
		describeSchedule,
		formatLocalReset,
		formatUtcReset,
		getNextReset,
		getResetWindowStart
	} from '$lib/date-time';

	let {
		appState = $bindable<AppState>(),
		checklist,
		now = $bindable<Date>(),
		onBack,
		onPersist
	}: {
		appState: AppState;
		checklist: Checklist;
		now: Date;
		onBack: () => void;
		onPersist: () => void;
	} = $props();

	function toggleTask(section: ChecklistSection, task: ChecklistTask, checked: boolean): void {
		appState.completions[checklist.id] ??= {};
		appState.completions[checklist.id][section.id] ??= {};

		if (checked) {
			appState.completions[checklist.id][section.id][task.id] = {
				completedAt: new Date().toISOString()
			};
		} else {
			delete appState.completions[checklist.id][section.id][task.id];
		}

		now = new Date();
		onPersist();
	}

	function taskIsDone(section: ChecklistSection, task: ChecklistTask): boolean {
		return isTaskComplete(section, getCompletion(checklist.id, section.id, task.id), now);
	}

	function getCompletion(
		checklistId: string,
		sectionId: string,
		taskId: string
	): CompletionRecord | undefined {
		return appState.completions[checklistId]?.[sectionId]?.[taskId];
	}

	function isTaskComplete(
		section: ChecklistSection,
		record: CompletionRecord | undefined,
		reference: Date
	): boolean {
		if (!record) return false;

		const completedAt = new Date(record.completedAt);
		const windowStart = getResetWindowStart(section.schedule, reference);

		return (
			!Number.isNaN(completedAt.getTime()) && windowStart !== null && completedAt >= windowStart
		);
	}

	function sectionProgress(section: ChecklistSection): { done: number; total: number } {
		return {
			done: section.tasks.filter((task) => taskIsDone(section, task)).length,
			total: section.tasks.length
		};
	}
</script>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
	<header class="border-b border-surface-800 pb-5">
		<button class="btn preset-tonal-surface mb-4" type="button" onclick={onBack}>
			<ArrowLeft size={18} aria-hidden="true" />
			Back to Manage
		</button>
		<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
			<div class="min-w-0">
				<h1 class="text-3xl font-semibold text-surface-50">{checklist.name}</h1>
				<p class="mt-2 text-sm text-surface-400">
					{checklist.description || 'No description'}
				</p>
			</div>
			<span class="badge preset-tonal-primary">{countTasks(checklist)} tasks</span>
		</div>
	</header>

	<div class="grid gap-5">
		{#each checklist.sections as section (section.id)}
			{@const progress = sectionProgress(section)}
			<section class="rounded-container border border-surface-800 bg-surface-900 p-4 shadow-sm">
				<div
					class="flex flex-col gap-3 border-b border-surface-800 pb-4 md:flex-row md:items-start md:justify-between"
				>
					<div class="min-w-0">
						<h2 class="text-xl font-semibold text-surface-50">{section.name}</h2>
						<p class="mt-1 text-sm text-surface-400">{describeSchedule(section.schedule)}</p>
						{#if section.schedule.frequency !== 'minutely'}
							<p class="mt-1 text-sm text-surface-400">
								Next reset local: {formatLocalReset(getNextReset(section.schedule, now))}
							</p>
							<p class="mt-1 text-sm text-surface-400">
								Next reset UTC: {formatUtcReset(getNextReset(section.schedule, now))}
							</p>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<span class="badge preset-tonal-success">
							<CheckCircle2 size={14} aria-hidden="true" />
							{progress.done} / {progress.total} done
						</span>
						<span class="badge preset-tonal-surface">{titleCase(section.schedule.frequency)}</span>
					</div>
				</div>

				<div class="mt-4 grid gap-3">
					{#if section.tasks.length === 0}
						<p
							class="rounded-base border border-dashed border-surface-700 p-4 text-sm text-surface-400"
						>
							This section has no tasks.
						</p>
					{:else}
						{#each section.tasks as task (task.id)}
							<label
								class="flex cursor-pointer gap-3 rounded-base border border-surface-800 bg-surface-950 p-3 transition hover:bg-surface-800"
							>
								<input
									class="checkbox mt-1"
									type="checkbox"
									checked={taskIsDone(section, task)}
									onchange={(event) => toggleTask(section, task, event.currentTarget.checked)}
								/>
								<span class="min-w-0 flex-1">
									<span class="block font-medium text-surface-50">{task.title}</span>
									{#if task.notes}
										<span class="mt-1 block text-sm text-surface-400">{task.notes}</span>
									{/if}
								</span>
							</label>
						{/each}
					{/if}
				</div>
			</section>
		{/each}
	</div>
</section>
