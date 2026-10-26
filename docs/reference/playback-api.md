# Playback API

`POST /api/play-vibe` generates a mix, replaces the target Music Assistant queue,
and starts playback. Each call generates a fresh mix from the selected vibes.

## Authentication

In Sole, open **Manage → API keys**, create an **external playback** key, and copy
the secret. Send it as `Authorization: Bearer <key>`. An existing
`PLAYBACK_API_KEY` environment credential also works. Worker keys do not.

Send JSON with `Content-Type: application/json` for playback. The playback key
grants `GET` and `POST` on `/api/play-vibe` and `/api/now-playing-track`, and
`GET` on `/api/cover`; it does
not grant browser access or access to the settings APIs. These routes send CORS
headers, so a Home Assistant dashboard card on another origin can read schedules
and their cover art and start playback with the same key.

## Choose the mix

| JSON body | Plays |
|---|---|
| `{}` | The saved picks from **Vibe → Mix**. Save those picks first. |
| `{"useSchedule": true}` | The enabled slot matching Sole's current local hour. Falls back to saved picks when no slot matches. |
| `{"scheduleId": 3}` | A specific enabled, nonempty schedule slot, regardless of the current hour. |
| `{"clusterIds": [2, 7]}` | Those vibe IDs for this request, without replacing the saved picks. |

When combined, `scheduleId` takes priority over `useSchedule`, which takes priority
over `clusterIds`. Use one selection method per request.

The home page's temporarily highlighted schedule card is not a saved API selection.
Use `scheduleId` to play that particular slot. Selecting a schedule does not itself
start playback automatically; a button or automation must call the API.

Schedules use **Sole's server timezone**, not the Home Assistant timezone. Hours
can wrap overnight; `22–6` covers late evening through early morning. Equal start
and end hours cover the whole day.

```sh
curl --fail-with-body -X POST https://sole.example.com/api/play-vibe \
  -H "Authorization: Bearer $SOLE_PLAYBACK_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"useSchedule":true}'
```

## Read the schedules

`GET /api/play-vibe` with the same playback key returns the data a dashboard needs
to offer schedule choices:

```json
{
  "success": true,
  "clusterIds": [2, 7],
  "names": { "2": "Night", "7": "Morning" },
  "covers": { "2": "/imageproxy/abc123" },
  "schedules": [
    { "id": 3, "name": "Evening", "startHour": 18, "endHour": 22, "clusterIds": [2], "enabled": true }
  ],
  "activeSchedule": null,
  "scheduleTimezone": "Europe/Stockholm"
}
```

`activeSchedule` is the enabled slot matching Sole's current hour. Pass a returned
`id` as `{"scheduleId": id}` to start that slot, or use `{"useSchedule": true}`
to start whichever slot is active now. `covers` maps each scheduled or picked
cluster to its main album cover; fetch it as
`GET /api/cover?path=<path>&size=256` with the same key. The [Home Assistant player
card](/guides/home-assistant-card) uses this endpoint directly.

## Like or perma-skip a track

`GET /api/now-playing-track?uri=<uri>&title=<title>` looks a track up by its
Music Assistant uri. Without a known uri it falls back to Sole's current track,
but only when its title matches, so the answer never describes another song.
It returns `{ "track": null }` for tracks outside Sole's library, otherwise:

```json
{ "success": true, "track": { "uri": "library://track/52533", "name": "$", "liked": false, "skipped": false, "clusterId": 26, "clusterName": "Verse-Driven Hip-Hop" } }
```

`POST /api/now-playing-track` with `{"uri": "...", "action": "like"}` likes the
track. Use `"unlike"` to remove the like or `"skip"` to exclude it from future
mixes. Skipping does not change playback; the caller moves to the next track.

## Choose the playback device

The default target is configured under **Manage → Playback device**. Choose a
speaker or sync group, or **Automatic** to follow active playback. The selection
is global and persists across restarts. Until a UI selection is saved, an existing
`MA_PLAYER_NAME` environment setting remains the default.

For one call, append `?playerId=<Music Assistant player ID>`:

```sh
curl --fail-with-body -X POST \
  'https://sole.example.com/api/play-vibe?playerId=syncgroup_example' \
  -H "Authorization: Bearer $SOLE_PLAYBACK_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"useSchedule":true}'
```

The override does not change the saved default. Use a Music Assistant **player ID**,
not a Home Assistant entity ID such as `media_player.living_room`. While logged
into Sole, `GET /api/playback-settings` lists player IDs and friendly names. That
GET requires a browser session, not a playback key. URL-encode the ID if necessary.

::: info Availability
Saved-picks and schedule playback are available in v0.1.3. The UI device selector
and `playerId` override are development changes requiring migration
`0019_playback_settings`; they are not included in v0.1.3.
:::

## Continuous playback (vibe radio)

In **Vibe → Mix**, select vibes and choose **Start radio ∞**. The
home-page playback actions (scheduled vibes, saved picks, and vibe tiles) start
continuous radio by default. The player's
**Start vibe radio** button uses the current scheduled slot or saved picks.
It starts a new queue; **Stop radio** stops adding tracks and leaves the queued
music playing. Each device queue on the home page also has its own stop control.

API callers can add `"continuous": true` to any playback selection:

```json
{"clusterIds": [2, 7], "continuous": true}
```

Radio starts with up to nine tracks (one playing plus eight ahead). The server
checks every 15 seconds and replenishes to eight upcoming tracks when fewer than
three remain. It stays within the selected vibes and excludes the last 200
queued/observed tracks, including manually added upcoming tracks. Artist limits,
likes, skips, and the default Christmas filter still apply.

The selected vibes are fixed for the session: a schedule changing hours does not
change a running radio. Queue targeting and recent history persist in PostgreSQL,
so closing the browser or restarting Sole does not discard the session.
Only playing queues refill; paused and idle queues are never resumed by the loop.
Starting another mix in Sole, stopping/clearing playback, or detecting a replaced
queue in Music Assistant stops radio. Manual additions are preserved.

If no playable, non-recent matches remain, radio stops with a message and leaves
the existing queue playing. Connection failures are retried on subsequent checks.
The loop runs in the single web process; keep one web replica.

`GET /api/player` and `GET /api/queues` include a `radio` status with `enabled`,
`clusterIds`, and `message`. A logged-in browser can stop a session with
`POST /api/radio` and `{"queueId": "<queue ID>"}`. Playback-scoped API keys
can start radio through `/api/play-vibe`; the status and stop endpoints require
browser authentication.

This development feature requires migration `0020_continuous_playback`.
Run `bun run db:migrate` against your configured database before starting the
updated web app.

## Responses

Successful playback returns HTTP 200:

```json
{"success": true, "tracks": [{"uri": "library://track/123"}]}
```

Track objects include additional metadata. Error responses include an `error`
message. HTTP 401 means a missing, expired, revoked, or wrong-scope credential;
400 means an invalid selection or player override; 500 means generation,
track validation, or playback failed. Read the response body for the reason.

For dashboard buttons and automations, see [Home Assistant](/guides/home-assistant).
