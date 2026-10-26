import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { likedSongsTable, trackTable } from '$lib/server/schema';
import { getActiveClusterMetadata } from '$lib/server/active-clusters';
import { getClusterCovers } from '$lib/server/cover-image';
import { recommend, validateTrackUris } from '$lib/server/recomendation-engine';
import {
	getActiveSchedule,
	getVibeClusterIds,
	listSchedules,
	sanitizeIds,
	setVibeClusterIds
} from '$lib/server/vibe-store';
import { playSongs } from '$lib/server/webhook';
import { InvalidPlaybackPlayerError, validatePlaybackPlayer } from '$lib/server/player';
import type { RequestHandler } from './$types';
import { startRadio } from '$lib/server/radio';

export const GET: RequestHandler = async () => {
	const [clusterIds, schedules, active, clusterMetadata, allCovers] = await Promise.all([
		getVibeClusterIds(),
		listSchedules(),
		getActiveSchedule(),
		getActiveClusterMetadata(),
		getClusterCovers().catch(() => ({}) as Awaited<ReturnType<typeof getClusterCovers>>)
	]);
	// Only the covers a schedule or the saved picks can show, keyed by cluster.
	const shown = new Set([...clusterIds, ...schedules.flatMap((slot) => slot.clusterIds)]);
	const covers = Object.fromEntries(
		Object.entries(allCovers)
			.filter(([id]) => shown.has(Number(id)))
			.map(([id, cover]) => [id, cover.primary])
	);
	return Response.json(
		{
			success: true,
			clusterIds,
			names: clusterMetadata.names,
			covers,
			schedules,
			activeSchedule: active,
			scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const overrides = new URL(request.url).searchParams.getAll('playerId');
		if (overrides.length > 1) throw new InvalidPlaybackPlayerError('Provide only one playerId.');
		const playerId = overrides.length ? await validatePlaybackPlayer(overrides[0]) : undefined;
		const body = (await request.json().catch(() => ({}))) as {
			clusterIds?: number[];
			useSchedule?: boolean;
			saveOnly?: boolean;
			scheduleId?: number;
			continuous?: boolean;
		};
		let clusterIds: number[];
		if (body.scheduleId !== undefined) {
			const schedule = (await listSchedules()).find((slot) => slot.id === body.scheduleId);
			if (!schedule || schedule.enabled === false || !schedule.clusterIds.length) {
				return Response.json({ success: false, error: 'Schedule is unavailable' }, { status: 400 });
			}
			clusterIds = [...schedule.clusterIds];
		} else if (body.useSchedule) {
			const activeSchedule = await getActiveSchedule();
			clusterIds = activeSchedule?.clusterIds?.length
				? [...activeSchedule.clusterIds]
				: await getVibeClusterIds();
		} else if (Array.isArray(body.clusterIds) && body.clusterIds.length > 0) {
			clusterIds = sanitizeIds(body.clusterIds);
			if (!clusterIds.length) {
				return Response.json(
					{ success: false, error: 'clusterIds must contain valid IDs' },
					{ status: 400 }
				);
			}
		} else {
			clusterIds = await getVibeClusterIds();
		}
		if (body.saveOnly) {
			clusterIds = await setVibeClusterIds(clusterIds);
			return Response.json({ success: true, clusterIds, saved: true });
		}

		// Select 5 random tracks from these clusters as seeds
		const seeds = await db
			.select({ uri: trackTable.uri })
			.from(trackTable)
			.innerJoin(likedSongsTable, eq(trackTable.uri, likedSongsTable.uri))
			.where(and(inArray(trackTable.clusterId, clusterIds), eq(trackTable.skip, false)))
			.orderBy(sql`random()`)
			.limit(5);

		if (body.continuous === true) {
			const tracks = await startRadio(
				clusterIds,
				seeds.map((seed) => seed.uri),
				playerId
			);
			return Response.json({ success: true, tracks, continuous: true });
		}

		const recommendations = await recommend({
			seedUris: seeds.map((s) => s.uri),
			limit: 50,
			alphaNow: 0.8,
			maxPerArtist: 4,
			clusterIds
		});

		if (recommendations.length > 0) {
			const tracks = await validateTrackUris(recommendations);
			if (tracks.length === 0) {
				return Response.json(
					{ success: false, error: 'No playable recommendations found' },
					{ status: 500 }
				);
			}
			await playSongs(
				tracks.map((t) => t.uri),
				playerId
			);
			return Response.json({ success: true, tracks });
		} else {
			return Response.json(
				{ success: false, error: 'No recommendations generated' },
				{ status: 500 }
			);
		}
	} catch (error) {
		if (error instanceof InvalidPlaybackPlayerError)
			return Response.json({ success: false, error: error.message }, { status: 400 });
		console.error('Vibe playback failed:', error);
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
