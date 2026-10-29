<script lang="ts">
	import { untrack } from 'svelte';
	import { IconArrowsSplit, IconPlayerPlay, IconSearch, IconX } from '@tabler/icons-svelte';
	import { api, post } from '$lib/api';
	import { toastStore } from '$lib/client/toast.svelte';
	import { coverUrl } from '$lib/cover-image';
	import type { ArtistSearchResult, ArtistStats } from '$lib/artist-distribution';

	let { focusArtist = null }: { focusArtist?: string | null } = $props();

	let query = $state('');
	let suggestions = $state<ArtistSearchResult[]>([]);
	let searching = $state(false);
	let focused = $state(false);
	let cursor = $state(-1);
	let searchWrap = $state<HTMLDivElement>();

	let selected = $state<string | null>(null);
	let stats = $state<ArtistStats | null>(null);
	let loading = $state(false);
	let error = $state('');
	let includeSkipped = $state(false);
	let playing = $state(false);
	let showAllClusters = $state(false);

	let searchSeq = 0;
	let loadSeq = 0;

	// Colours follow the atlas so a vibe reads the same on both tabs.
	function clusterColor(clusterId: number): string {
		const hue = (clusterId * 137.508 + 18) % 360;
		return `hsl(${hue} 68% 55%)`;
	}

	function percent(fraction: number): string {
		return `${Math.round(fraction * 100)}%`;
	}

	/** Debounce the box, and drop responses that a newer keystroke superseded. */
	$effect(() => {
		const text = query.trim();
		const seq = ++searchSeq;
		searching = true;
		const timer = setTimeout(
			() => {
				void api<{ artists: ArtistSearchResult[] }>(
					`/api/artists?q=${encodeURIComponent(text)}`
				).then(({ ok, data }) => {
					if (seq !== searchSeq) return;
					suggestions = ok ? (data.artists ?? []) : [];
					searching = false;
					cursor = -1;
				});
			},
			text ? 180 : 0
		);
		return () => clearTimeout(timer);
	});

	async function loadArtist(name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		selected = trimmed;
		query = trimmed;
		focused = false;
		cursor = -1;
		showAllClusters = false;
		const seq = ++loadSeq;
		loading = true;
		error = '';

		const params = `name=${encodeURIComponent(trimmed)}${includeSkipped ? '&includeSkipped=1' : ''}`;
		const { ok, data } = await api<{ artist?: ArtistStats; error?: string }>(
			`/api/artist-stats?${params}`
		);
		if (seq !== loadSeq) return;

		loading = false;
		stats = ok && data.artist ? data.artist : null;
		error = stats ? '' : (data.error ?? 'Could not load that artist');
		syncUrl(stats?.name ?? trimmed);
	}

	function reload() {
		if (selected) void loadArtist(selected);
	}

	/** Keep the artist in the URL so the view can be linked to and reloaded. */
	function syncUrl(name: string | null) {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.set('tab', 'artists');
		if (name) url.searchParams.set('artist', name);
		else url.searchParams.delete('artist');
		history.replaceState(history.state, '', url);
	}

	function choose(artist: ArtistSearchResult) {
		void loadArtist(artist.name);
	}

	function onSearchKeyDown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			cursor = Math.min(cursor + 1, suggestions.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			cursor = Math.max(cursor - 1, -1);
		} else if (event.key === 'Escape') {
			focused = false;
			cursor = -1;
		}
	}

	function onSearchSubmit(event: SubmitEvent) {
		event.preventDefault();
		const pick = suggestions[cursor] ?? suggestions[0];
		if (pick) choose(pick);
		else if (query.trim()) void loadArtist(query);
	}

	function onFocusOut(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (!next || !searchWrap?.contains(next)) {
			focused = false;
			cursor = -1;
		}
	}

	async function playSample(artist: ArtistStats) {
		if (playing || artist.sampleUris.length === 0) return;
		playing = true;
		const { ok } = await post('/api/player', { uris: artist.sampleUris });
		playing = false;
		if (ok) toastStore.show(`Playing a ${artist.sampleUris.length}-track sample`);
	}

	function tiles(artist: ArtistStats) {
		const lead = artist.distribution[0];
		return [
			{
				label: 'Tracks',
				value: artist.trackCount.toLocaleString(),
				hint: `${artist.albumCount.toLocaleString()} album${artist.albumCount === 1 ? '' : 's'}`
			},
			{
				label: 'Vibes touched',
				value: `${artist.clusterCount}/${artist.totalClusters}`,
				hint: `${percent(artist.summary.reach)} of the map`
			},
			{
				label: 'Focus',
				value: percent(artist.summary.topShare),
				hint: lead ? `in ${lead.name}` : 'no cluster yet'
			},
			{
				label: 'Spread',
				value: artist.summary.spread.toFixed(1),
				hint: 'effective vibes'
			},
			{
				label: 'Evenness',
				value: percent(artist.summary.evenness),
				hint: artist.summary.evenness >= 0.6 ? 'no clear home' : 'settles in one place'
			}
		];
	}

	// A link can carry an artist, and a navigation can change it while mounted.
	$effect(() => {
		const wanted = focusArtist;
		if (!wanted) return;
		if (untrack(() => selected) === wanted) return;
		untrack(() => void loadArtist(wanted));
	});
</script>

<section
	class="border-ink/10 bg-cream mb-6 rounded-[2rem] border p-6 shadow-[0_18px_40px_-28px_rgba(29,21,14,0.5)] sm:p-8"
>
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div class="max-w-2xl">
			<p class="text-accent-deep text-[11px] font-bold tracking-[0.24em] uppercase">Artist lens</p>
			<h2 class="font-display mt-1 text-2xl font-black text-balance sm:text-3xl">
				Where does an artist live?
			</h2>
			<p class="text-ink-soft mt-2 text-sm leading-relaxed">
				Search one act to see how their songs spread across your vibes, plus the numbers behind it.
				Tracks pruned as duplicates are left out unless you ask for them.
			</p>
		</div>
		{#if selected}
			<button
				class="text-accent-deep text-sm font-bold underline underline-offset-4"
				onclick={() => {
					selected = null;
					stats = null;
					error = '';
					loading = false;
					includeSkipped = false;
					query = '';
					syncUrl(null);
				}}>Clear artist</button
			>
		{/if}
	</div>

	<div class="relative mt-5 max-w-xl" bind:this={searchWrap} onfocusout={onFocusOut}>
		<form onsubmit={onSearchSubmit} role="search">
			<label class="sr-only" for="artist-search">Search for an artist</label>
			<div class="relative">
				<IconSearch
					size={18}
					class="text-faded pointer-events-none absolute top-1/2 left-4 -translate-y-1/2"
				/>
				<input
					id="artist-search"
					class="border-ink/15 bg-paper focus:border-accent w-full rounded-full border py-3 pr-12 pl-11 text-sm font-bold outline-none"
					placeholder="Search an artist…"
					autocomplete="off"
					bind:value={query}
					onfocus={() => (focused = true)}
					onkeydown={onSearchKeyDown}
				/>
				{#if query}
					<button
						type="button"
						class="text-faded hover:text-ink absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1"
						aria-label="Clear search"
						onclick={() => {
							query = '';
							cursor = -1;
							focused = true;
						}}
					>
						<IconX size={16} />
					</button>
				{/if}
			</div>
		</form>

		{#if focused && (suggestions.length > 0 || searching || query.trim())}
			<div
				class="border-ink/10 bg-paper absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border shadow-xl"
			>
				<p class="text-faded px-4 pt-3 pb-1 text-[10px] font-bold tracking-[0.18em] uppercase">
					{query.trim() ? 'Matches' : 'Most represented'}
				</p>
				{#if searching && suggestions.length === 0}
					<p class="text-faded px-4 py-3 text-sm">Searching…</p>
				{:else if suggestions.length === 0}
					<p class="text-faded px-4 pb-3 text-sm">No artist matches “{query.trim()}”.</p>
				{:else}
					<ul class="pb-1">
						{#each suggestions as artist, index (artist.name)}
							<li>
								<button
									type="button"
									class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition {index ===
									cursor
										? 'bg-ink text-cream'
										: 'hover:bg-ink/5'}"
									onmouseenter={() => (cursor = index)}
									onclick={() => choose(artist)}
								>
									<span class="min-w-0 truncate font-bold">{artist.name}</span>
									<span
										class="shrink-0 text-xs tabular-nums {index === cursor
											? 'text-cream/60'
											: 'text-faded'}"
										>{artist.trackCount} tracks · {artist.clusterCount}
										vibes</span
									>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>

	{#if !selected && suggestions.length > 0}
		<div class="mt-5 flex flex-wrap items-center gap-2">
			<span class="text-faded text-[10px] font-bold tracking-[0.18em] uppercase">Start with</span>
			{#each suggestions.slice(0, 6) as artist (artist.name)}
				<button
					class="border-ink/15 text-ink-soft hover:border-ink hover:text-ink rounded-full border px-3 py-1.5 text-sm transition"
					onclick={() => choose(artist)}
				>
					{artist.name}
				</button>
			{/each}
		</div>
	{/if}
</section>

{#if loading}
	<div class="border-ink/10 bg-cream rounded-[2rem] border p-8">
		<div class="flex items-center gap-3">
			<div class="border-ink/10 border-t-accent size-5 animate-spin rounded-full border-2"></div>
			<p class="text-ink-soft text-sm font-bold">Counting vibes for {selected}…</p>
		</div>
	</div>
{:else if error}
	<div class="border-ink/10 bg-cream rounded-[2rem] border p-8">
		<p class="font-display text-xl font-black">{selected}</p>
		<p class="text-ink-soft mt-1 text-sm">{error}</p>
		<p class="text-faded mt-3 text-sm">
			Try another spelling, or check that the artist still has tracks in the library.
		</p>
	</div>
{:else if stats}
	{@const artist = stats}
	<div class="animate-rise space-y-6">
		<section class="bg-ink text-cream rounded-[2rem] p-6 sm:p-8">
			<div class="flex flex-wrap items-start justify-between gap-5">
				<div class="min-w-0">
					<p class="text-cream/50 text-[11px] font-bold tracking-[0.24em] uppercase">
						{artist.verdict.label}
					</p>
					<h2 class="font-display mt-1 text-3xl font-black text-balance break-words sm:text-4xl">
						{artist.name}
					</h2>
					<p class="text-cream/75 mt-2 max-w-2xl text-sm leading-relaxed">
						{artist.verdict.text}
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#if artist.sampleUris.length > 0}
						<button
							class="bg-accent text-cream hover:bg-accent-deep inline-flex min-h-11 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition disabled:opacity-50"
							disabled={playing}
							onclick={() => playSample(artist)}
						>
							<IconPlayerPlay size={16} />
							{playing ? 'Starting…' : 'Play a sample'}
						</button>
					{/if}
					{#if artist.distribution[0]}
						<a
							href={`/vibe?tab=browse&cluster=${artist.distribution[0].clusterId}`}
							class="bg-cream/10 hover:bg-cream/20 inline-flex min-h-11 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition"
						>
							<IconArrowsSplit size={16} />
							Open {artist.distribution[0].name}
						</a>
					{/if}
				</div>
			</div>

			<dl class="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
				{#each tiles(artist) as tile (tile.label)}
					<div class="bg-cream/8 rounded-2xl px-4 py-3.5">
						<dt class="text-cream/50 text-[10px] font-bold tracking-[0.16em] uppercase">
							{tile.label}
						</dt>
						<dd class="font-display mt-1 text-2xl font-black tabular-nums">{tile.value}</dd>
						<dd class="text-cream/55 mt-0.5 truncate text-xs" title={tile.hint}>{tile.hint}</dd>
					</div>
				{/each}
			</dl>
		</section>

		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<section class="border-ink/10 bg-cream rounded-[2rem] border p-6 sm:p-7">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<h3 class="font-display text-xl font-black">Vibe distribution</h3>
					<p class="text-faded text-xs font-bold tracking-[0.14em] uppercase">
						{artist.distribution.length} vibe{artist.distribution.length === 1 ? '' : 's'}
					</p>
				</div>
				<p class="text-ink-soft mt-1 text-sm">
					Each bar is one cluster; click it to open that sleeve in Browse.
				</p>

				{#if artist.distribution.length === 0}
					<p class="text-faded mt-6 text-sm">
						None of their {artist.trackCount} tracks have been clustered yet.
					</p>
				{:else}
					<div class="mt-4 space-y-0.5">
						{#each showAllClusters ? artist.distribution : artist.distribution.slice(0, 10) as slice (slice.clusterId)}
							<a
								href={`/vibe?tab=browse&cluster=${slice.clusterId}`}
								class="hover:bg-ink/5 focus-visible:outline-accent group grid gap-1.5 rounded-2xl px-3 py-2.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 sm:grid-cols-[2.25rem_minmax(0,11rem)_minmax(0,1fr)_4.5rem] sm:items-center sm:gap-3"
								title={`Open #${slice.clusterId} ${slice.name} in Browse`}
							>
								<span class="text-faded hidden text-xs font-bold tabular-nums sm:block"
									>#{slice.clusterId}</span
								>
								<span class="min-w-0 truncate text-sm font-bold">
									<span class="text-faded mr-1 sm:hidden">#{slice.clusterId}</span>{slice.name}
								</span>
								<div class="bg-ink/8 h-2.5 overflow-hidden rounded-full">
									<div
										class="h-full rounded-full transition-[width] duration-500"
										style={`width: ${Math.max(
											2,
											(slice.share / artist.distribution[0].share) * 100
										)}%; background: ${clusterColor(slice.clusterId)}`}
									></div>
								</div>
								<span class="text-right text-sm tabular-nums sm:text-left">
									<b>{slice.count}</b>
									<span class="text-faded ml-1 text-xs">{percent(slice.share)}</span>
								</span>
							</a>
						{/each}
					</div>
					{#if artist.distribution.length > 10}
						<button
							class="text-accent-deep mt-3 text-sm font-bold underline underline-offset-4"
							onclick={() => (showAllClusters = !showAllClusters)}
						>
							{showAllClusters ? 'Show top 10' : `Show all ${artist.distribution.length} vibes`}
						</button>
					{/if}
				{/if}

				<div class="border-ink/10 mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4">
					{#if artist.unclusteredCount > 0}
						<p class="text-faded text-xs">
							{artist.unclusteredCount} track{artist.unclusteredCount === 1 ? '' : 's'} not in a vibe
							yet
						</p>
					{/if}
					{#if artist.skippedCount > 0 || includeSkipped}
						<label class="text-ink-soft flex cursor-pointer items-center gap-2 text-xs font-bold">
							<input
								type="checkbox"
								class="accent-accent size-3.5"
								checked={includeSkipped}
								onchange={(event) => {
									includeSkipped = event.currentTarget.checked;
									reload();
								}}
							/>
							Count {artist.skippedCount} pruned duplicate{artist.skippedCount === 1 ? '' : 's'}
						</label>
					{/if}
					<p class="text-faded text-xs">{artist.summary.clusteredTracks} clustered tracks</p>
				</div>
			</section>

			<aside class="space-y-6">
				{#if artist.albums.length > 0}
					<section class="border-ink/10 bg-cream rounded-[2rem] border p-6">
						<h3 class="font-display text-lg font-black">Most represented albums</h3>
						<ul class="mt-4 space-y-3">
							{#each artist.albums as album (album.album)}
								{@const image = coverUrl(album.albumImage, 160)}
								<li class="flex items-center gap-3">
									<div class="bg-ink/5 size-11 shrink-0 overflow-hidden rounded-lg">
										{#if image}
											<img src={image} alt="" class="size-full object-cover" loading="lazy" />
										{:else}
											<div class="vinyl size-full"></div>
										{/if}
									</div>
									<div class="min-w-0">
										<p class="truncate text-sm font-bold" title={album.album}>{album.album}</p>
										<p class="text-faded text-xs">
											{album.count} track{album.count === 1 ? '' : 's'}
										</p>
									</div>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if artist.collaborators.length > 0}
					<section class="border-ink/10 bg-cream rounded-[2rem] border p-6">
						<h3 class="font-display text-lg font-black">Lands with</h3>
						<p class="text-ink-soft mt-1 text-xs">
							Artists credited on the same tracks — tap one to follow the thread.
						</p>
						<div class="mt-3 flex flex-wrap gap-1.5">
							{#each artist.collaborators as collaborator (collaborator.name)}
								<button
									class="border-ink/15 hover:border-ink hover:bg-ink/5 rounded-full border px-2.5 py-1 text-xs font-bold transition"
									onclick={() => void loadArtist(collaborator.name)}
								>
									{collaborator.name}
									<span class="text-faded ml-1 font-normal tabular-nums">{collaborator.count}</span>
								</button>
							{/each}
						</div>
					</section>
				{/if}
			</aside>
		</div>
	</div>
{/if}
