<script lang="ts">
	import { ArrowLeft, CheckCircle2 } from '@lucide/svelte';
	import { countTasks, describeSchedule, getNextReset, titleCase } from '$lib/checklists';

	let {
		checklist,
		now,
		onBack,
		onToggleTask,
		taskIsDone,
		sectionProgress
	}: {
		checklist: Checklist;
		now: Date;
		onBack: () => void;
		onToggleTask: (section: ChecklistSection, task: ChecklistTask, checked: boolean) => void;
		taskIsDone: (section: ChecklistSection, task: ChecklistTask) => boolean;
		sectionProgress: (section: ChecklistSection) => { done: number; total: number };
	} = $props();

	function formatUtcReset(date: Date | null): string {
		return formatResetDate(date, 'UTC');
	}

	function formatLocalReset(date: Date | null): string {
		return formatResetDate(date);
	}

	function formatResetDate(date: Date | null, timeZone?: string): string {
		if (!date) return 'Not scheduled';

		const formatter = new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			...(timeZone ? { timeZone } : {}),
			timeZoneName: 'short'
		});

		return formatter.format(date);
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
									onchange={(event) => onToggleTask(section, task, event.currentTarget.checked)}
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
