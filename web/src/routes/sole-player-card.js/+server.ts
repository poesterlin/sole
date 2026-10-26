import card from '$lib/ha/sole-player-card.js?raw';
import type { RequestHandler } from './$types';

// Home Assistant loads custom cards as cross-origin modules, so this asset has
// to be public and CORS-readable rather than sitting behind Sole's login.
const headers = {
	'Content-Type': 'text/javascript; charset=utf-8',
	'Access-Control-Allow-Origin': '*',
	'Cache-Control': 'public, max-age=300'
};

export const GET: RequestHandler = () => new Response(card, { headers });

export const OPTIONS: RequestHandler = () =>
	new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS'
		}
	});
