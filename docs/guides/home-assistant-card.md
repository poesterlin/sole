# Home Assistant player card

Sole includes an optional Lovelace card for a Music Assistant player. It uses
Home Assistant's own `media_player` services for transport, and can read Sole's
schedules and start them when given a Sole playback key. It mirrors Sole's home
page: a compact dark player deck, and a cream **On the dial now** panel with
your day's schedules. The schedule panel switches to two columns when the card
is wide enough.

## Add the resource

The card is served by your Sole installation, so there is nothing to download.
In Home Assistant open **Settings → Dashboards → Resources → Add resource**:

- **URL:** `https://sole.example.com/sole-player-card.js`
- **Resource type:** JavaScript module

Replace the hostname with the address Home Assistant's browser uses to reach
Sole. If you prefer to keep the card locally, copy
`web/src/lib/ha/sole-player-card.js` to `/config/www/sole-player-card.js` and use
`/local/sole-player-card.js` as the resource URL instead.

After adding the resource, hard-refresh the dashboard once. Duplicate resource
URLs are the usual cause of a card that refuses to appear.

## Add the card

Add a **Manual** card to the dashboard and paste:

```yaml
type: custom:sole-player-card
entity: media_player.living_room
```

The entity is the Music Assistant player you already use. To find its id, open
**Developer tools → States** and search for `media_player.`.

## Add Sole schedules

Create an **external playback** key in Sole under **Manage → API keys**, then add
the Sole address and key to the card:

```yaml
type: custom:sole-player-card
entity: media_player.living_room
sole_url: https://sole.example.com
sole_token: REPLACE_WITH_YOUR_SOLE_PLAYBACK_KEY
```

The Sole address must be reachable from the browser that displays the dashboard.
The key is sent in the `Authorization` header; it is a Sole key, not a Music
Assistant token.

If you would rather not put the key in the dashboard YAML, create an
`input_text` helper containing the secret and point the card at it:

```yaml
type: custom:sole-player-card
entity: media_player.living_room
sole_url: https://sole.example.com
sole_token_entity: input_text.sole_playback_key
```

With a key configured, the card shows the current schedule with a cover collage
(hover it for the cluster names) and lists your day with the live slot marked
**Now**. Tap a slot to select it, then play it, or use **Play saved mix** for
the clusters saved on Sole's Vibe page; both start Sole's continuous radio.
When nothing is playing, the record's label starts the selected mix. Schedule
times follow Sole's timezone (`TZ` in `.env`), not Home Assistant's.

## Controls

- Previous and next track
- Play and pause
- **Like** and **Perma skip**, when a Sole key is configured and the track is in
  Sole's library. Perma skip also moves on to the next track
- A link to the playing track's cluster in Sole
- Stop
- Volume and mute in a pop-up behind the speaker button, when the player reports a volume level
- Cover art, title, artist, album, and elapsed time out of the track length
- Sole schedules and **Play saved mix**, when a Sole key is configured

The transport reads the standard `media_player` state attributes and calls
`media_player.*` services. The schedule controls call Sole's playback API with
the configured playback key, which also reads schedule cover art and likes or
perma-skips the shown track.

## Options

| Key | Default | Description |
| --- | --- | --- |
| `entity` | required | A `media_player.*` entity. |
| `name` | player's friendly name | Label above the sleeve. |
| `show_volume` | `true` | Show the volume slider and mute button. |
| `show_schedules` | `true` | Show Sole schedules when `sole_url` and a key are set. |
| `sole_url` | none | Sole's base URL, e.g. `https://sole.example.com`. |
| `sole_token` | none | A Sole playback key. |
| `sole_token_entity` | none | An `input_text` entity containing a playback key, used when `sole_token` is empty. |
| `accent` | `#e8490f` | Accent colour for the play button and active controls. |

```yaml
type: custom:sole-player-card
entity: media_player.kitchen
name: Kitchen
show_volume: true
show_schedules: true
sole_url: https://sole.example.com
sole_token_entity: input_text.sole_playback_key
accent: '#5f6633'
```

## Notes

- Without `sole_url` and a key, the card is transport-only. With them, it can
  start Sole schedules and saved picks. The [Home Assistant
  buttons](/guides/home-assistant) guide covers `rest_command` alternatives.
- The playback key is visible to anyone who can edit the dashboard. Use a
  dedicated key named for this card and revoke it in Sole if it leaks. Prefer
  `sole_token_entity` if you keep dashboard YAML in version control.
- If the player is unavailable, the card names the missing entity rather than
  showing stale controls.
- The card loads Fraunces and Karla from Google Fonts, with system fallbacks, so
  it still renders when the fonts cannot be fetched.
