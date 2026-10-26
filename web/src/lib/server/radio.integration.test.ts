import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import postgres from 'postgres';

// Run in its own process: recommendation output is deterministic, while DB and MA transport are real.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('persistent radio with a fake Music Assistant', () => {
	const client = postgres(url!);
	const original = {
		host: process.env.MUSIC_HOST,
		token: process.env.MA_TOKEN,
		player: process.env.MA_PLAYER_NAME
	};
	let server: ReturnType<typeof Bun.serve>;
	let index = 0;
	let state = 'playing';
	let items: Array<{ queue_item_id: string; media_item: { uri: string; name: string } }> = [];
	let counter = 0;
	let failRead = false;
	const calls: Array<{ queue_id: string; media: string[]; option: string }> = [];
	const recommendations: Array<{ clusterIds: number[]; excludeUris?: string[]; limit: number }> =
		[];

	beforeAll(() => {
		mock.module('./recomendation-engine', () => ({
			recommend: async (opts: { clusterIds: number[]; excludeUris?: string[]; limit: number }) => {
				recommendations.push(opts);
				return Array.from({ length: opts.limit }, () => `test://track/${++counter}`);
			},
			validateTrackUris: async (uris: string[]) => uris.map((uri) => ({ uri }))
		}));
		server = Bun.serve({
			port: 0,
			fetch(request, server) {
				return server.upgrade(request, { data: undefined })
					? undefined
					: new Response('Not found', { status: 404 });
			},
			websocket: {
				message(socket, message) {
					const { message_id, command, args } = JSON.parse(String(message));
					let result: unknown;
					if (command === 'auth') result = { authenticated: true };
					else if (command === 'players/all')
						result = [
							{ player_id: 'kitchen', name: 'Kitchen', state },
							{ player_id: 'bedroom', name: 'Bedroom', state: 'idle' }
						];
					else if (command === 'player_queues/get_active_queue')
						result = { queue_id: `queue_${args.player_id}` };
					else if (command === 'player_queues/get') {
						if (failRead) {
							socket.send(JSON.stringify({ message_id, error_code: 999, details: 'offline' }));
							return;
						}
						result = { current_index: index, state };
					} else if (command === 'player_queues/items')
						result = items.slice(args.offset, args.offset + args.limit);
					else if (command === 'player_queues/play_media') {
						calls.push(args);
						const additions = args.media.map((uri: string) => ({
							queue_item_id: `occurrence-${counter}-${uri}`,
							media_item: { uri, name: uri }
						}));
						if (args.option === 'replace') {
							items = additions;
							index = 0;
							state = 'playing';
						} else items.push(...additions);
						result = true;
					} else if (command === 'player_queues/pause') {
						state = 'paused';
						result = true;
					} else if (command === 'player_queues/stop') {
						state = 'idle';
						result = true;
					} else throw new Error(`Unexpected MA command ${command}`);
					socket.send(JSON.stringify({ message_id, result }));
				}
			}
		});
		process.env.MUSIC_HOST = `http://127.0.0.1:${server.port}`;
		process.env.MA_TOKEN = 'fake-radio-token';
		process.env.MA_PLAYER_NAME = 'kitchen';
	});
	beforeEach(async () => {
		await client`DELETE FROM radio_sessions`;
		await client`DELETE FROM playback_settings`;
		calls.length = 0;
		recommendations.length = 0;
		items = [];
		index = 0;
		counter = 0;
		state = 'playing';
		failRead = false;
	});
	afterAll(async () => {
		server.stop(true);
		await client.end();
		for (const [key, value] of [
			['MUSIC_HOST', original.host],
			['MA_TOKEN', original.token],
			['MA_PLAYER_NAME', original.player]
		]) {
			if (value === undefined) delete process.env[key!];
			else process.env[key!] = value;
		}
	});

	test('starts nine tracks and refills the pinned queue from persisted state without duplicates', async () => {
		const { startRadio, reconcileRadios } = await import('./radio');
		const { setPlaybackPlayer } = await import('./playback-settings');
		const { getRadioSession } = await import('./radio-store');
		expect(await startRadio([2, 7], ['seed'], 'kitchen')).toHaveLength(9);
		expect((await getRadioSession('queue_kitchen'))?.enabled).toBe(true);
		await setPlaybackPlayer('bedroom');
		index = 7; // One track left after the current one.
		await reconcileRadios();
		expect(calls.map((call) => [call.queue_id, call.option, call.media.length])).toEqual([
			['queue_kitchen', 'replace', 9],
			['queue_kitchen', 'add', 7]
		]);
		expect(recommendations[1].clusterIds).toEqual([2, 7]);
		expect(recommendations[1].excludeUris).toContain('test://track/9');
		expect(new Set(items.map((item) => item.media_item.uri)).size).toBe(items.length);
		await reconcileRadios();
		expect(calls).toHaveLength(2);
	});

	test('pause preserves the session; stop disables it without a later refill', async () => {
		const { startRadio, reconcileRadios } = await import('./radio');
		const { playerControl } = await import('./player');
		const { getRadioSession } = await import('./radio-store');
		await startRadio([2], [], 'kitchen');
		index = 7;
		await playerControl('pause');
		await reconcileRadios();
		expect(calls).toHaveLength(1);
		expect((await getRadioSession('queue_kitchen'))?.enabled).toBe(true);
		await playerControl('stop');
		await reconcileRadios();
		expect(calls).toHaveLength(1);
		expect((await getRadioSession('queue_kitchen'))?.enabled).toBe(false);
	});

	test('external replacement stops radio rather than extending the new queue', async () => {
		const { startRadio, reconcileRadios } = await import('./radio');
		const { getRadioSession } = await import('./radio-store');
		await startRadio([2], [], 'kitchen');
		items = [
			{ queue_item_id: 'external', media_item: { uri: 'external://track', name: 'External' } }
		];
		await reconcileRadios();
		expect(calls).toHaveLength(1);
		expect((await getRadioSession('queue_kitchen'))?.enabled).toBe(false);
	});

	test('failed queue reads leave a retryable session and do not append', async () => {
		const { startRadio, reconcileRadios } = await import('./radio');
		const { getRadioSession } = await import('./radio-store');
		await startRadio([2], [], 'kitchen');
		index = 7;
		failRead = true;
		await reconcileRadios();
		expect(calls).toHaveLength(1);
		expect((await getRadioSession('queue_kitchen'))?.message).toContain('retry');
		failRead = false;
		await reconcileRadios();
		expect(calls).toHaveLength(2);
		expect((await getRadioSession('queue_kitchen'))?.message).toBeNull();
	});
});
