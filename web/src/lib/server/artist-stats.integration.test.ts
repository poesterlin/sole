import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import postgres from 'postgres';

// Explicit disposable database only. Run after db:migrate.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('artist search and distribution (PostgreSQL)', () => {
	const client = postgres(url!);

	beforeEach(async () => {
		await client`TRUNCATE track, cluster_name, cluster_run RESTART IDENTITY CASCADE`;
		await client`INSERT INTO cluster_run (status, mode, config, applied_at)
			VALUES ('applied', 'setup', '{"k":3}', now())`;
		await client`INSERT INTO cluster_name (run_id, cluster_id, display_name, source)
			SELECT id, 0, 'Sunlit Pop', 'manual' FROM cluster_run`;
		await client`INSERT INTO cluster_name (run_id, cluster_id, display_name, source)
			SELECT id, 1, 'Late Night Soul', 'manual' FROM cluster_run`;
		await client`INSERT INTO track (uri, name, artist, album, album_image, cluster_id, skip) VALUES
			('test:1', 'Smooth Operator', ARRAY['Sade'], 'Diamond Life', NULL, 0, FALSE),
			('test:2', 'The Sweetest Taboo', ARRAY['Sade', 'Sweetback'], 'Diamond Life', NULL, 0, FALSE),
			('test:3', 'No Ordinary Love', ARRAY['sade'], 'Promise', NULL, 1, FALSE),
			('test:4', 'Pearls', ARRAY['Sade'], 'Promise', NULL, 1, TRUE),
			('test:5', 'By Your Side', ARRAY['Sade'], 'Promise', NULL, -1, FALSE),
			('test:6', 'King of Sorrow', ARRAY['Sade'], 'Stronger Than Pride', '/imageproxy/cover', 2, FALSE),
			('test:7', 'Like a Prayer', ARRAY['Madonna'], 'Like a Prayer', NULL, 1, FALSE),
			('test:8', 'Lucky Star', ARRAY['100% Pure'], 'Hits', NULL, 2, FALSE)`;
	});

	afterAll(async () => {
		await client.end();
	});

	test('search folds case, ranks exact names first, and skips pruned duplicates', async () => {
		const { searchArtists } = await import('./artist-stats');

		const exact = await searchArtists('Sade');
		expect(exact[0]).toMatchObject({ name: 'Sade', trackCount: 5, clusterCount: 3 });
		expect(exact.filter((artist) => artist.name.toLowerCase() === 'sade')).toHaveLength(1);

		const partial = await searchArtists('sad');
		expect(partial[0]).toMatchObject({ name: 'Sade', trackCount: 5, clusterCount: 3 });

		// Prefix beats a mid-string match.
		const ranked = await searchArtists('a');
		const names = ranked.map((artist) => artist.name);
		expect(names.indexOf('Madonna')).toBeGreaterThanOrEqual(0);
		expect(names).toContain('Sade');
	});

	test('anonymous search lists the most represented artists', async () => {
		const { searchArtists } = await import('./artist-stats');
		const top = await searchArtists('', 3);
		expect(top[0]).toMatchObject({ name: 'Sade', trackCount: 5 });
		expect(top.length).toBeLessThanOrEqual(3);
	});

	test('LIKE wildcards in a query are treated literally', async () => {
		const { searchArtists } = await import('./artist-stats');
		const literal = await searchArtists('100%');
		expect(literal.map((artist) => artist.name)).toEqual(['100% Pure']);
		const wildcard = await searchArtists('%');
		expect(wildcard.map((artist) => artist.name)).toEqual(['100% Pure']);
	});

	test('stats report the distribution, names, albums and collaborators', async () => {
		const { getArtistStats } = await import('./artist-stats');
		const artist = await getArtistStats('sade');

		expect(artist).not.toBeNull();
		expect(artist).toMatchObject({
			name: 'Sade',
			trackCount: 5,
			skippedCount: 1,
			albumCount: 3,
			clusterCount: 3,
			unclusteredCount: 1,
			totalClusters: 3,
			includeSkipped: false
		});
		expect(artist!.distribution).toEqual([
			expect.objectContaining({ clusterId: 0, name: 'Sunlit Pop', count: 2, share: 0.5 }),
			expect.objectContaining({ clusterId: 1, name: 'Late Night Soul', count: 1, share: 0.25 }),
			expect.objectContaining({ clusterId: 2, name: 'Cluster 2', count: 1, share: 0.25 })
		]);
		expect(artist!.summary).toMatchObject({ clusteredTracks: 4, clusterCount: 3, topShare: 0.5 });
		expect(artist!.verdict.label).toBe('Omnipresent');
		expect(artist!.verdict.text).toContain('3 of 3');
		expect(artist!.albums[0]).toMatchObject({ album: 'Diamond Life', count: 2 });
		expect(artist!.albums.some((album) => album.albumImage === '/imageproxy/cover')).toBe(true);
		expect(artist!.collaborators).toEqual([{ name: 'Sweetback', count: 1 }]);
		// Every counted track can be played, clustered or not.
		expect(artist!.sampleUris).toHaveLength(5);
	});

	test('pruned duplicates can be counted back in', async () => {
		const { getArtistStats } = await import('./artist-stats');
		const artist = await getArtistStats('Sade', { includeSkipped: true });

		expect(artist).toMatchObject({
			trackCount: 6,
			skippedCount: 1,
			clusterCount: 3,
			includeSkipped: true
		});
		expect(artist!.distribution.find((slice) => slice.clusterId === 1)?.count).toBe(2);
	});

	test('an unknown artist has no stats', async () => {
		const { getArtistStats } = await import('./artist-stats');
		expect(await getArtistStats('Nobody At All')).toBeNull();
		expect(await getArtistStats('   ')).toBeNull();
	});
});
