import { getArtistStats } from '$lib/server/artist-stats';
import type { RequestHandler } from './$types';

/**
 * Cluster distribution and stats for one artist, matched case-insensitively.
 * `includeSkipped=1` counts pruned duplicates too; the default leaves them out
 * so the distribution reflects what is actually playable.
 */
export const GET: RequestHandler = async ({ url }) => {
	const name = (url.searchParams.get('name') ?? '').slice(0, 200);
	if (!name.trim()) {
		return Response.json({ error: 'name is required' }, { status: 400 });
	}
	const artist = await getArtistStats(name, {
		includeSkipped: url.searchParams.get('includeSkipped') === '1'
	});
	if (!artist) {
		return Response.json({ error: `No tracks by ${name.trim()} in the library` }, { status: 404 });
	}
	return Response.json({ success: true, artist }, { headers: { 'Cache-Control': 'no-store' } });
};
