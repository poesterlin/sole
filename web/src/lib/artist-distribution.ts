/**
 * Shapes and small pure helpers for the artist view on /vibe.
 *
 * Kept free of database imports so the component and the tests can use them
 * without pulling in `$lib/server/db`; the server module builds these values
 * from SQL.
 */

export type ArtistSearchResult = {
	name: string;
	/** Active (non-pruned) tracks credited to the artist. */
	trackCount: number;
	/** Distinct vibes those tracks land in. */
	clusterCount: number;
};

export type ArtistClusterSlice = {
	clusterId: number;
	name: string;
	count: number;
	/** Fraction of the artist's clustered tracks, 0–1. */
	share: number;
};

export type ArtistAlbum = {
	album: string;
	count: number;
	albumImage: string | null;
};

export type ArtistCollaborator = {
	name: string;
	count: number;
};

export type ArtistDistributionSummary = {
	/** Tracks that have a real cluster (unclustered ones are left out). */
	clusteredTracks: number;
	clusterCount: number;
	/** Share of the artist's clustered tracks in their biggest cluster, 0–1. */
	topShare: number;
	/** exp(entropy) — "this many equally sized vibes would look the same". */
	spread: number;
	/** 0 when everything sits in one vibe, 1 when flat across the vibes touched. */
	evenness: number;
	/** Share of the library's vibes the artist appears in, 0–1. */
	reach: number;
};

export type ArtistVerdict = {
	label: string;
	text: string;
};

export type ArtistStats = {
	name: string;
	/** Tracks counted after the pruned-duplicate filter. */
	trackCount: number;
	/** Pruned duplicates that exist but were left out of the numbers. */
	skippedCount: number;
	albumCount: number;
	clusterCount: number;
	/** Tracks with no cluster id yet (-1 or NULL). */
	unclusteredCount: number;
	/** Size of the library's current cluster space. */
	totalClusters: number;
	distribution: ArtistClusterSlice[];
	summary: ArtistDistributionSummary;
	verdict: ArtistVerdict;
	collaborators: ArtistCollaborator[];
	albums: ArtistAlbum[];
	/** Random clustered URIs, for a short listen. */
	sampleUris: string[];
	includeSkipped: boolean;
};

/**
 * Distribution maths for one artist's clustered track counts.
 *
 * `totalClusters` is the size of the current cluster space, not the number of
 * clusters the artist touches, so `reach` answers "how much of the map do they
 * cover". Entropy stays in the touched set for `evenness`, because an artist
 * who is flat inside five clusters is evenly spread even though five clusters
 * are a small slice of fifty-two.
 */
export function summarizeDistribution(
	counts: number[],
	totalClusters: number
): ArtistDistributionSummary {
	const positive = counts.map((count) => (Number.isFinite(count) && count > 0 ? count : 0));
	const clusteredTracks = positive.reduce((sum, count) => sum + count, 0);
	const clusterCount = positive.filter((count) => count > 0).length;
	const space = Math.max(1, Math.floor(totalClusters));

	if (clusteredTracks === 0 || clusterCount === 0) {
		return {
			clusteredTracks: 0,
			clusterCount: 0,
			topShare: 0,
			spread: 0,
			evenness: 0,
			reach: 0
		};
	}

	let entropy = 0;
	let topCount = 0;
	for (const count of positive) {
		if (count <= 0) continue;
		const share = count / clusteredTracks;
		entropy -= share * Math.log(share);
		topCount = Math.max(topCount, count);
	}

	return {
		clusteredTracks,
		clusterCount,
		topShare: topCount / clusteredTracks,
		spread: Math.exp(entropy),
		// A single cluster has zero entropy, and the ratio is 0/0 there; the
		// explicit branch keeps it at "not even" rather than NaN.
		evenness: clusterCount > 1 ? Math.min(1, entropy / Math.log(clusterCount)) : 0,
		reach: Math.min(1, clusterCount / space)
	};
}

/**
 * One-sentence reading of a distribution, for the headline above the bars.
 * Thresholds are deliberately blunt so the label matches what the bars show.
 */
export function describeArtist(
	summary: ArtistDistributionSummary,
	options: { dominantName: string; totalClusters: number }
): ArtistVerdict {
	const total = Math.max(1, options.totalClusters);
	const dominant = options.dominantName || 'one vibe';
	const topPercent = Math.round(summary.topShare * 100);

	if (summary.clusteredTracks === 0) {
		return {
			label: 'Uncharted',
			text: 'None of their tracks have landed in a vibe yet.'
		};
	}
	if (summary.clusterCount === 1) {
		return {
			label: 'One-track mind',
			text: `Every clustered track sits in ${dominant} — a single, unmistakable sound.`
		};
	}
	if (summary.reach >= 0.5 && summary.evenness >= 0.75) {
		return {
			label: 'Omnipresent',
			text: `At home in ${summary.clusterCount} of ${total} vibes, with no clear favourite.`
		};
	}
	if (summary.topShare >= 0.5) {
		return {
			label: 'Focused',
			text: `${topPercent}% of their clustered tracks sit in ${dominant}.`
		};
	}
	if (summary.evenness >= 0.6) {
		return {
			label: 'Versatile',
			text: `Spread across ${summary.clusterCount} vibes, led by ${dominant} at ${topPercent}%.`
		};
	}
	return {
		label: 'Scattered',
		text: `${summary.clusterCount} vibes with a foothold, the largest being ${dominant} at ${topPercent}%.`
	};
}
