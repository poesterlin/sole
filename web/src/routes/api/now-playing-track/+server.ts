import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { likedSongsTable, skippedSongsTable, trackTable } from '$lib/server/schema';
import { getActiveClusterMetadata } from '$lib/server/active-clusters';
import { likeTrack, skipTrack } from '$lib/server/similar-track';
import { getCurrentTrack } from '$lib/server/webhook';
import type { RequestHandler } from './$types';

/**
 * Like and perma-skip for clients that only know what a player shows, such as
 * the Home Assistant card. The track is resolved from the Music Assistant uri
 * the client sees, falling back to Sole's own now-playing track when its title
 * matches, so an action never lands on a different song.
 */
async function resolveTrack(uri: string | null, title: string | null) {
	if (uri) {
		const [row] = await db.select().from(trackTable).where(eq(trackTable.uri, uri)).limit(1);
		if (row) return row;
	}
	const current = await getCurrentTrack();
	if (!current) return null;
	if (title && current.name.trim().toLowerCase() !== title.trim().toLowerCase()) return null;
	const [row] = await db.select().from(trackTable).where(eq(trackTable.uri, current.uri)).limit(1);
	return row ?? null;
}

async function describe(uri: string | null, title: string | null) {
	const track = await resolveTrack(uri, title);
	if (!track) return null;
	const [[liked], [skipped], metadata] = await Promise.all([
		db.select({ uri: likedSongsTable.uri }).from(likedSongsTable).where(eq(likedSongsTable.uri, track.uri)).limit(1),
		db.select({ uri: skippedSongsTable.uri }).from(skippedSongsTable).where(eq(skippedSongsTable.uri, track.uri)).limit(1),
		getActiveClusterMetadata()
	]);
	const clusterId = track.clusterId !== null && track.clusterId >= 0 ? track.clusterId : null;
	return {
		uri: track.uri,
		name: track.name,
		liked: Boolean(liked),
		skipped: Boolean(skipped),
		clusterId,
		clusterName: clusterId === null ? null : (metadata.names[clusterId] ?? null)
	};
}

const noStore = { 'Cache-Control': 'no-store' };

export const GET: RequestHandler = async ({ url }) => {
	const track = await describe(url.searchParams.get('uri'), url.searchParams.get('title'));
	return Response.json({ success: true, track }, { headers: noStore });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		uri?: unknown;
		title?: unknown;
		action?: unknown;
	};
	if (body.action !== 'like' && body.action !== 'unlike' && body.action !== 'skip') {
		return Response.json({ success: false, error: 'action must be like, unlike, or skip' }, { status: 400 });
	}
	const track = await resolveTrack(
		typeof body.uri === 'string' && body.uri ? body.uri : null,
		typeof body.title === 'string' && body.title ? body.title : null
	);
	if (!track) {
		return Response.json({ success: false, error: 'This track is not in Sole’s library.' }, { status: 404 });
	}
	if (body.action === 'like') await likeTrack(track.uri, 'home-assistant');
	else if (body.action === 'unlike') await db.delete(likedSongsTable).where(eq(likedSongsTable.uri, track.uri));
	else await skipTrack(track.uri);
	return Response.json({ success: true, track: await describe(track.uri, null) }, { headers: noStore });
};
