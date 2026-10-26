import type { PlayerQueue } from './player';
import type { RadioSession } from './radio-store';

export const RADIO_BUFFER = 8;
export const RADIO_REFILL_BELOW = 3;
export const RADIO_HISTORY = 200;

export function rememberUris(previous: string[], added: string[]): string[] {
	return [...new Set([...previous.filter((uri) => !added.includes(uri)), ...added])].slice(
		-RADIO_HISTORY
	);
}

export function queueItemIds(queue: PlayerQueue): string[] {
	return [queue.currentTrack, ...queue.tracks].flatMap((track) =>
		track?.queueItemId ? [track.queueItemId] : []
	);
}

export function ownsQueue(session: RadioSession, queue: PlayerQueue): boolean {
	const ids = queueItemIds(queue);
	if (session.queueItemIds.length) return ids.some((id) => session.queueItemIds.includes(id));
	// MA may not expose queue occurrences immediately after starting playback.
	return [queue.currentTrack, ...queue.tracks].some(
		(track) => track?.uri && session.recentUris.includes(track.uri)
	);
}

type RefillDependencies = {
	readQueue: () => Promise<PlayerQueue>;
	recommend: (excluded: string[], limit: number) => Promise<string[]>;
	append: (uris: string[]) => Promise<void>;
	save: (patch: Partial<RadioSession>) => Promise<void>;
};

/** The caller holds the queue lock. Re-read after recommendation work for external MA edits. */
export async function refillRadio(session: RadioSession, deps: RefillDependencies): Promise<void> {
	let queue = await deps.readQueue();
	if (!ownsQueue(session, queue)) {
		await deps.save({
			enabled: false,
			message: 'Radio stopped because the queue was replaced or cleared.'
		});
		return;
	}
	const observed = [queue.currentTrack, ...queue.tracks].flatMap((track) =>
		track?.uri ? [track.uri] : []
	);
	const recentUris = rememberUris(session.recentUris, observed);
	const knownIds = [...new Set([...session.queueItemIds, ...queueItemIds(queue)])].slice(-1000);
	await deps.save({ recentUris, queueItemIds: knownIds, message: null });
	if (queue.state !== 'playing' || queue.hasMore || queue.tracks.length >= RADIO_REFILL_BELOW)
		return;
	const uris = await deps.recommend(recentUris, RADIO_BUFFER - queue.tracks.length);
	queue = await deps.readQueue();
	if (!ownsQueue({ ...session, queueItemIds: knownIds }, queue)) {
		await deps.save({
			enabled: false,
			message: 'Radio stopped because the queue was replaced or cleared.'
		});
		return;
	}
	if (queue.state !== 'playing' || queue.hasMore || queue.tracks.length >= RADIO_REFILL_BELOW)
		return;
	const queued = new Set([queue.currentTrack, ...queue.tracks].map((track) => track?.uri));
	const picks = [...new Set(uris)]
		.filter((uri) => !queued.has(uri) && !recentUris.includes(uri))
		.slice(0, RADIO_BUFFER - queue.tracks.length);
	if (!picks.length) {
		await deps.save({
			enabled: false,
			message: 'No more matching tracks. Choose another vibe to restart radio.'
		});
		return;
	}
	// Remember intent before the network call: an ambiguous timeout must not cause duplicate retries.
	await deps.save({ recentUris: rememberUris(recentUris, picks), message: null });
	await deps.append(picks);
	const updated = await deps.readQueue();
	await deps.save({
		queueItemIds: [...new Set([...knownIds, ...queueItemIds(updated)])].slice(-1000)
	});
}
