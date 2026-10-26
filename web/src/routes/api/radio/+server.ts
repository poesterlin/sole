import { stopRadio } from '$lib/server/radio';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (
		!body ||
		typeof body.queueId !== 'string' ||
		!body.queueId.trim() ||
		body.queueId.length > 256
	) {
		return Response.json({ success: false, error: 'Provide a valid queueId.' }, { status: 400 });
	}
	try {
		await stopRadio(body.queueId);
		return Response.json({ success: true });
	} catch (error) {
		console.error('Stopping radio failed:', error);
		return Response.json({ success: false, error: 'Could not stop radio.' }, { status: 500 });
	}
};
