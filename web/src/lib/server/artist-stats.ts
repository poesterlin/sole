import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { getActiveClusterMetadata } from '$lib/server/active-clusters';
import {
	describeArtist,
	summarizeDistribution,
	type ArtistAlbum,
	type ArtistClusterSlice,
	type ArtistCollaborator,
	type ArtistSearchResult,
	type ArtistStats
} from '$lib/artist-distribution';

type CountRow = { name: string; track_count: number; cluster_count: number };
type TotalRow = {
	display_name: string | null;
	tracks: number;
	skipped: number;
	albums: number;
	clusters: number;
	unclustered: number;
};
type DistributionRow = { cluster_id: number; n: number };
type CollaboratorRow = { name: string; n: number };
type AlbumRow = { album: string; n: number; image: string | null };
type UriRow = { uri: string };

/** Escape LIKE wildcards so "100%" searches for a literal percent sign. */
function likePattern(value: string, position: 'contains' | 'prefix'): string {
	const escaped = value.replace(/[\\%_]/g, (match) => `\\${match}`);
	return position === 'contains' ? `%${escaped}%` : `${escaped}%`;
}

/** drizzle hands back `Record<string, unknown>[]`; one place to narrow it. */
function rows<T>(result: unknown): T[] {
	return result as T[];
}

function toResults(result: unknown): ArtistSearchResult[] {
	return rows<CountRow>(result).map((row) => ({
		name: row.name,
		trackCount: Number(row.track_count),
		clusterCount: Number(row.cluster_count)
	}));
}

/**
 * Artist name lookup for the search box.
 *
 * With no query it returns the most represented artists, which gives the empty
 * state something useful to show. Matching folds case so "the beatles" and
 * "The Beatles" are one entry, and ranking puts an exact/prefix hit above a
 * mid-word one so typing "beat" still lands on the artist you meant.
 *
 * Pruned duplicates are excluded: they are about to disappear, and counting
 * them would make every name look bigger than the library actually is.
 */
export async function searchArtists(query: string, limit = 8): Promise<ArtistSearchResult[]> {
	const wanted = query.trim().slice(0, 100);
	const capped = Math.min(Math.max(Math.floor(limit), 1), 20);

	if (!wanted) {
		const rows = await db.execute(sql`
			SELECT mode() WITHIN GROUP (ORDER BY a.name) AS name,
				count(DISTINCT t.uri)::int AS track_count,
				count(DISTINCT t.cluster_id) FILTER (WHERE t.cluster_id >= 0)::int AS cluster_count
			FROM track t
			CROSS JOIN LATERAL unnest(t.artist) AS a(name)
			WHERE COALESCE(t.skip, FALSE) = FALSE
			GROUP BY lower(a.name)
			ORDER BY track_count DESC, name
			LIMIT ${capped}
		`);
		return toResults(rows);
	}

	const rows = await db.execute(sql`
		SELECT mode() WITHIN GROUP (ORDER BY a.name) AS name,
			count(DISTINCT t.uri)::int AS track_count,
			count(DISTINCT t.cluster_id) FILTER (WHERE t.cluster_id >= 0)::int AS cluster_count
		FROM track t
		CROSS JOIN LATERAL unnest(t.artist) AS a(name)
		WHERE COALESCE(t.skip, FALSE) = FALSE
			AND a.name ILIKE ${likePattern(wanted, 'contains')}
		GROUP BY lower(a.name)
		ORDER BY
			min(CASE
				WHEN lower(a.name) = lower(${wanted}) THEN 0
				WHEN a.name ILIKE ${likePattern(wanted, 'prefix')} THEN 1
				ELSE 2
			END),
			track_count DESC,
			name
		LIMIT ${capped}
	`);
	return toResults(rows);
}

/**
 * Everything the artist tab shows, in one round trip per aggregate.
 *
 * The artist's tracks are matched through the `artist` array, so a collaboration
 * counts for both names — that is what a listener expects when they search one
 * half of a duet. Pruned duplicates are excluded unless explicitly requested;
 * the returned `skippedCount` keeps that visible instead of silently shrinking
 * the numbers.
 */
export async function getArtistStats(
	name: string,
	options: { includeSkipped?: boolean } = {}
): Promise<ArtistStats | null> {
	const wanted = name.trim().slice(0, 200);
	if (!wanted) return null;
	const includeSkipped = options.includeSkipped === true;

	// One definition of "this artist's tracks", reused by every aggregate so the
	// numbers cannot disagree with each other.
	const matched = sql`
		WITH matched AS (
			SELECT t.uri, t.album, t.album_image, t.cluster_id, t.artist,
				COALESCE(t.skip, FALSE) AS skipped
			FROM track t
			WHERE EXISTS (
				SELECT 1 FROM unnest(t.artist) AS x(name)
				WHERE lower(x.name) = lower(${wanted})
			)
		),
		picked AS (
			SELECT * FROM matched WHERE ${includeSkipped ? sql`TRUE` : sql`NOT skipped`}
		)
	`;

	const [totalRows, distributionRows, collaboratorRows, albumRows, sampleRows, metadata] =
		await Promise.all([
			db.execute(sql`
				${matched}
				SELECT
					(SELECT mode() WITHIN GROUP (ORDER BY x.name)
						FROM matched m
						CROSS JOIN LATERAL unnest(m.artist) AS x(name)
						WHERE lower(x.name) = lower(${wanted})) AS display_name,
					count(*)::int AS tracks,
					(SELECT count(*)::int FROM matched WHERE skipped) AS skipped,
					count(DISTINCT album)::int AS albums,
					count(DISTINCT cluster_id) FILTER (WHERE cluster_id >= 0)::int AS clusters,
					count(*) FILTER (WHERE cluster_id IS NULL OR cluster_id < 0)::int AS unclustered
				FROM picked
			`),
			db.execute(sql`
				${matched}
				SELECT cluster_id, count(*)::int AS n
				FROM picked
				WHERE cluster_id >= 0
				GROUP BY cluster_id
				ORDER BY n DESC, cluster_id
			`),
			db.execute(sql`
				${matched}
				SELECT x.name AS name, count(DISTINCT p.uri)::int AS n
				FROM picked p
				CROSS JOIN LATERAL unnest(p.artist) AS x(name)
				WHERE lower(x.name) <> lower(${wanted})
				GROUP BY x.name
				ORDER BY n DESC, name
				LIMIT 8
			`),
			db.execute(sql`
				${matched}
				SELECT album, count(*)::int AS n, max(album_image) AS image
				FROM picked
				GROUP BY album
				ORDER BY n DESC, album
				LIMIT 6
			`),
			db.execute(sql`
				${matched}
				SELECT uri FROM picked
				ORDER BY random()
				LIMIT 40
			`),
			getActiveClusterMetadata().catch(() => ({
				ids: [] as number[],
				names: {} as Record<number, string>,
				manualNameIds: [] as number[],
				activeRun: null
			}))
		]);

	const totals = rows<TotalRow>(totalRows)[0];
	if (!totals || Number(totals.tracks) === 0) return null;

	const totalClusters = Math.max(1, metadata.ids.length);
	const distribution: ArtistClusterSlice[] = rows<DistributionRow>(distributionRows).map((row) => {
		const count = Number(row.n);
		return {
			clusterId: Number(row.cluster_id),
			name: metadata.names[Number(row.cluster_id)] ?? `Cluster ${row.cluster_id}`,
			count,
			share: 0
		};
	});
	const clusteredTracks = distribution.reduce((sum, slice) => sum + slice.count, 0);
	for (const slice of distribution) {
		slice.share = clusteredTracks > 0 ? slice.count / clusteredTracks : 0;
	}

	const summary = summarizeDistribution(
		distribution.map((slice) => slice.count),
		totalClusters
	);
	const collaborators: ArtistCollaborator[] = rows<CollaboratorRow>(collaboratorRows).map(
		(row) => ({ name: row.name, count: Number(row.n) })
	);
	const albums: ArtistAlbum[] = rows<AlbumRow>(albumRows).map((row) => ({
		album: row.album,
		count: Number(row.n),
		albumImage: row.image ?? null
	}));

	return {
		name: totals.display_name ?? wanted,
		trackCount: Number(totals.tracks),
		skippedCount: Number(totals.skipped),
		albumCount: Number(totals.albums),
		clusterCount: Number(totals.clusters),
		unclusteredCount: Number(totals.unclustered),
		totalClusters,
		distribution,
		summary,
		verdict: describeArtist(summary, {
			dominantName: distribution[0]?.name ?? '',
			totalClusters
		}),
		collaborators,
		albums,
		sampleUris: rows<UriRow>(sampleRows).map((row) => row.uri),
		includeSkipped
	};
}
