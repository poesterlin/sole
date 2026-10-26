import { eq } from 'drizzle-orm';
import { db } from './db';
import { radioSessionsTable } from './schema';
import { getPlaybackTarget, getRadioQueue, playQueueUris } from './player';
import { recommend, validateTrackUris } from './recomendation-engine';
import { disableRadio, getRadioSession } from './radio-store';
import { withPlaybackLock } from './playback-lock';
import { RADIO_BUFFER, queueItemIds, refillRadio } from './radio-refill';

export async function startRadio(clusterIds: number[], seedUris: string[], playerId?: string) {
	if (!clusterIds.length) throw new Error('Pick at least one vibe for radio.');
	const target = await getPlaybackTarget(playerId);
	return withPlaybackLock(target.queueId, async () => {
		const tracks = await validateTrackUris(
			await recommend({
				clusterIds,
				seedUris,
				limit: RADIO_BUFFER + 1,
				alphaNow: 0.8,
				maxPerArtist: 2
			})
		);
		if (!tracks.length) throw new Error('No playable recommendations found.');
		const currentTarget = await getPlaybackTarget(target.playerId);
		if (currentTarget.queueId !== target.queueId) throw new Error('Player active queue changed');
		await disableRadio(target.queueId);
		// Persist disabled intent first; a failed MA call cannot leave the old radio enabled.
		const values = {
			...target,
			enabled: false,
			clusterIds,
			seedUris,
			recentUris: tracks.map((track) => track.uri),
			queueItemIds: [] as string[],
			message: null,
			updatedAt: new Date()
		};
		await db
			.insert(radioSessionsTable)
			.values(values)
			.onConflictDoUpdate({ target: radioSessionsTable.queueId, set: values });
		await playQueueUris(target.queueId, values.recentUris, 'replace');
		let queue = await getRadioQueue(target.playerId, target.queueId);
		// MA can acknowledge replacement before publishing the new occurrences.
		const hasStarted = () =>
			[queue.currentTrack, ...queue.tracks].some(
				(track) => track?.uri && values.recentUris.includes(track.uri)
			);
		for (let attempt = 0; !hasStarted() && attempt < 5; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 200));
			queue = await getRadioQueue(target.playerId, target.queueId);
		}
		if (!hasStarted())
			throw new Error('Music Assistant did not publish the new radio queue. Try again.');
		await db
			.update(radioSessionsTable)
			.set({ enabled: true, queueItemIds: queueItemIds(queue) })
			.where(eq(radioSessionsTable.queueId, target.queueId));
		return tracks;
	});
}

export async function stopRadio(queueId: string): Promise<void> {
	await withPlaybackLock(queueId, () => disableRadio(queueId));
}

export async function reconcileRadios(): Promise<void> {
	const sessions = await db
		.select()
		.from(radioSessionsTable)
		.where(eq(radioSessionsTable.enabled, true));
	for (const pending of sessions) {
		await withPlaybackLock(pending.queueId, async () => {
			const session = await getRadioSession(pending.queueId);
			if (!session?.enabled) return;
			const save = async (patch: Partial<typeof session>) => {
				await db
					.update(radioSessionsTable)
					.set({ ...patch, updatedAt: new Date() })
					.where(eq(radioSessionsTable.queueId, session.queueId));
			};
			try {
				await refillRadio(session, {
					readQueue: () => getRadioQueue(session.playerId, session.queueId),
					recommend: async (excludeUris, limit) => {
						const tracks = await validateTrackUris(
							await recommend({
								clusterIds: session.clusterIds,
								seedUris: session.seedUris,
								excludeUris,
								limit,
								alphaNow: 0.8,
								maxPerArtist: 2
							})
						);
						return tracks.map((track) => track.uri);
					},
					append: (uris) => playQueueUris(session.queueId, uris, 'add'),
					save
				});
			} catch (error) {
				const changed = error instanceof Error && error.message === 'Player active queue changed';
				await save({
					...(changed ? { enabled: false } : {}),
					message: changed
						? 'Radio stopped because the player changed queues.'
						: 'Music Assistant or recommendations unavailable; radio will retry.'
				});
				console.warn('[radio] refill failed:', error);
			}
		});
	}
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function startRadioLoop(): void {
	if (running || !process.env.MUSIC_HOST?.trim() || !process.env.MA_TOKEN?.trim()) return;
	running = true;
	const tick = async () => {
		try {
			await reconcileRadios();
		} catch (error) {
			console.warn('[radio] reconciliation failed:', error);
		}
		if (running) {
			timer = setTimeout(tick, 15_000);
			timer.unref();
		}
	};
	void tick();
}

export function stopRadioLoop(): void {
	running = false;
	if (timer) clearTimeout(timer);
	timer = null;
}
