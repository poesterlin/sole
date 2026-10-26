import { building } from '$app/environment';
import { redirect, type Handle } from '@sveltejs/kit';
import {
	authenticateRequest,
	matchesConfiguredToken,
	serviceUser,
	sessionCookieName
} from '$lib/server/auth';
import { authenticateApiKey } from '$lib/server/api-keys';

// App-level startup: seed persisted vibe state, and start warming the Music
// Assistant library snapshot. Skipped during prerender/build.
if (!building) {
	void import('$lib/server/vibe-store').then(({ ensureVibeSeeded }) =>
		ensureVibeSeeded().catch((e) => console.warn('[startup] vibe seed failed:', e))
	);
	// Paging MA's library takes ~14s, so it must never be awaited by a request.
	// Refreshing it on a timer keeps URI validation accurate and instant.
	void import('$lib/server/recomendation-engine').then(({ startMABackgroundRefresh }) =>
		startMABackgroundRefresh()
	);
	// The maintenance jobs run in-process on Bun.cron rather than in a
	// container per job. See $lib/server/scheduler for the tradeoffs.
	void import('$lib/server/scheduler').then(({ startScheduledJobs }) => startScheduledJobs());
	void import('$lib/server/radio').then(({ startRadioLoop }) => startRadioLoop());
}

const publicPages = new Set(['/login', '/register']);
const publicPaths = new Set([
	'/favicon',
	'/robots.txt',
	'/service-worker.js',
	'/manifest.webmanifest',
	'/api/health',
	'/sole-player-card.js'
]);

function normalizedPathname(pathname: string): string {
	return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function isPublicPath(pathname: string): boolean {
	const normalized = normalizedPathname(pathname);
	return (
		publicPages.has(normalized) || publicPaths.has(normalized) || pathname.startsWith('/_app/')
	);
}

function isInternalJob(pathname: string): boolean {
	const normalized = normalizedPathname(pathname);
	return normalized === '/api/analyze' || normalized === '/api/sync-favorites';
}

function isExternalPlaybackRequest(event: Parameters<Handle>[0]['event']): boolean {
	const pathname = normalizedPathname(event.url.pathname);
	// The card also reads schedule cover art (read-only) and likes or
	// perma-skips the track it shows.
	return (
		pathname === '/api/play-vibe' ||
		pathname === '/api/now-playing-track' ||
		(pathname === '/api/cover' && event.request.method === 'GET')
	);
}

// The Home Assistant card runs on the HA origin, not Sole's. Its playback key
// travels in the Authorization header (not a cookie), so a wildcard origin is
// safe and lets the dashboard read schedules and start playback.
const CORS_PATHS = new Set(['/api/play-vibe', '/api/cover', '/api/now-playing-track']);

function corsHeaders(): Headers {
	const headers = new Headers();
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
	headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	headers.set('Access-Control-Max-Age', '86400');
	headers.set('Vary', 'Origin');
	return headers;
}

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of corsHeaders()) headers.set(key, value);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	const corsPath = CORS_PATHS.has(normalizedPathname(event.url.pathname));
	if (corsPath && event.request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeaders() });
	}
	const respond = async () => {
		const response = await resolve(event);
		return corsPath ? withCors(response) : response;
	};

	// Unmatched API requests must not reach the HTML fallback page.
	if (!building && event.url.pathname.startsWith('/api/') && event.route.id === null) {
		const response = Response.json({ error: 'not found' }, { status: 404 });
		return corsPath ? withCors(response) : response;
	}
	// Worker endpoints have their own WORKER_TOKEN auth and must not be
	// intercepted by the browser-session guard.
	if (
		building ||
		event.url.pathname === '/api/worker' ||
		event.url.pathname.startsWith('/api/worker/')
	) {
		event.locals.user = null;
		event.locals.session = null;
		event.locals.method = null;
		return respond();
	}

	// These two service routes are called by the internal Compose jobs. They
	// use WORKER_TOKEN, but it is accepted only for these exact endpoints.
	if (
		event.request.method === 'POST' &&
		isInternalJob(event.url.pathname) &&
		matchesConfiguredToken(event.request, 'WORKER_TOKEN')
	) {
		event.locals.user = serviceUser;
		event.locals.session = null;
		event.locals.method = 'service';
		return respond();
	}

	// An external system may read schedules or trigger playback with its own
	// dedicated key. It is deliberately limited to the playback route.
	if (
		isExternalPlaybackRequest(event) &&
		(matchesConfiguredToken(event.request, 'PLAYBACK_API_KEY') ||
			(await authenticateApiKey(event.request, 'playback')) !== null)
	) {
		event.locals.user = serviceUser;
		event.locals.session = null;
		event.locals.method = 'service';
		return respond();
	}

	const auth = await authenticateRequest(event);
	event.locals.user = auth.user;
	event.locals.session = auth.session;
	event.locals.method = auth.method;

	if (auth.user || isPublicPath(event.url.pathname)) return resolve(event);

	if (event.url.pathname.startsWith('/api/')) {
		const response = Response.json(
			{ error: 'authentication required' },
			{ status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
		);
		return corsPath ? withCors(response) : response;
	}

	const returnTo = `${event.url.pathname}${event.url.search}`;
	redirect(302, `/login?redirect=${encodeURIComponent(returnTo)}`);
};

export { sessionCookieName };
