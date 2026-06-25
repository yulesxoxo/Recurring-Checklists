<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import { ArrowLeft } from '@lucide/svelte';

	let {
		title,
		description,
		backHref = '/',
		backLabel = 'Back to Manage',
		showBack = true,
		trail
	}: {
		title: string;
		description: string;
		backHref?: PathnameWithSearchOrHash;
		backLabel?: string;
		showBack?: boolean;
		trail?: import('svelte').Snippet;
	} = $props();

	function goBack(): void {
		void goto(resolve(backHref));
	}
</script>

<header class="border-b border-surface-800 pb-5">
	<AppBar class="bg-transparent p-0">
		<AppBar.Toolbar class="grid-cols-[minmax(0,1fr)] gap-4 p-0 md:grid-cols-[minmax(0,1fr)_auto]">
			<AppBar.Headline class="min-w-0">
				<h1 class="text-3xl font-semibold tracking-normal text-surface-50">{title}</h1>
				<p class="mt-1 text-sm text-surface-400">{description}</p>
			</AppBar.Headline>
			{#if showBack || trail}
				<AppBar.Trail class="justify-start md:justify-end">
					{#if trail}
						{@render trail()}
					{/if}
					{#if showBack}
						<button class="btn preset-tonal-surface" type="button" onclick={goBack}>
							<ArrowLeft size={18} aria-hidden="true" />
							{backLabel}
						</button>
					{/if}
				</AppBar.Trail>
			{/if}
		</AppBar.Toolbar>
	</AppBar>
</header>
