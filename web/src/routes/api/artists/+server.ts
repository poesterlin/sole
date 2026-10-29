import { searchArtists } from '$lib/server/artist-stats';
import type { RequestHandler } from './$types';

/**
 * Artist search for the /vibe artist tab.
 *
 * No `q` returns the most represented artists, so the tab has a useful empty
 * state instead of a blank dropdown.
 */
export const GET: RequestHandler = async ({ url }) => {
	const query = (url.searchParams.get('q') ?? '').slice(0, 100);
	const artists = await searchArtists(query, 8);
	return Response.json({ success: true, artists }, { headers: { 'Cache-Control': 'no-store' } });
};
