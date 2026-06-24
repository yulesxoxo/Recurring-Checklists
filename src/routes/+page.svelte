<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ArrowLeft,
		CheckCircle2,
		ClipboardList,
		Copy,
		DoorOpen,
		Download,
		Pencil,
		Plus,
		RotateCcw,
		Save,
		Trash2,
		Upload
	} from '@lucide/svelte';
	import {
		DIRECT_LINK_PARAM,
		LEGACY_DIRECT_LINK_PARAM,
		alignDateToWeekday,
		checklistIdFromSearch,
		countTasks,
		createEmptyAppState,
		dateInputMinForWeekday,
		directLinkValue,
		devFrequencies,
		describeSchedule,
		exportPortableChecklist,
		formatLocalReset,
		formatResetPair,
		formatUtcReset,
		getCompletion,
		getNextReset,
		getResetWindowStart,
		importPortableChecklists,
		isTaskComplete,
		linkKeyConflict,
		loadAppState,
		normalizeLinkKey,
		normalizeSchedule,
		productionFrequencies,
		saveAppState,
		scheduleInputTime,
		scheduleInputTimeToUtc,
		todayUtc,
		titleCase,
		weekdays,
		type AppState,
		type Checklist,
		type ChecklistSection,
		type ChecklistTask,
		type Frequency,
		type ScheduleTimeMode,
		type Weekday
	} from '$lib/checklists';

	type Mode = 'manage' | 'view';

	const frequencies: Frequency[] = import.meta.env.DEV
		? [...productionFrequencies, ...devFrequencies]
		: productionFrequencies;

	let appState = $state<AppState>(createEmptyAppState());
	let mode = $state<Mode>('manage');
	let selectedChecklistId = $state<string | null>(null);
	let editingChecklist = $state<Checklist | null>(null);
	let editingErrors = $state<{ linkKey?: string }>({});
	let importInput = $state<HTMLInputElement>();
	let importFeedback = $state('');
	let copyFeedback = $state('');
	let mounted = false;
	let now = $state(new Date());

	let selectedChecklist = $derived(
		appState.checklists.find((checklist) => checklist.id === selectedChecklistId) ?? null
	);

	onMount(() => {
		appState = loadAppState(localStorage, { allowDevFrequencies: import.meta.env.DEV });
		mounted = true;
		persist();
		enterChecklistFromUrl(true);

		const timer = window.setInterval(() => {
			now = new Date();
		}, 60_000);

		const onPopState = () => enterChecklistFromUrl(false);
		window.addEventListener('popstate', onPopState);

		return () => {
			window.clearInterval(timer);
			window.removeEventListener('popstate', onPopState);
		};
	});

	function persist(): void {
		if (mounted) saveAppState(localStorage, appState);
	}

	function enterChecklistFromUrl(replaceHistory: boolean): void {
		const checklistId = checklistIdFromSearch(window.location.search, appState.checklists);
		const checklist = appState.checklists.find((item) => item.id === checklistId);

		if (checklist) {
			enterChecklist(checklist, false);
			if (replaceHistory) updateChecklistQuery(directLinkValue(checklist), true);
			return;
		}

		mode = 'manage';
		selectedChecklistId = null;
		const params = new URLSearchParams(window.location.search);
		if ((params.has(DIRECT_LINK_PARAM) || params.has(LEGACY_DIRECT_LINK_PARAM)) && replaceHistory) {
			updateChecklistQuery(null, true);
		}
	}

	function updateChecklistQuery(checklistValue: string | null, replace = false): void {
		if (!mounted) return;

		const url = new URL(window.location.href);
		url.searchParams.delete(LEGACY_DIRECT_LINK_PARAM);
		if (checklistValue) {
			url.searchParams.set(DIRECT_LINK_PARAM, checklistValue);
		} else {
			url.searchParams.delete(DIRECT_LINK_PARAM);
		}

		const method = replace ? 'replaceState' : 'pushState';
		window.history[method]({}, '', url);
	}

	function checklistUrl(checklist: Checklist): string {
		const url = new URL(window.location.href);
		url.searchParams.delete(LEGACY_DIRECT_LINK_PARAM);
		url.searchParams.set(DIRECT_LINK_PARAM, directLinkValue(checklist));

		const search = url.searchParams.toString();
		if (url.pathname === '/') return `${url.origin}?${search}`;
		return `${url.origin}${url.pathname}?${search}`;
	}

	async function copyChecklistLink(checklist: Checklist): Promise<void> {
		copyFeedback = '';
		await navigator.clipboard.writeText(checklistUrl(checklist));
		copyFeedback = `Copied link for "${checklist.name}".`;
	}

	function exportDefinition(checklist: Checklist): void {
		importFeedback = '';
		const portable = exportPortableChecklist(checklist);
		const blob = new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${filenameSlug(checklist.name)}-checklist.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	function openImportPicker(): void {
		importInput?.click();
	}

	async function importDefinitions(event: Event): Promise<void> {
		importFeedback = '';
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const result = importPortableChecklists(await file.text(), {
			allowDevFrequencies: import.meta.env.DEV
		});

		if (!result.ok) {
			importFeedback = result.error;
			return;
		}

		const conflict = linkKeyConflict(appState.checklists, result.checklist.linkKey);
		if (conflict) {
			editingChecklist = result.checklist;
			editingErrors = {
				linkKey: `This link key is already used by "${conflict.name}".`
			};
			importFeedback = 'Imported checklist needs a unique link key before it can be saved.';
			return;
		}

		appState.checklists = [...appState.checklists, result.checklist];
		importFeedback = `Imported "${result.checklist.name}".`;
		persist();
	}

	function createChecklist(): void {
		editingErrors = {};
		editingChecklist = {
			id: createId(),
			name: '',
			description: '',
			sections: [createSection('Daily', 'daily')]
		};
	}

	function editChecklist(checklist: Checklist): void {
		editingErrors = {};
		editingChecklist = cloneChecklist(checklist);
	}

	function saveChecklist(): void {
		if (!editingChecklist) return;

		const linkKey = normalizeLinkKey(editingChecklist.linkKey);
		const conflict = linkKeyConflict(appState.checklists, linkKey, editingChecklist.id);
		if (conflict) {
			editingErrors = {
				linkKey: `This link key is already used by "${conflict.name}".`
			};
			return;
		}

		const checklist: Checklist = {
			...cloneChecklist(editingChecklist),
			name: editingChecklist.name.trim() || 'Untitled checklist',
			description: editingChecklist.description.trim(),
			linkKey,
			sections: editingChecklist.sections.map((section) => ({
				...section,
				name: section.name.trim() || 'Untitled section',
				schedule: normalizeSchedule(section.schedule, {
					allowDevFrequencies: import.meta.env.DEV
				}) ?? {
					frequency: 'daily',
					resetTimeUtc: '05:00',
					timeMode: 'utc'
				},
				tasks: section.tasks.map((task) => ({
					...task,
					title: task.title.trim() || 'Untitled task',
					notes: task.notes?.trim() || undefined
				}))
			}))
		};

		const existingIndex = appState.checklists.findIndex((item) => item.id === checklist.id);
		if (existingIndex === -1) {
			appState.checklists = [...appState.checklists, checklist];
		} else {
			appState.checklists = appState.checklists.map((item) =>
				item.id === checklist.id ? checklist : item
			);
		}

		cleanupCompletions(checklist);
		editingChecklist = null;
		editingErrors = {};
		persist();
	}

	function deleteChecklist(checklist: Checklist): void {
		if (
			!window.confirm(`Delete "${checklist.name}"? Completion history for it will also be removed.`)
		) {
			return;
		}

		appState.checklists = appState.checklists.filter((item) => item.id !== checklist.id);
		delete appState.completions[checklist.id];
		if (selectedChecklistId === checklist.id) {
			selectedChecklistId = null;
			mode = 'manage';
			updateChecklistQuery(null);
		}
		if (editingChecklist?.id === checklist.id) editingChecklist = null;
		persist();
	}

	function enterChecklist(checklist: Checklist, updateUrl = true): void {
		selectedChecklistId = checklist.id;
		mode = 'view';
		editingChecklist = null;
		now = new Date();
		if (updateUrl) updateChecklistQuery(directLinkValue(checklist));
	}

	function backToManage(): void {
		mode = 'manage';
		selectedChecklistId = null;
		now = new Date();
		updateChecklistQuery(null);
	}

	function addStarterTemplate(): void {
		const checklist: Checklist = {
			id: createId(),
			name: 'NTE Recurring Checklist',
			description: 'Daily, weekly, and bi-weekly operating checks with UTC reset windows.',
			linkKey: 'NTE',
			sections: [
				{
					...createSection('Daily', 'daily'),
					tasks: [
						createTask('Review open exceptions'),
						createTask('Confirm required reports were generated'),
						createTask('Record follow-ups for blocked items')
					]
				},
				{
					...createSection('Weekly', 'weekly'),
					tasks: [
						createTask('Audit recurring checklist coverage'),
						createTask('Review aged unresolved items'),
						createTask('Update weekly summary')
					]
				},
				{
					...createSection('Bi-Weekly', 'biweekly'),
					tasks: [
						createTask('Review process drift'),
						createTask('Refresh escalation owners'),
						createTask('Validate bi-weekly reporting inputs')
					]
				}
			]
		};

		const conflict = linkKeyConflict(appState.checklists, checklist.linkKey);
		if (conflict) {
			editingChecklist = checklist;
			editingErrors = {
				linkKey: `This link key is already used by "${conflict.name}".`
			};
			importFeedback = 'The starter template needs a unique link key before it can be saved.';
			return;
		}

		appState.checklists = [...appState.checklists, checklist];
		persist();
	}

	function addSection(): void {
		if (!editingChecklist) return;
		editingChecklist.sections = [
			...editingChecklist.sections,
			createSection('New section', 'daily')
		];
	}

	function removeSection(sectionId: string): void {
		if (!editingChecklist) return;
		editingChecklist.sections = editingChecklist.sections.filter(
			(section) => section.id !== sectionId
		);
	}

	function addTask(section: ChecklistSection): void {
		section.tasks = [...section.tasks, createTask('New task')];
	}

	function removeTask(section: ChecklistSection, taskId: string): void {
		section.tasks = section.tasks.filter((task) => task.id !== taskId);
	}

	function updateFrequency(section: ChecklistSection, frequency: Frequency): void {
		section.schedule =
			normalizeSchedule(
				{
					...section.schedule,
					frequency,
					resetWeekday: frequency === 'weekly' || frequency === 'biweekly' ? 'monday' : undefined,
					anchorDate:
						frequency === 'biweekly'
							? alignDateToWeekday(section.schedule.anchorDate ?? todayUtc(), 'monday')
							: undefined
				},
				{ allowDevFrequencies: import.meta.env.DEV }
			) ?? section.schedule;
	}

	function updateScheduleTimeMode(section: ChecklistSection, timeMode: ScheduleTimeMode): void {
		section.schedule = {
			...section.schedule,
			timeMode
		};
	}

	function updateScheduleInputTime(section: ChecklistSection, time: string): void {
		section.schedule = {
			...section.schedule,
			resetTimeUtc: scheduleInputTimeToUtc(time, section.schedule.timeMode ?? 'utc', now)
		};
	}

	function updateResetWeekday(section: ChecklistSection, resetWeekday: Weekday): void {
		section.schedule.resetWeekday = resetWeekday;
		if (section.schedule.frequency === 'biweekly') {
			section.schedule.anchorDate = alignDateToWeekday(
				section.schedule.anchorDate ?? todayUtc(),
				resetWeekday
			);
		}
	}

	function updateAnchorDate(section: ChecklistSection, anchorDate: string): void {
		section.schedule.anchorDate = alignDateToWeekday(
			anchorDate,
			section.schedule.resetWeekday ?? 'monday'
		);
	}

	function toggleTask(section: ChecklistSection, task: ChecklistTask, checked: boolean): void {
		if (!selectedChecklist) return;

		appState.completions[selectedChecklist.id] ??= {};
		appState.completions[selectedChecklist.id][section.id] ??= {};

		if (checked) {
			appState.completions[selectedChecklist.id][section.id][task.id] = {
				completedAt: new Date().toISOString()
			};
		} else {
			delete appState.completions[selectedChecklist.id][section.id][task.id];
		}

		now = new Date();
		persist();
	}

	function taskIsDone(section: ChecklistSection, task: ChecklistTask): boolean {
		if (!selectedChecklist) return false;

		return isTaskComplete(
			section,
			getCompletion(appState.completions, selectedChecklist.id, section.id, task.id),
			now
		);
	}

	function sectionProgress(section: ChecklistSection): { done: number; total: number } {
		return {
			done: section.tasks.filter((task) => taskIsDone(section, task)).length,
			total: section.tasks.length
		};
	}

	function createSection(name: string, frequency: Frequency): ChecklistSection {
		const resetWeekday = frequency === 'weekly' || frequency === 'biweekly' ? 'monday' : undefined;

		return {
			id: createId(),
			name,
			schedule: normalizeSchedule(
				{
					frequency,
					resetTimeUtc: '05:00',
					timeMode: 'utc',
					resetWeekday,
					anchorDate:
						frequency === 'biweekly'
							? alignDateToWeekday(todayUtc(), resetWeekday ?? 'monday')
							: undefined
				},
				{ allowDevFrequencies: import.meta.env.DEV }
			) ?? {
				frequency: 'daily',
				resetTimeUtc: '05:00',
				timeMode: 'utc'
			},
			tasks: [createTask('New task')]
		};
	}

	function createTask(title: string): ChecklistTask {
		return {
			id: createId(),
			title,
			notes: ''
		};
	}

	function cancelEditing(): void {
		editingChecklist = null;
		editingErrors = {};
	}

	function cleanupCompletions(checklist: Checklist): void {
		const checklistCompletions = appState.completions[checklist.id];
		if (!checklistCompletions) return;

		const sectionIds = new Set(checklist.sections.map((section) => section.id));
		for (const sectionId of Object.keys(checklistCompletions)) {
			if (!sectionIds.has(sectionId)) {
				delete checklistCompletions[sectionId];
				continue;
			}

			const section = checklist.sections.find((item) => item.id === sectionId);
			const taskIds = new Set(section?.tasks.map((task) => task.id) ?? []);
			for (const taskId of Object.keys(checklistCompletions[sectionId])) {
				if (!taskIds.has(taskId)) delete checklistCompletions[sectionId][taskId];
			}
		}
	}

	function cloneChecklist(checklist: Checklist): Checklist {
		return JSON.parse(JSON.stringify(checklist)) as Checklist;
	}

	function createId(): string {
		return (
			globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
		);
	}

	function filenameSlug(value: string): string {
		return (
			value
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '') || 'checklist'
		);
	}
</script>

<svelte:head>
	<title>Recurring Checklists</title>
	<meta
		name="description"
		content="Client-side recurring checklists with local completion state and UTC reset windows."
	/>
</svelte:head>

<main class="min-h-screen bg-surface-950 text-surface-50">
	{#if mode === 'manage'}
		<section class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
			<header
				class="flex flex-col gap-4 border-b border-surface-800 pb-5 md:flex-row md:items-end md:justify-between"
			>
				<div class="min-w-0">
					<div class="mb-2 flex items-center gap-2 text-sm font-medium text-surface-400">
						<ClipboardList size={18} aria-hidden="true" />
						<span>{appState.checklists.length} checklists</span>
					</div>
					<h1 class="text-3xl font-semibold tracking-normal text-surface-50">Manage Checklists</h1>
				</div>
				<div class="flex flex-col gap-2 sm:flex-row">
					<input
						bind:this={importInput}
						class="hidden"
						type="file"
						accept="application/json,.json"
						onchange={importDefinitions}
					/>
					<button class="btn preset-tonal-surface" type="button" onclick={openImportPicker}>
						<Upload size={18} aria-hidden="true" />
						Import
					</button>
					<button class="btn preset-tonal-surface" type="button" onclick={addStarterTemplate}>
						<RotateCcw size={18} aria-hidden="true" />
						NTE Template
					</button>
					<button class="btn preset-filled-primary-500" type="button" onclick={createChecklist}>
						<Plus size={18} aria-hidden="true" />
						Create new Checklist
					</button>
				</div>
			</header>

			{#if importFeedback || copyFeedback}
				<p
					class="rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300"
				>
					{importFeedback || copyFeedback}
				</p>
			{/if}

			<div class="flex flex-col gap-6">
				<section class="min-w-0">
					{#if appState.checklists.length === 0}
						<div
							class="rounded-container border border-dashed border-surface-700 bg-surface-900 p-8 text-center shadow-sm"
						>
							<ClipboardList class="mx-auto mb-4 text-surface-400" size={36} aria-hidden="true" />
							<h2 class="text-xl font-semibold text-surface-50">No checklists yet</h2>
							<p class="mx-auto mt-2 max-w-xl text-sm text-surface-400">
								Create a checklist from scratch or add the NTE template to start with daily, weekly,
								and bi-weekly reset sections.
							</p>
						</div>
					{:else}
						<div
							class="overflow-hidden rounded-container border border-surface-800 bg-surface-900 shadow-sm"
						>
							<div
								class="hidden grid-cols-[minmax(220px,1fr)_120px_100px_260px] gap-4 border-b border-surface-800 bg-surface-800 px-4 py-3 text-xs font-semibold uppercase text-surface-300 md:grid"
							>
								<span>Checklist</span>
								<span>Sections</span>
								<span>Tasks</span>
								<span class="text-right">Actions</span>
							</div>
							<div class="divide-y divide-surface-800">
								{#each appState.checklists as checklist (checklist.id)}
									<article
										class="grid gap-3 px-4 py-4 md:grid-cols-[minmax(220px,1fr)_120px_100px_260px] md:items-center"
									>
										<div class="min-w-0">
											<h2 class="truncate text-base font-semibold text-surface-50">
												{checklist.name}
											</h2>
											<p class="mt-1 line-clamp-2 text-sm text-surface-400">
												{checklist.description || 'No description'}
											</p>
										</div>
										<div>
											<span class="badge preset-tonal-primary"
												>{checklist.sections.length} sections</span
											>
										</div>
										<div>
											<span class="badge preset-tonal-surface">{countTasks(checklist)} tasks</span>
										</div>
										<div class="flex justify-start gap-2 md:justify-end">
											<button
												class="btn btn-sm preset-filled-primary-500"
												type="button"
												onclick={() => enterChecklist(checklist)}
											>
												<DoorOpen size={16} aria-hidden="true" />
												Enter
											</button>
											<button
												class="btn-icon btn-icon-sm preset-tonal-surface"
												type="button"
												title="Copy direct link"
												aria-label="Copy direct link"
												onclick={() => copyChecklistLink(checklist)}
											>
												<Copy size={16} aria-hidden="true" />
											</button>
											<button
												class="btn-icon btn-icon-sm preset-tonal-surface"
												type="button"
												title="Export checklist"
												aria-label="Export checklist"
												onclick={() => exportDefinition(checklist)}
											>
												<Download size={16} aria-hidden="true" />
											</button>
											<button
												class="btn-icon btn-icon-sm preset-tonal-surface"
												type="button"
												title="Edit checklist"
												aria-label="Edit checklist"
												onclick={() => editChecklist(checklist)}
											>
												<Pencil size={16} aria-hidden="true" />
											</button>
											<button
												class="btn-icon btn-icon-sm preset-tonal-error"
												type="button"
												title="Delete checklist"
												aria-label="Delete checklist"
												onclick={() => deleteChecklist(checklist)}
											>
												<Trash2 size={16} aria-hidden="true" />
											</button>
										</div>
									</article>
								{/each}
							</div>
						</div>
					{/if}
				</section>

				{#if editingChecklist}
					<section class="rounded-container border border-surface-800 bg-surface-900 p-5 shadow-sm">
						<form class="flex flex-col gap-5" onsubmit={(event) => event.preventDefault()}>
							<div class="flex items-start justify-between gap-3">
								<div>
									<h2 class="text-lg font-semibold text-surface-50">Checklist editor</h2>
									<p class="text-sm text-surface-400">Changes save locally in this browser.</p>
								</div>
								<button
									class="btn-icon btn-icon-sm preset-tonal-surface"
									type="button"
									title="Cancel editing"
									aria-label="Cancel editing"
									onclick={cancelEditing}
								>
									x
								</button>
							</div>

							<label class="label">
								<span class="label-text">Name</span>
								<input
									class="input"
									bind:value={editingChecklist.name}
									placeholder="Checklist name"
								/>
							</label>

							<label class="label">
								<span class="label-text">Description</span>
								<textarea
									class="textarea"
									bind:value={editingChecklist.description}
									rows="3"
									placeholder="Short description"></textarea>
							</label>

							<label class="label">
								<span class="label-text">Direct link key</span>
								<input
									class={`input ${editingErrors.linkKey ? 'border-error-500' : ''}`}
									bind:value={editingChecklist.linkKey}
									placeholder="Optional, for example NTE"
									oninput={() => (editingErrors.linkKey = undefined)}
								/>
								<span
									class={editingErrors.linkKey
										? 'text-xs text-error-400'
										: 'text-xs text-surface-400'}
								>
									{editingErrors.linkKey ||
										`Used in links as ?${DIRECT_LINK_PARAM}=value. Matching is case-insensitive.`}
								</span>
							</label>

							<div class="flex items-center justify-between gap-3 border-t border-surface-800 pt-4">
								<h3 class="text-base font-semibold text-surface-50">Sections</h3>
								<button class="btn btn-sm preset-tonal-primary" type="button" onclick={addSection}>
									<Plus size={16} aria-hidden="true" />
									Section
								</button>
							</div>

							<div class="flex flex-col gap-4">
								{#each editingChecklist.sections as section (section.id)}
									<section class="rounded-base border border-surface-800 bg-surface-950 p-4">
										<div class="mb-3 flex items-start justify-between gap-3">
											<label class="label flex-1">
												<span class="label-text">Section name</span>
												<input class="input" bind:value={section.name} placeholder="Daily" />
											</label>
											<button
												class="btn-icon btn-icon-sm preset-tonal-error mt-6"
												type="button"
												title="Delete section"
												aria-label="Delete section"
												onclick={() => removeSection(section.id)}
											>
												<Trash2 size={16} aria-hidden="true" />
											</button>
										</div>

										<div class="grid gap-3 sm:grid-cols-2">
											<label class="label">
												<span class="label-text">Frequency</span>
												<select
													class="select"
													value={section.schedule.frequency}
													onchange={(event) =>
														updateFrequency(section, event.currentTarget.value as Frequency)}
												>
													{#each frequencies as frequency}
														<option value={frequency}>{titleCase(frequency)}</option>
													{/each}
												</select>
											</label>

											<div class="label">
												<span class="label-text">Reset time</span>
												<div
													class="grid grid-cols-2 overflow-hidden rounded-base border border-surface-700"
												>
													<button
														class={`btn btn-sm rounded-none ${
															(section.schedule.timeMode ?? 'utc') === 'local'
																? 'preset-filled-primary-500'
																: 'preset-tonal-surface'
														}`}
														type="button"
														onclick={() => updateScheduleTimeMode(section, 'local')}
													>
														Local time
													</button>
													<button
														class={`btn btn-sm rounded-none ${
															(section.schedule.timeMode ?? 'utc') === 'utc'
																? 'preset-filled-primary-500'
																: 'preset-tonal-surface'
														}`}
														type="button"
														onclick={() => updateScheduleTimeMode(section, 'utc')}
													>
														UTC
													</button>
												</div>
												<input
													class="input"
													type="time"
													value={scheduleInputTime(section.schedule, now)}
													onchange={(event) =>
														updateScheduleInputTime(section, event.currentTarget.value)}
												/>
												<span class="text-xs text-surface-400">
													Local {scheduleInputTime({ ...section.schedule, timeMode: 'local' }, now)}
													/ UTC {section.schedule.resetTimeUtc}
												</span>
											</div>
										</div>

										{#if section.schedule.frequency === 'weekly' || section.schedule.frequency === 'biweekly'}
											<div class="mt-3 grid gap-3 sm:grid-cols-2">
												<label class="label">
													<span class="label-text">Reset weekday</span>
													<select
														class="select"
														value={section.schedule.resetWeekday}
														onchange={(event) =>
															updateResetWeekday(section, event.currentTarget.value as Weekday)}
													>
														{#each weekdays as weekday}
															<option value={weekday}>{titleCase(weekday)}</option>
														{/each}
													</select>
												</label>

												{#if section.schedule.frequency === 'biweekly'}
													<label class="label">
														<span class="label-text">Anchor date</span>
														<input
															class="input"
															type="date"
															min={dateInputMinForWeekday(
																section.schedule.resetWeekday ?? 'monday'
															)}
															step="7"
															value={section.schedule.anchorDate}
															onchange={(event) =>
																updateAnchorDate(section, event.currentTarget.value)}
														/>
														<span class="text-xs text-surface-400">
															Only the selected reset weekday is valid.
														</span>
													</label>
												{/if}
											</div>
										{/if}

										<div
											class="mt-3 grid gap-1 rounded-base border border-surface-800 bg-surface-900 px-3 py-2 text-sm text-surface-300 sm:grid-cols-2"
										>
											<div>
												<span class="font-medium text-surface-100">Previous reset:</span>
												{formatResetPair(getResetWindowStart(section.schedule, now))}
											</div>
											<div>
												<span class="font-medium text-surface-100">Next reset:</span>
												{formatResetPair(getNextReset(section.schedule, now))}
											</div>
										</div>

										<div class="mt-4 flex items-center justify-between gap-3">
											<h4 class="text-sm font-semibold text-surface-300">Tasks</h4>
											<button
												class="btn btn-sm preset-tonal-surface"
												type="button"
												onclick={() => addTask(section)}
											>
												<Plus size={16} aria-hidden="true" />
												Task
											</button>
										</div>

										<div class="mt-3 flex flex-col gap-3">
											{#each section.tasks as task (task.id)}
												<div
													class="grid gap-2 rounded-base border border-surface-800 bg-surface-900 p-3"
												>
													<div class="flex gap-2">
														<label class="label flex-1">
															<span class="label-text">Task title</span>
															<input
																class="input"
																bind:value={task.title}
																placeholder="Task title"
															/>
														</label>
														<button
															class="btn-icon btn-icon-sm preset-tonal-error mt-6"
															type="button"
															title="Delete task"
															aria-label="Delete task"
															onclick={() => removeTask(section, task.id)}
														>
															<Trash2 size={16} aria-hidden="true" />
														</button>
													</div>
													<label class="label">
														<span class="label-text">Notes</span>
														<textarea
															class="textarea"
															bind:value={task.notes}
															rows="2"
															placeholder="Optional notes"></textarea>
													</label>
												</div>
											{/each}
										</div>
									</section>
								{/each}
							</div>

							<div class="flex justify-end gap-2 border-t border-surface-800 pt-4">
								<button class="btn preset-tonal-surface" type="button" onclick={cancelEditing}>
									Cancel
								</button>
								<button class="btn preset-filled-success-500" type="button" onclick={saveChecklist}>
									<Save size={18} aria-hidden="true" />
									Save
								</button>
							</div>
						</form>
					</section>
				{/if}
			</div>
		</section>
	{:else if selectedChecklist}
		<section class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
			<header class="border-b border-surface-800 pb-5">
				<button class="btn preset-tonal-surface mb-4" type="button" onclick={backToManage}>
					<ArrowLeft size={18} aria-hidden="true" />
					Back to Manage
				</button>
				<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
					<div class="min-w-0">
						<h1 class="text-3xl font-semibold text-surface-50">{selectedChecklist.name}</h1>
						<p class="mt-2 text-sm text-surface-400">
							{selectedChecklist.description || 'No description'}
						</p>
					</div>
					<span class="badge preset-tonal-primary">{countTasks(selectedChecklist)} tasks</span>
				</div>
			</header>

			<div class="grid gap-5">
				{#each selectedChecklist.sections as section (section.id)}
					{@const progress = sectionProgress(section)}
					<section class="rounded-container border border-surface-800 bg-surface-900 p-4 shadow-sm">
						<div
							class="flex flex-col gap-3 border-b border-surface-800 pb-4 md:flex-row md:items-start md:justify-between"
						>
							<div class="min-w-0">
								<h2 class="text-xl font-semibold text-surface-50">{section.name}</h2>
								<p class="mt-1 text-sm text-surface-400">{describeSchedule(section.schedule)}</p>
								<p class="mt-1 text-sm text-surface-400">
									Next reset local: {formatLocalReset(getNextReset(section.schedule, now))}
								</p>
								<p class="mt-1 text-sm text-surface-400">
									Next reset UTC: {formatUtcReset(getNextReset(section.schedule, now))}
								</p>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<span class="badge preset-tonal-success">
									<CheckCircle2 size={14} aria-hidden="true" />
									{progress.done} / {progress.total} done
								</span>
								<span class="badge preset-tonal-surface"
									>{titleCase(section.schedule.frequency)}</span
								>
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
	{:else}
		<section class="mx-auto max-w-3xl px-4 py-10">
			<button class="btn preset-tonal-surface mb-4" type="button" onclick={backToManage}>
				<ArrowLeft size={18} aria-hidden="true" />
				Back to Manage
			</button>
			<div
				class="rounded-container border border-surface-800 bg-surface-900 p-8 text-center shadow-sm"
			>
				<h1 class="text-2xl font-semibold text-surface-50">Checklist not found</h1>
				<p class="mt-2 text-sm text-surface-400">
					Return to manage mode and choose an available checklist.
				</p>
			</div>
		</section>
	{/if}
</main>
