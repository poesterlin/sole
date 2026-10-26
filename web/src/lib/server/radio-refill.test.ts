import { describe, expect, test } from 'bun:test';
import { refillRadio, rememberUris } from './radio-refill';
import { withPlaybackLock } from './playback-lock';
import type { PlayerQueue, UpNextTrack } from './player';
import type { RadioSession } from './radio-store';

const track = (uri: string, queueItemId = uri): UpNextTrack => ({
	uri,
	queueItemId,
	name: uri,
	artists: [],
	album: '',
	duration: 180
});
const session = (): RadioSession => ({
	queueId: 'living-room',
	playerId: 'speaker',
	enabled: true,
	clusterIds: [1],
	seedUris: ['seed'],
	recentUris: ['current', 'next'],
	queueItemIds: ['current', 'next'],
	message: null,
	updatedAt: new Date()
});
const queue = (patch: Partial<PlayerQueue> = {}): PlayerQueue => ({
	queueId: 'living-room',
	playerIds: ['speaker'],
	playerNames: ['Living room'],
	state: 'playing',
	currentIndex: 0,
	currentTrack: track('current'),
	tracks: [track('next')],
	hasMore: false,
	...patch
});

describe('continuous playback reconciliation', () => {
	function harness(snapshots: PlayerQueue[], candidates = ['new-1', 'new-2']) {
		const state = session();
		const appends: string[][] = [];
		const recommendations: Array<{ excluded: string[]; limit: number }> = [];
		let reads = 0;
		return {
			state,
			appends,
			recommendations,
			deps: {
				readQueue: async () => snapshots[Math.min(reads++, snapshots.length - 1)],
				recommend: async (excluded: string[], limit: number) => {
					recommendations.push({ excluded, limit });
					return candidates;
				},
				append: async (uris: string[]) => {
					appends.push(uris);
				},
				save: async (patch: Partial<RadioSession>) => {
					Object.assign(state, patch);
				}
			}
		};
	}

	test('refills a low queue without repeating current, queued, or recent tracks', async () => {
		const h = harness([queue()], ['current', 'next', 'new-1', 'new-1', 'new-2']);
		await refillRadio(h.state, h.deps);
		expect(h.appends).toEqual([['new-1', 'new-2']]);
		expect(h.recommendations[0]).toEqual({ excluded: ['current', 'next'], limit: 7 });
		expect(h.state.recentUris).toContain('new-1');
	});

	test('paused and stopped queues never trigger recommendations or playback', async () => {
		for (const state of ['paused', 'idle']) {
			const h = harness([queue({ state })]);
			await refillRadio(h.state, h.deps);
			expect(h.appends).toEqual([]);
			expect(h.recommendations).toEqual([]);
			expect(h.state.enabled).toBe(true);
		}
	});

	test('queue replacement detected by occurrence IDs even when the URI is unchanged', async () => {
		const h = harness([queue({ currentTrack: track('current', 'replacement'), tracks: [] })]);
		await refillRadio(h.state, h.deps);
		expect(h.state.enabled).toBe(false);
		expect(h.appends).toEqual([]);
	});

	test('manual additions during recommendation work prevent overfilling', async () => {
		const h = harness([
			queue(),
			queue({ tracks: [track('next'), track('manual-1'), track('manual-2')] })
		]);
		await refillRadio(h.state, h.deps);
		expect(h.appends).toEqual([]);
		expect(h.state.enabled).toBe(true);
	});

	test('pause or replacement during recommendation work cancels append', async () => {
		for (const changed of [
			queue({ state: 'paused' }),
			queue({ currentTrack: track('different'), tracks: [] })
		]) {
			const h = harness([queue(), changed]);
			await refillRadio(h.state, h.deps);
			expect(h.appends).toEqual([]);
		}
	});

	test('exhaustion stops radio with an explanation rather than relaxing exclusions', async () => {
		const h = harness([queue()], []);
		await refillRadio(h.state, h.deps);
		expect(h.state.enabled).toBe(false);
		expect(h.state.message).toContain('No more matching tracks');
	});

	test('queue read failures propagate without appending', async () => {
		const h = harness([queue()]);
		h.deps.readQueue = async () => {
			throw new Error('offline');
		};
		await expect(refillRadio(h.state, h.deps)).rejects.toThrow('offline');
		expect(h.appends).toEqual([]);
	});

	test('history stays bounded and retains most recently observed tracks', () => {
		const history = rememberUris(
			Array.from({ length: 200 }, (_, i) => String(i)),
			['0', 'new']
		);
		expect(history).toHaveLength(200);
		expect(history.slice(-2)).toEqual(['0', 'new']);
	});

	test('queue lock serializes mutations and releases after failure', async () => {
		const events: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = withPlaybackLock('q', async () => {
			events.push('first');
			await gate;
			throw new Error('failed');
		});
		const handled = first.catch(() => {});
		const second = withPlaybackLock('q', async () => {
			events.push('second');
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(events).toEqual(['first']);
		release();
		await Promise.all([handled, second]);
		expect(events).toEqual(['first', 'second']);
	});
});
