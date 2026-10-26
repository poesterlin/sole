import { getQueues } from '$lib/server/player';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const queues = await getQueues();
		return Response.json(
			{ success: true, ...queues },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		console.error('queue state failed:', error);
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
