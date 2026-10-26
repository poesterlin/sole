import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('playback settings with a fake Music Assistant', () => {
	const client = postgres(url!);
	const original = {
		host: process.env.MUSIC_HOST,
		token: process.env.MA_TOKEN,
		player: process.env.MA_PLAYER_NAME
	};
	let server: ReturnType<typeof Bun.serve>;
	const plays: Array<{ queue_id: string; option: string; media: string[] }> = [];
	beforeAll(() => {
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
							{
								player_id: 'kitchen',
								name: 'Kitchen',
								state: 'playing',
								current_media: { uri: 'test://track/1' }
							},
							{ player_id: 'bedroom', name: 'Bedroom', state: 'idle' }
						];
					else if (command === 'player_queues/get_active_queue')
						result = { queue_id: `queue_${args.player_id}` };
					else if (command === 'player_queues/get') result = { current_index: -1, state: 'idle' };
					else if (command === 'player_queues/items') result = [];
					else if (command === 'player_queues/play_media') {
						plays.push(args);
						result = true;
					} else throw new Error(`Unexpected MA command: ${command}`);
					socket.send(JSON.stringify({ message_id, result }));
				}
			}
		});
		process.env.MUSIC_HOST = `http://127.0.0.1:${server.port}`;
		process.env.MA_TOKEN = 'fake-token';
		process.env.MA_PLAYER_NAME = 'Kitchen';
	});
	beforeEach(async () => {
		await client`DELETE FROM playback_settings`;
		await client`DELETE FROM radio_sessions`;
		plays.length = 0;
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

	test('preserves the environment default until saved, including an explicit automatic choice', async () => {
		const { getPlaybackPlayer, setPlaybackPlayer } = await import('./playback-settings');
		expect(await getPlaybackPlayer()).toBe('Kitchen');
		await setPlaybackPlayer('bedroom');
		expect(await getPlaybackPlayer()).toBe('bedroom');
		const restarted = Bun.spawnSync(
			[
				process.execPath,
				'--no-env-file',
				'-e',
				'import { getPlaybackPlayer } from "./src/lib/server/playback-settings"; console.log(await getPlaybackPlayer()); process.exit(0);'
			],
			{ env: { ...process.env, DATABASE_URL: url! }, cwd: process.cwd() }
		);
		expect(restarted.exitCode).toBe(0);
		expect(restarted.stdout.toString().trim()).toBe('bedroom');
		await setPlaybackPlayer(null);
		expect(await getPlaybackPlayer()).toBeNull();
		const [row] = await client`SELECT player_id FROM playback_settings WHERE id = 1`;
		expect(row.player_id).toBeNull();
	});

	test('a one-off player override targets its queue without changing the saved default', async () => {
		const { setPlaybackPlayer, getPlaybackPlayer } = await import('./playback-settings');
		const { playUris, getQueues } = await import('./player');
		await setPlaybackPlayer('kitchen');
		await playUris(['test://track/1'], { playerId: 'bedroom' });
		expect(plays[0].queue_id).toBe('queue_bedroom');
		expect(await getPlaybackPlayer()).toBe('kitchen');
		await playUris(['test://track/1']);
		expect(plays[1].queue_id).toBe('queue_kitchen');
		expect((await getQueues()).mainPlayer).toBe('Kitchen');
	});

	test('settings API accepts session changes and rejects service credentials', async () => {
		const { PUT } = await import('../../routes/api/playback-settings/+server');
		const event = (method: 'session' | 'service', playerId: string | null) =>
			({
				request: new Request('http://localhost/api/playback-settings', {
					method: 'PUT',
					body: JSON.stringify({ playerId })
				}),
				locals: { user: { id: 'test', username: 'test' }, method }
			}) as Parameters<typeof PUT>[0];
		expect((await PUT(event('service', 'bedroom'))).status).toBe(403);
		expect((await PUT(event('session', 'bedroom'))).status).toBe(200);
		expect((await PUT(event('session', 'missing'))).status).toBe(400);
		const [row] = await client`SELECT player_id FROM playback_settings WHERE id = 1`;
		expect(row.player_id).toBe('bedroom');
	});

	test('radio status survives restart and appending does not disable the session', async () => {
		await client`INSERT INTO radio_sessions
			(queue_id, player_id, enabled, cluster_ids, seed_uris, recent_uris, queue_item_ids)
			VALUES ('queue_kitchen', 'kitchen', true, '[1]', '["seed"]', '["recent"]', '["occurrence"]')`;
		const { playQueueUris, getPlayerState } = await import('./player');
		await playQueueUris('queue_kitchen', ['test://track/2'], 'add');
		expect(plays[0]).toEqual({
			queue_id: 'queue_kitchen',
			media: ['test://track/2'],
			option: 'add'
		});
		expect((await getPlayerState())?.radio?.enabled).toBe(true);
		const restarted = Bun.spawnSync(
			[
				process.execPath,
				'--no-env-file',
				'-e',
				'import { getRadioSession } from "./src/lib/server/radio-store"; const s = await getRadioSession("queue_kitchen"); console.log(JSON.stringify({ enabled: s?.enabled, recentUris: s?.recentUris })); process.exit(0);'
			],
			{ env: { ...process.env, DATABASE_URL: url! }, cwd: process.cwd() }
		);
		expect(restarted.exitCode).toBe(0);
		expect(JSON.parse(restarted.stdout.toString())).toEqual({
			enabled: true,
			recentUris: ['recent']
		});
	});

	test('replacing playback disables radio only on the target queue', async () => {
		for (const player of ['kitchen', 'bedroom']) {
			await client`INSERT INTO radio_sessions
				(queue_id, player_id, enabled, cluster_ids, seed_uris, recent_uris, queue_item_ids)
				VALUES (${'queue_' + player}, ${player}, true, '[1]', '[]', '[]', '[]')`;
		}
		const { playUris } = await import('./player');
		const { getRadioSession } = await import('./radio-store');
		await playUris(['test://track/3'], { playerId: 'bedroom' });
		expect(plays[0].option).toBe('replace');
		expect((await getRadioSession('queue_bedroom'))?.enabled).toBe(false);
		expect((await getRadioSession('queue_kitchen'))?.enabled).toBe(true);
	});

	test('stop radio preserves playback and queue contents', async () => {
		await client`INSERT INTO radio_sessions
			(queue_id, player_id, enabled, cluster_ids, seed_uris, recent_uris, queue_item_ids)
			VALUES ('queue_kitchen', 'kitchen', true, '[1]', '[]', '["recent"]', '[]')`;
		const { stopRadio } = await import('./radio');
		const { getRadioSession } = await import('./radio-store');
		await stopRadio('queue_kitchen');
		expect((await getRadioSession('queue_kitchen'))?.enabled).toBe(false);
		expect(plays).toHaveLength(0);
	});

	test('playback query rejects unknown, blank, and duplicate targets without sending playback', async () => {
		const { POST } = await import('../../routes/api/play-vibe/+server');
		for (const query of ['playerId=missing', 'playerId=', 'playerId=kitchen&playerId=bedroom']) {
			const request = new Request(`http://localhost/api/play-vibe?${query}`, {
				method: 'POST',
				body: '{}'
			});
			expect(
				(await POST({ request, url: new URL(request.url) } as Parameters<typeof POST>[0])).status
			).toBe(400);
		}
		expect(plays).toHaveLength(0);
	});
});
