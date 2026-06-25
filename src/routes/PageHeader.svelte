<script lang="ts">
	import { goto } from '$app/navigation';
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import { ArrowLeft } from '@lucide/svelte';

	let {
		title,
		description,
		backHref = '/',
		backLabel = 'Back to Manage'
	}: {
		title: string;
		description: string;
		backHref?: string;
		backLabel?: string;
	} = $props();

	function goBack(): void {
		void goto(backHref);
	}
</script>

<header class="border-b border-surface-800 pb-5">
	<AppBar class="bg-transparent p-0">
		<AppBar.Toolbar class="grid-cols-[minmax(0,1fr)] gap-4 p-0 md:grid-cols-[minmax(0,1fr)_auto]">
			<AppBar.Headline class="min-w-0">
				<h1 class="text-3xl font-semibold tracking-normal text-surface-50">{title}</h1>
				<p class="mt-1 text-sm text-surface-400">{description}</p>
			</AppBar.Headline>
			<AppBar.Trail class="justify-start md:justify-end">
				<button class="btn preset-tonal-surface" type="button" onclick={goBack}>
					<ArrowLeft size={18} aria-hidden="true" />
					{backLabel}
				</button>
			</AppBar.Trail>
		</AppBar.Toolbar>
	</AppBar>
</header>
